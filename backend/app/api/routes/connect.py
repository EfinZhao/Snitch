import stripe
from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.schemas.payments import ConnectStatus, LoginLinkResponse, OnboardingLinkResponse
from app.services import stripe_service

router = APIRouter()


@router.post('/onboarding-link', response_model=OnboardingLinkResponse)
async def get_onboarding_link(user: CurrentUserDep, session: SessionDep):
    account_id = await stripe_service.ensure_connect_account(session, user)
    url = await stripe_service.create_onboarding_link(account_id)
    return OnboardingLinkResponse(url=url)


@router.get('/status', response_model=ConnectStatus)
async def get_connect_status(user: CurrentUserDep, session: SessionDep):
    if not user.stripe_account_id:
        return ConnectStatus(
            account_id=None,
            charges_enabled=False,
            payouts_enabled=False,
            details_submitted=False,
        )

    account = await stripe.Account.retrieve_async(user.stripe_account_id)
    enabled = account.charges_enabled and account.payouts_enabled
    if user.stripe_account_enabled != enabled:
        user.stripe_account_enabled = enabled
        session.add(user)
        await session.commit()
        await session.refresh(user)

    return ConnectStatus(
        account_id=user.stripe_account_id,
        charges_enabled=account.charges_enabled,
        payouts_enabled=account.payouts_enabled,
        details_submitted=account.details_submitted,
    )


@router.post('/login-link', response_model=LoginLinkResponse)
async def get_login_link(user: CurrentUserDep):
    if not user.stripe_account_id:
        raise HTTPException(status_code=404, detail='No Connect account')
    url = await stripe_service.create_login_link(user.stripe_account_id)
    return LoginLinkResponse(url=url)
