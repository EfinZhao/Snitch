from datetime import UTC, datetime

from fastapi import HTTPException
from sqlmodel import col, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.stake import PayoutStatus, Stake, StakeRecipient, StakeStatus
from app.models.user import User
from app.schemas.stake import (
    StakeCreate,
    StakeOutcome,
    StakeRead,
    StakeRecipientRead,
    StakeResolve,
    StakeUpdate,
)


async def _build_stake_read(session: AsyncSession, stake: Stake) -> StakeRead:
    creator = await session.get(User, stake.creator_id)

    result = await session.exec(
        select(StakeRecipient).where(StakeRecipient.stake_id == stake.id)
    )
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


async def create_stake(
    session: AsyncSession, creator: User, body: StakeCreate
) -> StakeRead:
    if not creator.stripe_payment_method_id:
        raise HTTPException(
            status_code=400,
            detail='You must have a saved payment method before creating a stake',
        )

    usernames = [u.lower() for u in body.recipient_usernames]
    if creator.username.lower() in usernames:
        raise HTTPException(status_code=400, detail='You cannot add yourself as a recipient')

    result = await session.exec(
        select(User).where(col(User.username).in_(usernames))
    )
    found_users = result.all()
    found_map = {u.username.lower(): u for u in found_users}

    missing = [u for u in usernames if u not in found_map]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f'Users not found: {", ".join(missing)}',
        )

    stake = Stake(
        creator_id=creator.id,  # type: ignore[arg-type]
        amount_cents=body.amount_cents,
        duration_seconds=body.duration_seconds,
    )
    session.add(stake)
    await session.flush()

    for username in usernames:
        recipient_user = found_map[username]
        sr = StakeRecipient(
            stake_id=stake.id,  # type: ignore[arg-type]
            recipient_id=recipient_user.id,  # type: ignore[arg-type]
        )
        session.add(sr)

    await session.commit()
    await session.refresh(stake)
    return await _build_stake_read(session, stake)


async def get_stake(session: AsyncSession, stake_id: int, user: User) -> StakeRead:
    stake = await session.get(Stake, stake_id)
    if stake is None:
        raise HTTPException(status_code=404, detail='Stake not found')

    result = await session.exec(
        select(StakeRecipient).where(StakeRecipient.stake_id == stake.id)
    )
    recipient_ids = [r.recipient_id for r in result.all()]

    if stake.creator_id != user.id and user.id not in recipient_ids:
        raise HTTPException(status_code=403, detail='Not authorized to view this stake')

    return await _build_stake_read(session, stake)


async def list_created_stakes(
    session: AsyncSession, user: User, status: StakeStatus | None = None
) -> list[StakeRead]:
    query = select(Stake).where(Stake.creator_id == user.id)
    if status:
        query = query.where(Stake.status == status)
    query = query.order_by(col(Stake.created_at).desc())

    result = await session.exec(query)
    stakes = result.all()
    return [await _build_stake_read(session, s) for s in stakes]


async def list_received_stakes(session: AsyncSession, user: User) -> list[StakeRead]:
    result = await session.exec(
        select(StakeRecipient.stake_id).where(StakeRecipient.recipient_id == user.id)
    )
    stake_ids = result.all()
    if not stake_ids:
        return []

    result = await session.exec(
        select(Stake)
        .where(col(Stake.id).in_(stake_ids))
        .order_by(col(Stake.created_at).desc())
    )
    stakes = result.all()
    return [await _build_stake_read(session, s) for s in stakes]


async def activate_stake(
    session: AsyncSession, stake_id: int, user: User
) -> StakeRead:
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
    return await _build_stake_read(session, stake)


async def update_stake(
    session: AsyncSession, stake_id: int, user: User, body: StakeUpdate
) -> StakeRead:
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
    return await _build_stake_read(session, stake)


async def resolve_stake(
    session: AsyncSession, stake_id: int, user: User, body: StakeResolve
) -> StakeRead:
    stake = await session.get(Stake, stake_id)
    if stake is None:
        raise HTTPException(status_code=404, detail='Stake not found')
    if stake.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the creator can resolve a stake')
    if stake.status != StakeStatus.ACTIVE:
        raise HTTPException(status_code=400, detail='Can only resolve an active stake')

    now = datetime.now(UTC)
    stake.resolved_at = now
    stake.elapsed_seconds = body.elapsed_seconds

    if body.outcome == StakeOutcome.COMPLETED:
        stake.status = StakeStatus.COMPLETED
    elif body.outcome == StakeOutcome.FAILED:
        stake.status = StakeStatus.FAILED

        result = await session.exec(
            select(StakeRecipient).where(StakeRecipient.stake_id == stake.id)
        )
        recipients = result.all()
        per_person = stake.amount_cents // len(recipients) if recipients else 0

        for r in recipients:
            r.payout_cents = per_person
            session.add(r)

        # TODO: trigger Stripe payout transfers here

    session.add(stake)
    await session.commit()
    await session.refresh(stake)
    return await _build_stake_read(session, stake)


async def cancel_stake(
    session: AsyncSession, stake_id: int, user: User
) -> StakeRead:
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
    return await _build_stake_read(session, stake)
