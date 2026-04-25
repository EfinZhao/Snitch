from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import select

from app.core.database import SessionDep
from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.auth import Token

router = APIRouter()


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

    if user.discord_uid is None:
        raise HTTPException(status_code=400, detail='Discord account is not linked')

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
