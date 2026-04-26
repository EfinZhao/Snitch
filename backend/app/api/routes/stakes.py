import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.models.stake import StakeStatus
from app.schemas.stake import (
    DistractionReport,
    StakeCreate,
    StakeRead,
    StakeRecipientAdd,
    StakeResolve,
    StakeUpdate,
)
from app.services import stake_events, stake_service

router = APIRouter()


@router.post('', response_model=StakeRead, status_code=201)
async def create_stake(body: StakeCreate, session: SessionDep, user: CurrentUserDep):
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


@router.post('/report-distraction', response_model=StakeRead)
async def report_distraction(body: DistractionReport, session: SessionDep, user: CurrentUserDep):
    return await stake_service.report_distraction(session, user, body)


@router.get('/{stake_id}', response_model=StakeRead)
async def get_stake(stake_id: int, session: SessionDep, user: CurrentUserDep):
    return await stake_service.get_stake(session, stake_id, user)


@router.post('/{stake_id}/activate', response_model=StakeRead)
async def activate_stake(stake_id: int, session: SessionDep, user: CurrentUserDep):
    return await stake_service.activate_stake(session, stake_id, user)


@router.get('/{stake_id}/events')
async def stream_stake_events(stake_id: int, request: Request, session: SessionDep, user: CurrentUserDep):
    queue = await stake_events.broker.subscribe(stake_id)
    initial = await stake_service.get_stake(session, stake_id, user)

    async def event_generator():
        try:
            yield f"data: {json.dumps(initial.model_dump(mode='json'))}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=20)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    # Keep the connection alive when no stake updates are emitted.
                    yield ": keep-alive\n\n"
        finally:
            await stake_events.broker.unsubscribe(stake_id, queue)

    return StreamingResponse(event_generator(), media_type='text/event-stream')


@router.post('/{stake_id}/recipients', response_model=StakeRead)
async def add_recipient(stake_id: int, body: StakeRecipientAdd, session: SessionDep, user: CurrentUserDep):
    return await stake_service.add_stake_recipient(session, stake_id, user, body)


@router.patch('/{stake_id}', response_model=StakeRead)
async def update_stake(stake_id: int, body: StakeUpdate, session: SessionDep, user: CurrentUserDep):
    return await stake_service.update_stake(session, stake_id, user, body)


@router.post('/{stake_id}/resolve', response_model=StakeRead)
async def resolve_stake(stake_id: int, body: StakeResolve, session: SessionDep, user: CurrentUserDep):
    return await stake_service.resolve_stake(session, stake_id, user, body)


@router.delete('/{stake_id}', response_model=StakeRead)
async def cancel_stake(stake_id: int, session: SessionDep, user: CurrentUserDep):
    return await stake_service.cancel_stake(session, stake_id, user)
