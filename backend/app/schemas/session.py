from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, field_validator, model_validator

from app.models.session import PayoutStatus, SessionStatus


class SessionOutcome(StrEnum):
    COMPLETED = 'completed'
    FAILED = 'failed'


class DistractionReport(BaseModel):
    hostname: str
    url: str


class SessionCreate(BaseModel):
    amount_cents: int
    duration_seconds: int
    recipient_usernames: list[str] = []
    recipient_discord_uids: list[int] = []
    goal_text: str | None = None

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
        if len(v) > 25:
            raise ValueError('maximum of 25 recipients allowed')
        return v

    @field_validator('recipient_discord_uids')
    @classmethod
    def discord_recipients_valid(cls, v: list[int]) -> list[int]:
        if len(v) > 25:
            raise ValueError('maximum of 25 recipients allowed')
        if any(uid <= 0 for uid in v):
            raise ValueError('recipient_discord_uids must contain positive integers')
        return v

    @model_validator(mode='after')
    def at_least_one_recipient(self) -> 'SessionCreate':
        if not self.recipient_usernames and not self.recipient_discord_uids:
            raise ValueError('at least one recipient is required')
        return self


class SessionRecipientAdd(BaseModel):
    recipient_username: str | None = None
    recipient_discord_uid: int | None = None

    @model_validator(mode='after')
    def exactly_one_identifier(self) -> 'SessionRecipientAdd':
        has_username = bool((self.recipient_username or '').strip())
        has_discord_uid = self.recipient_discord_uid is not None
        if has_username == has_discord_uid:
            raise ValueError('provide exactly one of recipient_username or recipient_discord_uid')
        if self.recipient_discord_uid is not None and self.recipient_discord_uid <= 0:
            raise ValueError('recipient_discord_uid must be a positive integer')
        return self


class SessionUpdate(BaseModel):
    distraction_count: int | None = None
    elapsed_seconds: int | None = None


class SessionResolve(BaseModel):
    elapsed_seconds: int


class SessionRecipientRead(BaseModel):
    id: int
    recipient_id: int
    recipient_username: str
    payout_cents: int | None
    payout_status: PayoutStatus

    model_config = {'from_attributes': True}


class ClassifyRequest(BaseModel):
    domain: str
    page_title: str
    page_text: str | None = None


class ClassifyResponse(BaseModel):
    block: bool
    reason: str = ""


class SessionRead(BaseModel):
    id: int
    creator_id: int
    creator_username: str
    amount_cents: int
    duration_seconds: int
    status: SessionStatus
    created_at: datetime
    activated_at: datetime | None
    resolved_at: datetime | None
    elapsed_seconds: int | None
    distraction_count: int
    goal_text: str | None
    recipients: list[SessionRecipientRead]

    model_config = {'from_attributes': True}
