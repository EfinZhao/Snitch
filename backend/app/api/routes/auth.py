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
