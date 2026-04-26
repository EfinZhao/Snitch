from datetime import UTC, datetime
from enum import StrEnum

from sqlmodel import Column, DateTime, Field, SQLModel

STRIKE_THRESHOLD = 3


class SessionStatus(StrEnum):
    PENDING = 'pending'
    ACTIVE = 'active'
    COMPLETED = 'completed'
    FAILED = 'failed'
    PAID_OUT = 'paid_out'
    CANCELLED = 'cancelled'


class PayoutStatus(StrEnum):
    PENDING = 'pending'
    CANCELED = 'canceled'
    PAID = 'paid'
    FAILED = 'failed'


class Session(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    creator_id: int = Field(foreign_key='user.id', index=True)
    amount_cents: int
    duration_seconds: int
    status: SessionStatus = Field(default=SessionStatus.PENDING)

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    activated_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    resolved_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )

    elapsed_seconds: int | None = Field(default=None)
    distraction_count: int = Field(default=0)
    stripe_payment_intent_id: str | None = Field(default=None, unique=True)
    goal_text: str | None = Field(default=None)


class SessionRecipient(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(foreign_key='session.id', index=True)
    recipient_id: int = Field(foreign_key='user.id', index=True)
    payout_cents: int | None = None
    payout_status: PayoutStatus = Field(default=PayoutStatus.PENDING)
    stripe_transfer_id: str | None = Field(default=None, unique=True)
