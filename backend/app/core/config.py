from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

DOTENV_PATH = Path(__file__).parent.parent.parent / '.env'


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=DOTENV_PATH, env_ignore_empty=True, extra='ignore')

    DATABASE_URL: str


settings = Settings()  # type: ignore
