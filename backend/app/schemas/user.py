from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    email: EmailStr


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=1024)


class User(UserBase):
    id: int
    model_config = ConfigDict(from_attributes=True)
