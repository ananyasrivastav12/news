# backend settings loaded from environment variables
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
    NEWS_API_COUNTRIES: str = Field(default="us,in")
    NEWS_API_PAGE_SIZE: int = Field(default=100)
    NEWS_DAILY_ARTICLE_TARGET: int = Field(default=400)
    ARTICLE_POOL_LIMIT: int = Field(default=1200)
    NEWS_BATCH_CATEGORIES: str = Field(
        default="business,technology,health,sports,entertainment,science,general"
    )
    ARTICLE_MAX_AGE_HOURS: int = Field(default=168)
    FEED_PRIMARY_MAX_AGE_HOURS: int = Field(default=36)
    MIN_ARTICLE_TEXT_LENGTH: int = Field(default=60)
    FEED_SIZE: int = Field(default=50)
    FEED_EDITION_SIZE: int = Field(default=100)
    FEED_EXPLORATION_RATIO: float = Field(default=0.25)
    MAX_FEED_ITEMS: int = Field(default=500)
    MORNING_FEED_HOUR: int = Field(default=7)
    MORNING_FEED_MINUTE: int = Field(default=0)
    MIDDAY_FEED_HOUR: int = Field(default=16)
    MIDDAY_FEED_MINUTE: int = Field(default=0)
    DIGEST_FEED_HOUR: int = Field(default=21)
    DIGEST_FEED_MINUTE: int = Field(default=0)
    FEED_MARKET_TIMEZONES: str = Field(default="America/New_York,Asia/Kolkata")

    OPENAI_API_KEY: str | None = Field(default=None)
    OPENAI_MODEL: str = Field(default="gpt-4.1-mini")
    OPENAI_EMBEDDING_MODEL: str = Field(default="text-embedding-3-small")
    OPENAI_DAILY_SUMMARY_LIMIT: int = Field(default=400)

    GOOGLE_CLIENT_IDS: str = Field(default="")
    ADMIN_EMAILS: str = Field(default="")
    ADMIN_BOOTSTRAP_EMAIL: str = Field(default="")
    ADMIN_BOOTSTRAP_PASSWORD: str = Field(default="")
    ENABLE_PUBLIC_SIGNUP: bool = Field(default=False)

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

    @property
    def google_client_ids(self) -> list[str]:
        return [
            client_id.strip()
            for client_id in self.GOOGLE_CLIENT_IDS.split(",")
            if client_id.strip()
        ]

    @property
    def admin_emails(self) -> set[str]:
        configured = {
            email.strip().lower()
            for email in self.ADMIN_EMAILS.split(",")
            if email.strip()
        }
        if self.ADMIN_BOOTSTRAP_EMAIL.strip():
            configured.add(self.ADMIN_BOOTSTRAP_EMAIL.strip().lower())
        return configured

    @property
    def news_api_countries(self) -> list[str]:
        configured = [
            country.strip().lower()
            for country in self.NEWS_API_COUNTRIES.split(",")
            if country.strip()
        ]
        if configured:
            return configured
        return [self.NEWS_API_COUNTRY.lower()]

    @property
    def feed_market_timezones(self) -> list[str]:
        return [
            timezone.strip()
            for timezone in self.FEED_MARKET_TIMEZONES.split(",")
            if timezone.strip()
        ]

    @property
    def feed_edition_size(self) -> int:
        return max(1, self.FEED_EDITION_SIZE)


settings = Settings()
