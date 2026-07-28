# auth token api schemas
from pydantic import BaseModel


class Token(BaseModel):
    access_token: str
    token_type: str
    email: str | None = None


class GoogleLogin(BaseModel):
    id_token: str
