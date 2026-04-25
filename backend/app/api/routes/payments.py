import stripe
from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.schemas.payments import ConfirmSetupBody, SetupIntentResponse
from app.services import stripe_service

router = APIRouter()


@router.post('/setup-intent', response_model=SetupIntentResponse)
async def create_setup_intent(user: CurrentUserDep, session: SessionDep):
    customer_id = await stripe_service.ensure_customer(session, user)
    setup_intent = await stripe.SetupIntent.create_async(
        customer=customer_id,
        automatic_payment_methods={'enabled': True},
    )
    return SetupIntentResponse(
        client_secret=setup_intent.client_secret,
        customer_id=customer_id,
    )


@router.post('/confirm-setup')
async def confirm_setup(body: ConfirmSetupBody, user: CurrentUserDep, session: SessionDep):
    """
    Called by the frontend immediately after stripe.confirmSetup() resolves.
    Retrieves the SetupIntent from Stripe, verifies it belongs to this user's
    Customer, then stores the payment method — so we don't depend on the webhook
    arriving before the user continues the onboarding flow.
    """
    si = await stripe.SetupIntent.retrieve_async(body.setup_intent_id)

    if si.customer != user.stripe_customer_id:
        raise HTTPException(status_code=403, detail='Setup intent does not belong to this customer')
    if si.status != 'succeeded':
        raise HTTPException(status_code=400, detail='Setup intent has not succeeded')

    await stripe_service.handle_setup_intent_succeeded(session, si)
    return {'ok': True}
