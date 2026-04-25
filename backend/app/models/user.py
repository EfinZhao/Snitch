from datetime import UTC, datetime
from enum import StrEnum

from sqlmodel import Column, DateTime, Field, SQLModel


class CreditCardNetwork(StrEnum):
    VISA = 'visa'
    MASTERCARD = 'mastercard'
    AMEX = 'amex'
    DISCOVER = 'discover'
    JCB = 'jcb'
    DINERS = 'diners'
    UNIONPAY = 'unionpay'
    EFTPOS_AU = 'eftpos_au'
    INTERAC = 'interac'
    LINK = 'link'
    UNKNOWN = 'unknown'


class User(SQLModel, table=True):
    # User Identity and Metadata
    id: int | None = Field(default=None, primary_key=True)
    discord_uid: int | None = Field(unique=True, index=True)
    email: str = Field(unique=True)
    hashed_password: str
    username: str = Field(unique=True, index=True)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            onupdate=lambda: datetime.now(UTC),
        ),
    )

    # Stripe Payer Metadata
    stripe_customer_id: str | None = Field(unique=True)
    stripe_payment_method_id: str | None = Field(unique=True)
    payment_method_network: CreditCardNetwork | None
    payment_method_last4: str | None = Field(default=None, max_length=4)

    # Stripe Recipient Metadata
    stripe_account_id: str | None = Field(unique=True)
    stripe_account_enabled: bool = False
