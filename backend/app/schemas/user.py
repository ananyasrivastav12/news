from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    email: EmailStr


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=1024)


class User(UserBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


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
