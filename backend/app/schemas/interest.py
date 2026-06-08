# In app/schemas/interest.py

from pydantic import BaseModel, ConfigDict

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

    model_config = ConfigDict(from_attributes=True)
