from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

DOTENV_PATH = Path(__file__).parent.parent.parent / '.env'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=DOTENV_PATH, env_ignore_empty=True, extra='ignore')

    DATABASE_URL: str

    STRIPE_SECRET_KEY: str = ''
    STRIPE_WEBHOOK_SECRET: str = ''

    JWT_SECRET_KEY: str = 'dev-only-change-me'
    JWT_ALGORITHM: str = 'HS256'
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    FRONTEND_BASE_URL: str = 'http://localhost:5173'


settings = Settings()  # type: ignore
