from datetime import UTC, datetime

import stripe
from fastapi import HTTPException
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.stake import STRIKE_THRESHOLD, PayoutStatus, Stake, StakeRecipient, StakeStatus
from app.models.user import User
from app.schemas.stake import (
    DistractionReport,
    StakeCreate,
    StakeRecipientAdd,
    StakeRead,
    StakeRecipientRead,
    StakeResolve,
    StakeUpdate,
)
from app.services import stake_events, stripe_service


async def _build_stake_read(session: AsyncSession, stake: Stake) -> StakeRead:
    creator = await session.get(User, stake.creator_id)

    result = await session.exec(select(StakeRecipient).where(StakeRecipient.stake_id == stake.id))
    recipients = result.all()

    recipient_reads: list[StakeRecipientRead] = []
    for r in recipients:
        user = await session.get(User, r.recipient_id)
        recipient_reads.append(
            StakeRecipientRead(
                id=r.id,  # type: ignore[arg-type]
                recipient_id=r.recipient_id,
                recipient_username=user.username if user else 'unknown',
                payout_cents=r.payout_cents,
                payout_status=r.payout_status,
            )
        )

    return StakeRead(
        id=stake.id,  # type: ignore[arg-type]
        creator_id=stake.creator_id,
        creator_username=creator.username if creator else 'unknown',
        amount_cents=stake.amount_cents,
        duration_seconds=stake.duration_seconds,
        status=stake.status,
        created_at=stake.created_at,
        activated_at=stake.activated_at,
        resolved_at=stake.resolved_at,
        elapsed_seconds=stake.elapsed_seconds,
        distraction_count=stake.distraction_count,
        recipients=recipient_reads,
    )


async def create_stake(session: AsyncSession, creator: User, body: StakeCreate) -> StakeRead:
    if not creator.stripe_payment_method_id:
        raise HTTPException(
            status_code=400,
            detail='You must have a saved payment method before creating a stake',
        )

    recipient_by_id: dict[int, User] = {}

    usernames = [u.strip().lower() for u in body.recipient_usernames if u.strip()]
    if usernames:
        if creator.username.lower() in usernames:
            raise HTTPException(status_code=400, detail='You cannot add yourself as a recipient')
        result = await session.exec(select(User).where(col(User.username).in_(usernames)))
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
        result = await session.exec(select(User).where(col(User.discord_uid).in_(discord_uids)))
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

    stake = Stake(
        creator_id=creator.id,  # type: ignore[arg-type]
        amount_cents=body.amount_cents,
        duration_seconds=body.duration_seconds,
    )
    session.add(stake)
    await session.flush()

    for recipient_user in recipient_by_id.values():
        sr = StakeRecipient(
            stake_id=stake.id,  # type: ignore[arg-type]
            recipient_id=recipient_user.id,  # type: ignore[arg-type]
        )
        session.add(sr)

    await session.commit()
    await session.refresh(stake)
    stake_read = await _build_stake_read(session, stake)
    await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
    return stake_read


async def add_stake_recipient(
    session: AsyncSession, stake_id: int, user: User, body: StakeRecipientAdd
) -> StakeRead:
    stake = await session.get(Stake, stake_id)
    if stake is None:
        raise HTTPException(status_code=404, detail='Stake not found')
    if stake.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can add recipients')
    if stake.status != StakeStatus.PENDING:
        raise HTTPException(status_code=400, detail='Can only add recipients to a pending stake')

    result = await session.exec(select(StakeRecipient).where(StakeRecipient.stake_id == stake.id))
    existing_rows = result.all()
    existing_recipient_ids = {row.recipient_id for row in existing_rows}

    target_user: User | None = None
    if body.recipient_discord_uid is not None:
        result = await session.exec(select(User).where(User.discord_uid == body.recipient_discord_uid))
        target_user = result.first()
    elif body.recipient_username:
        result = await session.exec(select(User).where(User.username == body.recipient_username.lower()))
        target_user = result.first()

    if target_user is None:
        raise HTTPException(status_code=404, detail='Recipient user not found')
    if target_user.id == user.id:
        raise HTTPException(status_code=400, detail='You cannot add yourself as a recipient')
    if target_user.id in existing_recipient_ids:
        stake_read = await _build_stake_read(session, stake)
        await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
        return stake_read

    session.add(
        StakeRecipient(
            stake_id=stake.id,  # type: ignore[arg-type]
            recipient_id=target_user.id,  # type: ignore[arg-type]
        )
    )
    await session.commit()
    await session.refresh(stake)
    stake_read = await _build_stake_read(session, stake)
    await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
    return stake_read


