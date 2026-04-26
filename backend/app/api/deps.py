from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import select

from auth0_api_python import ApiClient, ApiClientOptions
from auth0_api_python.errors import BaseAuthError

from app.core.config import settings
from app.core.database import SessionDep
from app.core.security import decode_access_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl='/api/auth/login', auto_error=False)

_auth0_client: ApiClient | None = None


def _get_auth0_client() -> ApiClient | None:
    global _auth0_client
    if _auth0_client is not None:
        return _auth0_client
    if not settings.AUTH0_DOMAIN or not settings.AUTH0_AUDIENCE:
        return None
    _auth0_client = ApiClient(ApiClientOptions(
        domain=settings.AUTH0_DOMAIN,
        audience=settings.AUTH0_AUDIENCE,
    ))
    return _auth0_client


async def get_current_user(
    request: Request,
    session: SessionDep,
    token: Annotated[str | None, Depends(oauth2_scheme)] = None,
) -> User:
    if not token:
        raise HTTPException(
            status_code=401,
            detail='Not authenticated',
            headers={'WWW-Authenticate': 'Bearer'},
        )

    auth0 = _get_auth0_client()
    if auth0 is not None:
        try:
            claims = await auth0.verify_access_token(token)
            auth0_sub = claims['sub']
            result = await session.exec(select(User).where(User.auth0_sub == auth0_sub))
            user = result.first()
            if user is None:
                email = claims.get('email') or claims.get(f'{settings.AUTH0_AUDIENCE}/email') or f'{auth0_sub}@auth0.placeholder'
                username = claims.get('nickname') or claims.get('name') or auth0_sub.replace('|', '_')
                user = User(
                    auth0_sub=auth0_sub,
                    email=email,
                    username=username,
                )
                session.add(user)
                await session.commit()
                await session.refresh(user)
            return user
        except BaseAuthError:
            pass
        except Exception:
            pass

    # Fallback: legacy HS256 self-signed tokens (Discord bot, launch tokens)
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
