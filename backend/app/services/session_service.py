from datetime import UTC, datetime

import stripe
from fastapi import HTTPException
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.session import STRIKE_THRESHOLD, PayoutStatus, Session, SessionRecipient, SessionStatus
from app.models.user import User
from app.schemas.session import (
    DistractionReport,
    SessionCreate,
    SessionRecipientAdd,
    SessionRead,
    SessionRecipientRead,
    SessionResolve,
    SessionUpdate,
)
from app.services import session_events, stripe_service


async def _build_session_read(db_session: AsyncSession, focus_session: Session) -> SessionRead:
    creator = await db_session.get(User, focus_session.creator_id)

    result = await db_session.exec(select(SessionRecipient).where(SessionRecipient.session_id == focus_session.id))
    recipients = result.all()

    recipient_reads: list[SessionRecipientRead] = []
    for r in recipients:
        user = await db_session.get(User, r.recipient_id)
        recipient_reads.append(
            SessionRecipientRead(
                id=r.id,  # type: ignore[arg-type]
                recipient_id=r.recipient_id,
                recipient_username=user.username if user else 'unknown',
                payout_cents=r.payout_cents,
                payout_status=r.payout_status,
            )
        )

    return SessionRead(
        id=focus_session.id,  # type: ignore[arg-type]
        creator_id=focus_session.creator_id,
        creator_username=creator.username if creator else 'unknown',
        amount_cents=focus_session.amount_cents,
        duration_seconds=focus_session.duration_seconds,
        status=focus_session.status,
        created_at=focus_session.created_at,
        activated_at=focus_session.activated_at,
        resolved_at=focus_session.resolved_at,
        elapsed_seconds=focus_session.elapsed_seconds,
        distraction_count=focus_session.distraction_count,
        recipients=recipient_reads,
    )


async def create_session(db_session: AsyncSession, creator: User, body: SessionCreate) -> SessionRead:
    if not creator.stripe_payment_method_id:
        raise HTTPException(
            status_code=400,
            detail='You must have a saved payment method before creating a session',
        )

    recipient_by_id: dict[int, User] = {}

    usernames = [u.strip().lower() for u in body.recipient_usernames if u.strip()]
    if usernames:
        if creator.username.lower() in usernames:
            raise HTTPException(status_code=400, detail='You cannot add yourself as a recipient')
        result = await db_session.exec(select(User).where(col(User.username).in_(usernames)))
        found_users = result.all()
        found_map = {u.username.lower(): u for u in found_users}

        missing = [u for u in usernames if u not in found_map]
        if missing:
            raise HTTPException(
                status_code=404,
                detail=f'Users not found: {", ".join(missing)}',
            )
        for username in usernames:
            user = found_map[username]
            recipient_by_id[user.id] = user  # type: ignore[index]

    discord_uids = list(dict.fromkeys(body.recipient_discord_uids))
    if discord_uids:
        if creator.discord_uid is not None and creator.discord_uid in discord_uids:
            raise HTTPException(status_code=400, detail='You cannot add yourself as a recipient')
        result = await db_session.exec(select(User).where(col(User.discord_uid).in_(discord_uids)))
        found_users = result.all()
        found_map = {u.discord_uid: u for u in found_users if u.discord_uid is not None}

        missing = [uid for uid in discord_uids if uid not in found_map]
        if missing:
            raise HTTPException(
                status_code=404,
                detail=f'Discord-linked users not found for UIDs: {", ".join(str(uid) for uid in missing)}',
            )
        for discord_uid in discord_uids:
            user = found_map[discord_uid]
            recipient_by_id[user.id] = user  # type: ignore[index]

    if not recipient_by_id:
        raise HTTPException(status_code=422, detail='at least one recipient is required')

    focus_session = Session(
        creator_id=creator.id,  # type: ignore[arg-type]
        amount_cents=body.amount_cents,
        duration_seconds=body.duration_seconds,
    )
    db_session.add(focus_session)
    await db_session.flush()

    for recipient_user in recipient_by_id.values():
        sr = SessionRecipient(
            session_id=focus_session.id,  # type: ignore[arg-type]
            recipient_id=recipient_user.id,  # type: ignore[arg-type]
        )
        db_session.add(sr)

    await db_session.commit()
    await db_session.refresh(focus_session)
    session_read = await _build_session_read(db_session, focus_session)
    await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
    return session_read


