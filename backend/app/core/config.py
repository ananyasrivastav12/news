from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    NEWS_API_KEY: str
    REDIS_URL: str = "redis://redis:6379/0"

    class Config:
        env_file = ".env"


settings = Settings()
