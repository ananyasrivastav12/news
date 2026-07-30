# user api schemas
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    email: EmailStr


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=1024)


class User(UserBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


# interaction totals shown on profile
class ProfileSignalCounts(BaseModel):
    viewed: int
    liked: int
    disliked: int
    saved: int
    clicked: int


class FeedProfileStats(BaseModel):
    total: int
    unread: int
    explicit_interest_matches: int


class ProfileSummary(BaseModel):
    interests: list[str]
    signal_counts: ProfileSignalCounts
    today_feed: FeedProfileStats


class SupportMessageCreate(BaseModel):
    subject: str | None = Field(default=None, max_length=120)
    message: str = Field(min_length=1, max_length=2000)


class SupportMessageOut(BaseModel):
    id: int
    subject: str | None = None
    message: str
    status: str
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=8, max_length=1024)


class AccountDelete(BaseModel):
    password: str = Field(min_length=1, max_length=1024)
