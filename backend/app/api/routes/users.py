from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import UserCreate, UserRead

router = APIRouter()


@router.post('', response_model=UserRead, status_code=201)
async def create_user(body: UserCreate, session: SessionDep):
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.display_name,
        discord_uid=body.discord_uid,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail='Email or display name already taken')
    await session.refresh(user)
    return UserRead.model_validate(user)


@router.get('/me', response_model=UserRead)
async def get_me(user: CurrentUserDep):
    return UserRead.model_validate(user)
