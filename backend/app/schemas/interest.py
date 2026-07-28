# interest api schemas
from pydantic import BaseModel, ConfigDict

from app.db.model import SourceType


# interest options users pick for personalization
class InterestBase(BaseModel):
    name: str
    source_type: SourceType


class InterestCreate(InterestBase):
    pass


class Interest(InterestBase):
    id: int

    model_config = ConfigDict(from_attributes=True)
