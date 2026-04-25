from pydantic import BaseModel


class SetupIntentResponse(BaseModel):
    client_secret: str
    customer_id: str


class ConfirmSetupBody(BaseModel):
    setup_intent_id: str


class OnboardingLinkResponse(BaseModel):
    url: str


class ConnectStatus(BaseModel):
    account_id: str | None
    charges_enabled: bool
    payouts_enabled: bool
    details_submitted: bool


class LoginLinkResponse(BaseModel):
    url: str
