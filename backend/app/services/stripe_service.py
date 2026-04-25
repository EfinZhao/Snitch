import stripe
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.models.user import CreditCardNetwork, User


async def ensure_customer(session: AsyncSession, user: User) -> str:
    if user.stripe_customer_id:
        return user.stripe_customer_id
    customer = await stripe.Customer.create_async(
        email=user.email,
        metadata={'user_id': str(user.id)},
    )
    user.stripe_customer_id = customer.id
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return customer.id


async def ensure_connect_account(session: AsyncSession, user: User) -> str:
    if user.stripe_account_id:
        return user.stripe_account_id
    account = await stripe.Account.create_async(
        type='express',
        country='US',
        email=user.email,
        capabilities={
            'card_payments': {'requested': True},
            'transfers': {'requested': True},
        },
        metadata={'user_id': str(user.id)},
    )
    user.stripe_account_id = account.id
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return account.id


async def create_onboarding_link(account_id: str) -> str:
    link = await stripe.AccountLink.create_async(
        account=account_id,
        type='account_onboarding',
        refresh_url=f'{settings.FRONTEND_BASE_URL}/connect/refresh',
        return_url=f'{settings.FRONTEND_BASE_URL}/connect/return',
    )
    return link.url


async def handle_setup_intent_succeeded(session: AsyncSession, setup_intent: dict) -> None:
    customer_id = setup_intent.get('customer')
    payment_method_id = setup_intent.get('payment_method')
    if not customer_id or not payment_method_id:
        return

    result = await session.exec(select(User).where(User.stripe_customer_id == customer_id))
    user = result.first()
    if user is None:
        return

    pm = await stripe.PaymentMethod.retrieve_async(payment_method_id)
    brand = pm.card.brand if pm.card else 'unknown'
    try:
        network = CreditCardNetwork(brand)
    except ValueError:
        network = CreditCardNetwork.UNKNOWN

    user.stripe_payment_method_id = pm.id
    user.payment_method_network = network
    user.payment_method_last4 = pm.card.last4 if pm.card else None

    session.add(user)
    await session.commit()

    await stripe.Customer.modify_async(
        customer_id,
        invoice_settings={'default_payment_method': pm.id},
    )


async def handle_account_updated(session: AsyncSession, account: dict) -> None:
    account_id = account.get('id')
    if not account_id:
        return

    result = await session.exec(select(User).where(User.stripe_account_id == account_id))
    user = result.first()
    if user is None:
        return

    user.stripe_account_enabled = account.get('charges_enabled', False) and account.get('payouts_enabled', False)
    session.add(user)
    await session.commit()
