from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.db.model import InteractionType


class SummaryOut(BaseModel):
    main_takeaway: str
    supporting_lines: list[str]

    model_config = ConfigDict(from_attributes=True)


class FeedArticle(BaseModel):
    id: int
    title: str
    source: str | None
    country: str
    url: str = Field(alias="original_url")
    published_at: datetime | None
    primary_category: str
    image_url: str | None
    keywords: list[str]
    summary: SummaryOut

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class FeedItem(BaseModel):
    id: int
    feed_date: date
    rank_position: int
    ranking_score: float
    ranking_reason: str | None
    is_viewed: bool
    article: FeedArticle

    model_config = ConfigDict(from_attributes=True)


class InteractionCreate(BaseModel):
    article_id: int
    interaction_type: InteractionType
    dwell_time_seconds: int | None = Field(default=None, ge=0)


class InteractionOut(BaseModel):
    id: int
    article_id: int
    interaction_type: InteractionType
    dwell_time_seconds: int | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
