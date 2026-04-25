from fastapi import APIRouter, Query

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.models.stake import StakeStatus
from app.schemas.stake import StakeCreate, StakeRead, StakeResolve, StakeUpdate
from app.services import stake_service

router = APIRouter()


@router.post('', response_model=StakeRead, status_code=201)
async def create_stake(
    body: StakeCreate, session: SessionDep, user: CurrentUserDep
):
    return await stake_service.create_stake(session, user, body)


@router.get('', response_model=list[StakeRead])
async def list_my_stakes(
    session: SessionDep,
    user: CurrentUserDep,
    status: StakeStatus | None = Query(default=None),
):
    return await stake_service.list_created_stakes(session, user, status)


@router.get('/received', response_model=list[StakeRead])
async def list_received_stakes(session: SessionDep, user: CurrentUserDep):
    return await stake_service.list_received_stakes(session, user)


@router.get('/{stake_id}', response_model=StakeRead)
async def get_stake(stake_id: int, session: SessionDep, user: CurrentUserDep):
    return await stake_service.get_stake(session, stake_id, user)


@router.post('/{stake_id}/activate', response_model=StakeRead)
async def activate_stake(stake_id: int, session: SessionDep, user: CurrentUserDep):
    return await stake_service.activate_stake(session, stake_id, user)


@router.patch('/{stake_id}', response_model=StakeRead)
async def update_stake(
    stake_id: int, body: StakeUpdate, session: SessionDep, user: CurrentUserDep
):
    return await stake_service.update_stake(session, stake_id, user, body)


@router.post('/{stake_id}/resolve', response_model=StakeRead)
async def resolve_stake(
    stake_id: int, body: StakeResolve, session: SessionDep, user: CurrentUserDep
):
    return await stake_service.resolve_stake(session, stake_id, user, body)


@router.delete('/{stake_id}', response_model=StakeRead)
async def cancel_stake(stake_id: int, session: SessionDep, user: CurrentUserDep):
    return await stake_service.cancel_stake(session, stake_id, user)
