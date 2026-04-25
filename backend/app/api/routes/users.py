from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import DiscordAccountStatus, UserCreate, UserRead, UserSearchResult

router = APIRouter()


@router.post('', response_model=UserRead, status_code=201)
async def create_user(body: UserCreate, session: SessionDep):
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        username=body.username,
        discord_uid=body.discord_uid,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail='Email or username already taken')
    await session.refresh(user)
    return UserRead.model_validate(user)


@router.get('/me', response_model=UserRead)
async def get_me(user: CurrentUserDep):
    return UserRead.model_validate(user)


@router.get('/discord/{discord_uid}', response_model=DiscordAccountStatus)
async def get_discord_account_status(discord_uid: int, session: SessionDep):
    result = await session.exec(select(User).where(User.discord_uid == discord_uid))
    user = result.first()
    if user is None:
        return DiscordAccountStatus(exists=False, user_id=None, payment_method_ready=False, payout_ready=False)
    return DiscordAccountStatus(
        exists=True,
        user_id=user.id,
        payment_method_ready=user.stripe_payment_method_id is not None,
        payout_ready=user.stripe_account_enabled,
    )


@router.get('/search', response_model=list[UserSearchResult])
async def search_users(
    session: SessionDep,
    user: CurrentUserDep,
    q: str = Query(min_length=1, max_length=50),
):
    result = await session.exec(
        select(User).where(col(User.username).startswith(q.lower())).where(User.id != user.id).limit(10)
    )
    return [UserSearchResult.model_validate(u) for u in result.all()]
