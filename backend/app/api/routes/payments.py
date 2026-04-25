import stripe
from fastapi import APIRouter

from app.api.deps import CurrentUserDep
from app.core.database import SessionDep
from app.schemas.payments import SetupIntentResponse
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
