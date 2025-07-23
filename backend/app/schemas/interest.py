# In app/schemas/interest.py

from pydantic import BaseModel

from app.db.model import SourceType


# Shared properties
class InterestBase(BaseModel):
    name: str
    source_type: SourceType


# Properties to receive on creation
class InterestCreate(InterestBase):
    pass


# Properties to return to client
class Interest(InterestBase):
    id: int

    class Config:
        from_attributes = True  # Replaces orm_mode
