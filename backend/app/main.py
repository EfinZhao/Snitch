from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlmodel import SQLModel

from app.api.main import api_router
from app.core.database import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    yield


app = FastAPI(lifespan=lifespan)

app.include_router(api_router, prefix='/api')
