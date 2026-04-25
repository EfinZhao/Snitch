from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

from app.core.database import SessionDep
from app.core.security import decode_access_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl='/api/auth/login')


async def get_current_user(
    session: SessionDep,
    token: Annotated[str, Depends(oauth2_scheme)],
) -> User:
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=401,
            detail='Invalid or expired token',
            headers={'WWW-Authenticate': 'Bearer'},
        )
    user = await session.get(User, int(payload['sub']))
    if user is None:
        raise HTTPException(status_code=401, detail='User not found')
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]
