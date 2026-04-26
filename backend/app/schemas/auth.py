from typing import Literal

from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: Literal['bearer'] = 'bearer'


class TokenPayload(BaseModel):
    sub: str
    exp: int


class SessionLaunchTokenCreate(BaseModel):
    session_id: int


class SessionLaunchTokenRead(BaseModel):
    launch_token: str


class SessionLaunchLoginRequest(BaseModel):
    launch_token: str