async def add_session_recipient(
    db_session: AsyncSession, session_id: int, user: User, body: SessionRecipientAdd
) -> SessionRead:
    focus_session = await db_session.get(Session, session_id)
    if focus_session is None:
        raise HTTPException(status_code=404, detail='Session not found')
    if focus_session.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can add recipients')
    if focus_session.status != SessionStatus.PENDING:
        raise HTTPException(status_code=400, detail='Can only add recipients to a pending session')

    result = await db_session.exec(select(SessionRecipient).where(SessionRecipient.session_id == focus_session.id))
    existing_rows = result.all()
    existing_recipient_ids = {row.recipient_id for row in existing_rows}

    target_user: User | None = None
    if body.recipient_discord_uid is not None:
        result = await db_session.exec(select(User).where(User.discord_uid == body.recipient_discord_uid))
        target_user = result.first()
    elif body.recipient_username:
        result = await db_session.exec(select(User).where(User.username == body.recipient_username.lower()))
        target_user = result.first()

    if target_user is None:
        raise HTTPException(status_code=404, detail='Recipient user not found')
    if target_user.id == user.id:
        raise HTTPException(status_code=400, detail='You cannot add yourself as a recipient')
    if target_user.id in existing_recipient_ids:
        session_read = await _build_session_read(db_session, focus_session)
        await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
        return session_read

    db_session.add(
        SessionRecipient(
            session_id=focus_session.id,  # type: ignore[arg-type]
            recipient_id=target_user.id,  # type: ignore[arg-type]
        )
    )
    await db_session.commit()
    await db_session.refresh(focus_session)
    session_read = await _build_session_read(db_session, focus_session)
    await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
    return session_read


async def get_session(db_session: AsyncSession, session_id: int, user: User) -> SessionRead:
    focus_session = await db_session.get(Session, session_id)
    if focus_session is None:
        raise HTTPException(status_code=404, detail='Session not found')

    result = await db_session.exec(select(SessionRecipient).where(SessionRecipient.session_id == focus_session.id))
    recipient_ids = [r.recipient_id for r in result.all()]

    if focus_session.creator_id != user.id and user.id not in recipient_ids:
        raise HTTPException(status_code=403, detail='Not authorized to view this session')

    return await _build_session_read(db_session, focus_session)


async def list_created_sessions(
    db_session: AsyncSession, user: User, status: SessionStatus | None = None
) -> list[SessionRead]:
    query = select(Session).where(Session.creator_id == user.id)
    if status:
        query = query.where(Session.status == status)
    query = query.order_by(col(Session.created_at).desc())

    result = await db_session.exec(query)
    sessions = result.all()
    return [await _build_session_read(db_session, s) for s in sessions]


async def list_received_sessions(db_session: AsyncSession, user: User) -> list[SessionRead]:
    result = await db_session.exec(
        select(SessionRecipient.session_id).where(SessionRecipient.recipient_id == user.id)
    )
    session_ids = result.all()
    if not session_ids:
        return []

    result = await db_session.exec(
        select(Session).where(col(Session.id).in_(session_ids)).order_by(col(Session.created_at).desc())
    )
    sessions = result.all()
    return [await _build_session_read(db_session, s) for s in sessions]


async def activate_session(db_session: AsyncSession, session_id: int, user: User) -> SessionRead:
    focus_session = await db_session.get(Session, session_id)
    if focus_session is None:
        raise HTTPException(status_code=404, detail='Session not found')
    if focus_session.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can activate a session')
    if focus_session.status != SessionStatus.PENDING:
        raise HTTPException(status_code=400, detail=f'Cannot activate a session with status "{focus_session.status}"')

    focus_session.status = SessionStatus.ACTIVE
    focus_session.activated_at = datetime.now(UTC)
    db_session.add(focus_session)
    await db_session.commit()
    await db_session.refresh(focus_session)
    session_read = await _build_session_read(db_session, focus_session)
    await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
    return session_read


async def update_session(
    db_session: AsyncSession, session_id: int, user: User, body: SessionUpdate
) -> SessionRead:
    focus_session = await db_session.get(Session, session_id)
    if focus_session is None:
        raise HTTPException(status_code=404, detail='Session not found')
    if focus_session.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can update a session')
    if focus_session.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=400, detail='Can only update an active session')

    if body.distraction_count is not None:
        focus_session.distraction_count = body.distraction_count
    if body.elapsed_seconds is not None:
        focus_session.elapsed_seconds = body.elapsed_seconds

    db_session.add(focus_session)
    await db_session.commit()
    await db_session.refresh(focus_session)
    session_read = await _build_session_read(db_session, focus_session)
    await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
    return session_read


