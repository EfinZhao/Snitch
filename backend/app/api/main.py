from fastapi import APIRouter

from app.api.routes import auth, connect, payments, sessions, users, webhooks

api_router = APIRouter()

api_router.include_router(users.router, prefix='/users', tags=['Users'])
api_router.include_router(auth.router, prefix='/auth', tags=['Auth'])
api_router.include_router(payments.router, prefix='/payments', tags=['Payments'])
api_router.include_router(connect.router, prefix='/connect', tags=['Connect'])
api_router.include_router(sessions.router, prefix='/sessions', tags=['Sessions'])
api_router.include_router(webhooks.router)


@api_router.get('/health', tags=['Health'])
def health_check():
    return {'status': 'healthy'}
