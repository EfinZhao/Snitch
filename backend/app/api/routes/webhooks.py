import stripe
from fastapi import APIRouter, HTTPException, Request

from app.core.config import settings
from app.core.database import SessionDep
from app.services import stripe_service

router = APIRouter()


@router.post('/webhooks/stripe', include_in_schema=False)
async def stripe_webhook(request: Request, session: SessionDep):
    payload = await request.body()
    sig = request.headers.get('stripe-signature', '')
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail='Invalid webhook signature')

    event_type = event['type']
    data = event['data']['object']

    if event_type == 'setup_intent.succeeded':
        await stripe_service.handle_setup_intent_succeeded(session, data)
    elif event_type == 'account.updated':
        await stripe_service.handle_account_updated(session, data)

    return {'received': True}
