from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, field_validator

from app.models.stake import PayoutStatus, StakeStatus


class StakeOutcome(StrEnum):
    COMPLETED = 'completed'
    FAILED = 'failed'


class StakeCreate(BaseModel):
    amount_cents: int
    duration_seconds: int
    recipient_usernames: list[str]

    @field_validator('amount_cents')
    @classmethod
    def amount_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError('amount_cents must be positive')
        return v

    @field_validator('duration_seconds')
    @classmethod
    def duration_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError('duration_seconds must be positive')
        return v

    @field_validator('recipient_usernames')
    @classmethod
    def recipients_bounded(cls, v: list[str]) -> list[str]:
        if len(v) == 0:
            raise ValueError('at least one recipient is required')
        if len(v) > 5:
            raise ValueError('maximum of 5 recipients allowed')
        return v


class StakeUpdate(BaseModel):
    distraction_count: int | None = None
    elapsed_seconds: int | None = None


class StakeResolve(BaseModel):
    outcome: StakeOutcome
    elapsed_seconds: int


class StakeRecipientRead(BaseModel):
    id: int
    recipient_id: int
    recipient_username: str
    payout_cents: int | None
    payout_status: PayoutStatus

    model_config = {'from_attributes': True}


class StakeRead(BaseModel):
    id: int
    creator_id: int
    creator_username: str
    amount_cents: int
    duration_seconds: int
    status: StakeStatus
    created_at: datetime
    activated_at: datetime | None
    resolved_at: datetime | None
    elapsed_seconds: int | None
    distraction_count: int
    recipients: list[StakeRecipientRead]

    model_config = {'from_attributes': True}
