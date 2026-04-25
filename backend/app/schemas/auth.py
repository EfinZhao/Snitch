from typing import Literal

from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: Literal['bearer'] = 'bearer'


class TokenPayload(BaseModel):
    sub: str
    exp: int
