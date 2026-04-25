from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import settings
from app.models import *  # noqa: F403

engine = create_async_engine(settings.DATABASE_URL)


async def get_session():
    async with AsyncSession(engine) as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]
