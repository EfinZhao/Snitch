from datetime import datetime

from pydantic import BaseModel, EmailStr

from app.models.user import CreditCardNetwork


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    display_name: str
    discord_uid: int | None = None


class UserRead(BaseModel):
    id: int
    email: str
    display_name: str
    discord_uid: int | None
    stripe_customer_id: str | None
    stripe_account_id: str | None
    stripe_account_enabled: bool
    payment_method_network: CreditCardNetwork | None
    payment_method_last4: str | None
    created_at: datetime

    model_config = {'from_attributes': True}
