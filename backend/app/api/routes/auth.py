from datetime import UTC, datetime, timedelta
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import select

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.core.security import create_access_token, decode_access_token, verify_password
from app.models.session import Session
from app.models.user import User
from app.schemas.auth import SessionLaunchLoginRequest, SessionLaunchTokenCreate, SessionLaunchTokenRead, Token

router = APIRouter()
_session_launch_token_expiry_by_jti: dict[str, datetime] = {}


def _cleanup_expired_session_launch_tokens() -> None:
    now = datetime.now(UTC)
    expired = [jti for jti, exp in _session_launch_token_expiry_by_jti.items() if exp <= now]
    for jti in expired:
        _session_launch_token_expiry_by_jti.pop(jti, None)


@router.post('/login', response_model=Token)
async def login(
    session: SessionDep,
    form: OAuth2PasswordRequestForm = Depends(),
):
    result = await session.exec(select(User).where(User.email == form.username))
    user = result.first()
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail='Incorrect email or password',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    return Token(access_token=create_access_token(user.id))


@router.post('/discord-login/{discord_uid}', response_model=Token)
async def discord_login(discord_uid: int, session: SessionDep):
    """
    Issues a JWT for a user linked to the provided Discord ID.

    This endpoint is used by the Discord bot auth flow, and enforces that
    Discord linkage and Stripe setup are complete before API access is granted.
    """
    result = await session.exec(select(User).where(User.discord_uid == discord_uid))
    user = result.first()

    if user is None:
        raise HTTPException(status_code=404, detail='No Snitch account linked to this Discord user')

    if user.stripe_customer_id is None or user.stripe_payment_method_id is None:
        raise HTTPException(
            status_code=400,
            detail='Stripe payment setup incomplete. Add a payment method in the Snitch app first.',
        )

    if user.stripe_account_id is None or not user.stripe_account_enabled:
        raise HTTPException(
            status_code=400,
            detail='Stripe payout setup incomplete. Complete Connect onboarding in the Snitch app first.',
        )

    return Token(access_token=create_access_token(user.id))


@router.post('/session-launch-token', response_model=SessionLaunchTokenRead)
async def create_session_launch_token(body: SessionLaunchTokenCreate, session: SessionDep, user: CurrentUserDep):
    session = await session.get(Session, body.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail='Session not found')
    if session.creator_id != user.id:
        raise HTTPException(status_code=403, detail='Only the session creator can request a launch token')

    _cleanup_expired_session_launch_tokens()
    expires_at = datetime.now(UTC) + timedelta(minutes=5)
    jti = token_urlsafe(24)
    _session_launch_token_expiry_by_jti[jti] = expires_at
    launch_token = create_access_token(
        subject=user.id,
        expires_delta=timedelta(minutes=5),
        extra_claims={
            'type': 'session_launch',
            'session_id': body.session_id,
            'jti': jti,
        },
    )
    return SessionLaunchTokenRead(launch_token=launch_token)


@router.post('/launch-login', response_model=Token)
async def launch_login(body: SessionLaunchLoginRequest):
    _cleanup_expired_session_launch_tokens()
    try:
        payload = decode_access_token(body.launch_token)
    except Exception:
        raise HTTPException(status_code=401, detail='Invalid or expired launch token')

    if payload.get('type') != 'session_launch':
        raise HTTPException(status_code=401, detail='Invalid launch token type')

    subject = payload.get('sub')
    jti = payload.get('jti')
    if subject is None or jti is None:
        raise HTTPException(status_code=401, detail='Malformed launch token')

    expires_at = _session_launch_token_expiry_by_jti.get(str(jti))
    if expires_at is None or expires_at <= datetime.now(UTC):
        _session_launch_token_expiry_by_jti.pop(str(jti), None)
        raise HTTPException(status_code=401, detail='Launch token already used or expired')

    _session_launch_token_expiry_by_jti.pop(str(jti), None)
    return Token(access_token=create_access_token(subject))
