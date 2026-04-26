import asyncio
import json

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.models.session import SessionStatus
from app.schemas.session import (
    ClassifyRequest,
    ClassifyResponse,
    DistractionReport,
    SessionCreate,
    SessionRead,
    SessionRecipientAdd,
    SessionResolve,
    SessionUpdate,
)
from app.services import session_events, session_service

router = APIRouter()


@router.post("", response_model=SessionRead, status_code=201)
async def create_session(
    body: SessionCreate, session: SessionDep, user: CurrentUserDep
):
    return await session_service.create_session(session, user, body)


@router.get("", response_model=list[SessionRead])
async def list_my_sessions(
    session: SessionDep,
    user: CurrentUserDep,
    status: SessionStatus | None = Query(default=None),
):
    return await session_service.list_created_sessions(session, user, status)


@router.get("/received", response_model=list[SessionRead])
async def list_received_sessions(session: SessionDep, user: CurrentUserDep):
    return await session_service.list_received_sessions(session, user)


@router.post("/report-distraction", response_model=SessionRead)
async def report_distraction(
    body: DistractionReport, session: SessionDep, user: CurrentUserDep
):
    return await session_service.report_distraction(session, user, body)


@router.get("/debug/test-gemini")
async def test_gemini():
    """Debug endpoint to test Gemini API connectivity."""
    try:
        from app.services.session_service import _get_gemini
        from google.genai import types

        client = _get_gemini()
        response = client.models.generate_content(
            model="gemini-1.5-flash",
            contents='Reply with just "OK".',
            config=types.GenerateContentConfig(max_output_tokens=5),
        )
        return {"status": "success", "response": response.text}
    except Exception as e:
        return {"status": "error", "error": str(e), "type": type(e).__name__}


@router.get("/{session_id}", response_model=SessionRead)
async def get_session(session_id: int, session: SessionDep, user: CurrentUserDep):
    return await session_service.get_session(session, session_id, user)


@router.post("/{session_id}/activate", response_model=SessionRead)
async def activate_session(session_id: int, session: SessionDep, user: CurrentUserDep):
    return await session_service.activate_session(session, session_id, user)


@router.get("/{session_id}/events")
async def stream_session_events(
    session_id: int, request: Request, session: SessionDep, user: CurrentUserDep
):
    queue = await session_events.broker.subscribe(session_id)
    initial = await session_service.get_session(session, session_id, user)

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
                    # Keep the connection alive when no session updates are emitted.
                    yield ": keep-alive\n\n"
        finally:
            await session_events.broker.unsubscribe(session_id, queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/{session_id}/recipients", response_model=SessionRead)
async def add_recipient(
    session_id: int,
    body: SessionRecipientAdd,
    session: SessionDep,
    user: CurrentUserDep,
):
    return await session_service.add_session_recipient(session, session_id, user, body)


@router.patch("/{session_id}", response_model=SessionRead)
async def update_session(
    session_id: int, body: SessionUpdate, session: SessionDep, user: CurrentUserDep
):
    return await session_service.update_session(session, session_id, user, body)


@router.post("/{session_id}/resolve", response_model=SessionRead)
async def resolve_session(
    session_id: int, body: SessionResolve, session: SessionDep, user: CurrentUserDep
):
    return await session_service.resolve_session(session, session_id, user, body)


@router.post("/{session_id}/classify", response_model=ClassifyResponse)
async def classify_domain(
    session_id: int, body: ClassifyRequest, session: SessionDep, user: CurrentUserDep
):
    return await session_service.classify_domain(
        session, session_id, user, body.domain, body.page_title, body.page_text
    )


@router.delete("/{session_id}", response_model=SessionRead)
async def cancel_session(session_id: int, session: SessionDep, user: CurrentUserDep):
    return await session_service.cancel_session(session, session_id, user)
