from datetime import UTC, datetime
from enum import StrEnum

from sqlmodel import Column, DateTime, Field, SQLModel


class StakeStatus(StrEnum):
    PENDING = 'pending'
    ACTIVE = 'active'
    COMPLETED = 'completed'
    FAILED = 'failed'
    PAID_OUT = 'paid_out'
    CANCELLED = 'cancelled'


class PayoutStatus(StrEnum):
    PENDING = 'pending'
    PAID = 'paid'
    FAILED = 'failed'


class Stake(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    creator_id: int = Field(foreign_key='user.id', index=True)
    amount_cents: int
    duration_seconds: int
    status: StakeStatus = Field(default=StakeStatus.PENDING)

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

    elapsed_seconds: int | None = None
    distraction_count: int = Field(default=0)


class StakeRecipient(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    stake_id: int = Field(foreign_key='stake.id', index=True)
    recipient_id: int = Field(foreign_key='user.id', index=True)
    payout_cents: int | None = None
    payout_status: PayoutStatus = Field(default=PayoutStatus.PENDING)
