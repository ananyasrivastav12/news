# app/core/config.py
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = Field(validation_alias="DATABASE_URL")
    SECRET_KEY: str = Field(validation_alias="SECRET_KEY")
    ALGORITHM: str = Field(default="HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=30)

    NEWS_API_KEY: str = Field(validation_alias="NEWS_API_KEY")
    NEWS_API_BASE_URL: str = Field(default="https://newsapi.org/v2")
    NEWS_API_COUNTRY: str = Field(default="us")
    NEWS_API_PAGE_SIZE: int = Field(default=100)
    NEWS_DAILY_ARTICLE_TARGET: int = Field(default=250)
    ARTICLE_POOL_LIMIT: int = Field(default=500)
    NEWS_BATCH_CATEGORIES: str = Field(
        default="business,technology,health,sports,entertainment,science,general"
    )
    ARTICLE_MAX_AGE_HOURS: int = Field(default=168)
    MIN_ARTICLE_TEXT_LENGTH: int = Field(default=60)
    FEED_SIZE: int = Field(default=12)
    FEED_EXPLORATION_RATIO: float = Field(default=0.25)
    MAX_FEED_ITEMS: int = Field(default=500)
    MORNING_FEED_HOUR: int = Field(default=7)
    MORNING_FEED_MINUTE: int = Field(default=0)

    OPENAI_API_KEY: str | None = Field(default=None)
    OPENAI_MODEL: str = Field(default="gpt-4.1-mini")
    OPENAI_EMBEDDING_MODEL: str = Field(default="text-embedding-3-small")

    REDIS_URL: str = Field(default="redis://redis:6379/0")
    BACKEND_CORS_ORIGINS: str = Field(default="*")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        if self.BACKEND_CORS_ORIGINS == "*":
            return ["*"]
        return [
            origin.strip()
            for origin in self.BACKEND_CORS_ORIGINS.split(",")
            if origin.strip()
        ]


settings = Settings()
