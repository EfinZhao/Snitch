from typing import Literal

from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: Literal['bearer'] = 'bearer'


class TokenPayload(BaseModel):
    sub: str
    exp: int


class StakeLaunchTokenCreate(BaseModel):
    stake_id: int


class StakeLaunchTokenRead(BaseModel):
    launch_token: str


class StakeLaunchLoginRequest(BaseModel):
    launch_token: str