async def get_stake(session: AsyncSession, stake_id: int, user: User) -> StakeRead:
    stake = await session.get(Stake, stake_id)
    if stake is None:
        raise HTTPException(status_code=404, detail='Stake not found')

    result = await session.exec(select(StakeRecipient).where(StakeRecipient.stake_id == stake.id))
    recipient_ids = [r.recipient_id for r in result.all()]

    if stake.creator_id != user.id and user.id not in recipient_ids:
        raise HTTPException(status_code=403, detail='Not authorized to view this stake')

    return await _build_stake_read(session, stake)


async def list_created_stakes(session: AsyncSession, user: User, status: StakeStatus | None = None) -> list[StakeRead]:
    query = select(Stake).where(Stake.creator_id == user.id)
    if status:
        query = query.where(Stake.status == status)
    query = query.order_by(col(Stake.created_at).desc())

    result = await session.exec(query)
    stakes = result.all()
    return [await _build_stake_read(session, s) for s in stakes]


async def list_received_stakes(session: AsyncSession, user: User) -> list[StakeRead]:
    result = await session.exec(select(StakeRecipient.stake_id).where(StakeRecipient.recipient_id == user.id))
    stake_ids = result.all()
    if not stake_ids:
        return []

    result = await session.exec(
        select(Stake).where(col(Stake.id).in_(stake_ids)).order_by(col(Stake.created_at).desc())
    )
    stakes = result.all()
    return [await _build_stake_read(session, s) for s in stakes]


async def activate_stake(session: AsyncSession, stake_id: int, user: User) -> StakeRead:
    stake = await session.get(Stake, stake_id)
    if stake is None:
        raise HTTPException(status_code=404, detail='Stake not found')
    if stake.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can activate a stake')
    if stake.status != StakeStatus.PENDING:
        raise HTTPException(status_code=400, detail=f'Cannot activate a stake with status "{stake.status}"')

    stake.status = StakeStatus.ACTIVE
    stake.activated_at = datetime.now(UTC)
    session.add(stake)
    await session.commit()
    await session.refresh(stake)
    stake_read = await _build_stake_read(session, stake)
    await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
    return stake_read


async def update_stake(session: AsyncSession, stake_id: int, user: User, body: StakeUpdate) -> StakeRead:
    stake = await session.get(Stake, stake_id)
    if stake is None:
        raise HTTPException(status_code=404, detail='Stake not found')
    if stake.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can update a stake')
    if stake.status != StakeStatus.ACTIVE:
        raise HTTPException(status_code=400, detail='Can only update an active stake')

    if body.distraction_count is not None:
        stake.distraction_count = body.distraction_count
    if body.elapsed_seconds is not None:
        stake.elapsed_seconds = body.elapsed_seconds

    session.add(stake)
    await session.commit()
    await session.refresh(stake)
    stake_read = await _build_stake_read(session, stake)
    await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
    return stake_read


