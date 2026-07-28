# feed and interaction api schemas
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.model import InteractionType
from app.services.summarizer import ArticleSummarizer


# card copy returned to the mobile feed
class SummaryOut(BaseModel):
    display_headline: str | None = None
    main_takeaway: str
    supporting_lines: list[str]
    summary_text: str | None = None
    why_it_matters: str | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_validator("display_headline")
    @classmethod
    def display_headline_fits_card(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return ArticleSummarizer()._fit_headline(value)

    @field_validator("main_takeaway")
    @classmethod
    def display_complete_sentences(cls, value: str) -> str:
        return ArticleSummarizer._fit_paragraph(
            ArticleSummarizer._drop_truncated_sentences(value),
            max_chars=ArticleSummarizer.SUMMARY_MAX_CHARS,
            max_lines=ArticleSummarizer.SUMMARY_MAX_LINES,
        )

    @field_validator("why_it_matters")
    @classmethod
    def why_it_matters_complete(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return ArticleSummarizer()._fit_why_it_matters(value) or None


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


# one persisted card in a user's edition
class FeedItem(BaseModel):
    id: int
    feed_date: date
    edition_type: str
    market_timezone: str
    rank_position: int
    ranking_score: float
    ranking_reason: str | None
    is_viewed: bool
    article: FeedArticle

    model_config = ConfigDict(from_attributes=True)


class FeedEditionOut(BaseModel):
    feed_date: date
    edition_type: str
    title: str
    market_timezone: str
    expected_publish_at: datetime
    is_ready: bool
    total: int
    unread: int
    completed: bool


class FeedEditionsResponse(BaseModel):
    selected_feed_date: date | None
    selected_edition_type: str | None
    market_timezone: str
    editions: list[FeedEditionOut]


# user feedback used for ranking
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