async def resolve_session(
    db_session: AsyncSession, session_id: int, user: User, body: SessionResolve
) -> SessionRead:
    focus_session = await db_session.get(Session, session_id)
    if focus_session is None:
        raise HTTPException(status_code=404, detail='Session not found')
    if focus_session.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can resolve a session')
    if focus_session.status != SessionStatus.ACTIVE:
        raise HTTPException(status_code=400, detail='Can only resolve an active session')

    focus_session.resolved_at = datetime.now(UTC)
    focus_session.elapsed_seconds = body.elapsed_seconds

    if focus_session.distraction_count < STRIKE_THRESHOLD:
        result = await db_session.exec(
            select(SessionRecipient).where(SessionRecipient.session_id == focus_session.id)
        )
        recipient_rows = result.all()
        for r in recipient_rows:
            if r.payout_status == PayoutStatus.PENDING:
                r.payout_status = PayoutStatus.CANCELED
                db_session.add(r)

        focus_session.status = SessionStatus.COMPLETED
        db_session.add(focus_session)
        await db_session.commit()
        await db_session.refresh(focus_session)
        session_read = await _build_session_read(db_session, focus_session)
        await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
        return session_read

    # FAILED — split amount, charge the creator, transfer to each recipient.
    result = await db_session.exec(
        select(SessionRecipient).where(SessionRecipient.session_id == focus_session.id)
    )
    recipient_rows = result.all()
    per_person = focus_session.amount_cents // len(recipient_rows) if recipient_rows else 0
    if per_person < 1:
        focus_session.status = SessionStatus.FAILED
        db_session.add(focus_session)
        await db_session.commit()
        raise HTTPException(status_code=400, detail='Session amount too small to distribute across recipients')
    for r in recipient_rows:
        r.payout_cents = per_person
        db_session.add(r)

    creator = await db_session.get(User, focus_session.creator_id)

    if focus_session.stripe_payment_intent_id is None:
        try:
            intent = await stripe_service.charge_for_session(
                focus_session,
                customer_id=creator.stripe_customer_id,
                payment_method_id=creator.stripe_payment_method_id,
            )
        except stripe.CardError as e:
            focus_session.status = SessionStatus.FAILED
            db_session.add(focus_session)
            await db_session.commit()
            raise HTTPException(status_code=402, detail=f'Card charge failed: {e.user_message or e.code}')

        focus_session.stripe_payment_intent_id = intent.id

        if intent.status != 'succeeded':
            focus_session.status = SessionStatus.FAILED
            db_session.add(focus_session)
            await db_session.commit()
            raise HTTPException(status_code=402, detail='Card charge did not succeed; cannot distribute payouts')

        charge_id = intent.latest_charge
        for r in recipient_rows:
            recipient_user = await db_session.get(User, r.recipient_id)
            if not recipient_user.stripe_account_enabled:
                r.payout_status = PayoutStatus.FAILED
                db_session.add(r)
                continue
            try:
                transfer = await stripe_service.create_transfer(
                    amount_cents=r.payout_cents,
                    destination_account_id=recipient_user.stripe_account_id,
                    charge_id=charge_id,
                    session_id=focus_session.id,
                )
                r.stripe_transfer_id = transfer.id
                r.payout_status = PayoutStatus.PAID
            except stripe.StripeError:
                r.payout_status = PayoutStatus.FAILED
            db_session.add(r)

    focus_session.status = SessionStatus.PAID_OUT
    db_session.add(focus_session)
    await db_session.commit()
    await db_session.refresh(focus_session)
    session_read = await _build_session_read(db_session, focus_session)
    await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
    return session_read


async def report_distraction(
    db_session: AsyncSession, user: User, body: DistractionReport
) -> SessionRead:
    result = await db_session.exec(
        select(Session).where(Session.creator_id == user.id, Session.status == SessionStatus.ACTIVE)
    )
    focus_session = result.first()
    if focus_session is None:
        raise HTTPException(status_code=404, detail='No active session found')

    focus_session.distraction_count += 1
    db_session.add(focus_session)
    await db_session.commit()
    await db_session.refresh(focus_session)
    session_read = await _build_session_read(db_session, focus_session)
    await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
    return session_read


async def cancel_session(db_session: AsyncSession, session_id: int, user: User) -> SessionRead:
    focus_session = await db_session.get(Session, session_id)
    if focus_session is None:
        raise HTTPException(status_code=404, detail='Session not found')
    if focus_session.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can cancel a session')
    if focus_session.status != SessionStatus.PENDING:
        raise HTTPException(status_code=400, detail='Can only cancel a pending session')

    focus_session.status = SessionStatus.CANCELLED
    db_session.add(focus_session)
    await db_session.commit()
    await db_session.refresh(focus_session)
    session_read = await _build_session_read(db_session, focus_session)
    await session_events.broker.publish(session_read.id, session_read.model_dump(mode='json'))
    return session_read