async def resolve_stake(session: AsyncSession, stake_id: int, user: User, body: StakeResolve) -> StakeRead:
    stake = await session.get(Stake, stake_id)
    if stake is None:
        raise HTTPException(status_code=404, detail='Stake not found')
    if stake.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can resolve a stake')
    if stake.status != StakeStatus.ACTIVE:
        raise HTTPException(status_code=400, detail='Can only resolve an active stake')

    stake.resolved_at = datetime.now(UTC)
    stake.elapsed_seconds = body.elapsed_seconds

    if stake.distraction_count < STRIKE_THRESHOLD:
        stake.status = StakeStatus.COMPLETED
        session.add(stake)
        await session.commit()
        await session.refresh(stake)
        stake_read = await _build_stake_read(session, stake)
        await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
        return stake_read

    # FAILED — split amount, charge the creator, transfer to each recipient.
    result = await session.exec(select(StakeRecipient).where(StakeRecipient.stake_id == stake.id))
    recipient_rows = result.all()
    per_person = stake.amount_cents // len(recipient_rows) if recipient_rows else 0
    if per_person < 1:
        stake.status = StakeStatus.FAILED
        session.add(stake)
        await session.commit()
        raise HTTPException(status_code=400, detail='Stake amount too small to distribute across recipients')
    for r in recipient_rows:
        r.payout_cents = per_person
        session.add(r)

    creator = await session.get(User, stake.creator_id)

    if stake.stripe_payment_intent_id is None:
        try:
            intent = await stripe_service.charge_for_stake(
                stake,
                customer_id=creator.stripe_customer_id,
                payment_method_id=creator.stripe_payment_method_id,
            )
        except stripe.CardError as e:
            stake.status = StakeStatus.FAILED
            session.add(stake)
            await session.commit()
            raise HTTPException(status_code=402, detail=f'Card charge failed: {e.user_message or e.code}')

        stake.stripe_payment_intent_id = intent.id

        if intent.status != 'succeeded':
            stake.status = StakeStatus.FAILED
            session.add(stake)
            await session.commit()
            raise HTTPException(status_code=402, detail='Card charge did not succeed; cannot distribute payouts')

        charge_id = intent.latest_charge
        for r in recipient_rows:
            recipient_user = await session.get(User, r.recipient_id)
            if not recipient_user.stripe_account_enabled:
                r.payout_status = PayoutStatus.FAILED
                session.add(r)
                continue
            try:
                transfer = await stripe_service.create_transfer(
                    amount_cents=r.payout_cents,
                    destination_account_id=recipient_user.stripe_account_id,
                    charge_id=charge_id,
                    stake_id=stake.id,
                )
                r.stripe_transfer_id = transfer.id
                r.payout_status = PayoutStatus.PAID
            except stripe.StripeError:
                r.payout_status = PayoutStatus.FAILED
            session.add(r)

    stake.status = StakeStatus.PAID_OUT
    session.add(stake)
    await session.commit()
    await session.refresh(stake)
    stake_read = await _build_stake_read(session, stake)
    await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
    return stake_read


async def report_distraction(
    session: AsyncSession, user: User, body: DistractionReport
) -> StakeRead:
    result = await session.exec(
        select(Stake).where(Stake.creator_id == user.id, Stake.status == StakeStatus.ACTIVE)
    )
    stake = result.first()
    if stake is None:
        raise HTTPException(status_code=404, detail='No active stake found')

    stake.distraction_count += 1
    session.add(stake)
    await session.commit()
    await session.refresh(stake)
    stake_read = await _build_stake_read(session, stake)
    await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
    return stake_read


async def cancel_stake(session: AsyncSession, stake_id: int, user: User) -> StakeRead:
    stake = await session.get(Stake, stake_id)
    if stake is None:
        raise HTTPException(status_code=404, detail='Stake not found')
    if stake.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can cancel a stake')
    if stake.status != StakeStatus.PENDING:
        raise HTTPException(status_code=400, detail='Can only cancel a pending stake')

    stake.status = StakeStatus.CANCELLED
    session.add(stake)
    await session.commit()
    await session.refresh(stake)
    stake_read = await _build_stake_read(session, stake)
    await stake_events.broker.publish(stake_read.id, stake_read.model_dump(mode='json'))
    return stake_read
