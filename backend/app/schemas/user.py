# app/schemas/user.py

from pydantic import BaseModel, EmailStr


# Shared properties
class UserBase(BaseModel):
    email: EmailStr


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str


# Properties to return to client
class User(UserBase):
    id: int

    class Config:
        from_attributes = True
