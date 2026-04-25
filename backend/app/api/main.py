from fastapi import APIRouter

api_router = APIRouter()


@api_router.get('/health', tags=['Health'])
def health_check():
    return {'status': 'healthy'}
