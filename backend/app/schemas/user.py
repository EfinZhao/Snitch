from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models.user import CreditCardNetwork


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    username: str
    discord_uid: int | None = None


class UserRead(BaseModel):
    id: int
    email: str
    username: str
    discord_uid: int | None
    stripe_customer_id: str | None
    stripe_account_id: str | None
    stripe_account_enabled: bool
    payment_method_network: CreditCardNetwork | None
    payment_method_last4: str | None
    created_at: datetime

    model_config = {'from_attributes': True}


class UserSearchResult(BaseModel):
    id: int
    username: str

    model_config = {'from_attributes': True}


class DiscordAccountStatus(BaseModel):
    exists: bool
    user_id: int | None
    payment_method_ready: bool
    payout_ready: bool
