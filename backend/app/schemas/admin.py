from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PipelineRunLogOut(BaseModel):
    id: int
    level: str
    message: str
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class PipelineRunOut(BaseModel):
    id: int
    run_type: str
    status: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_seconds: float | None = None
    fetched_count: int
    inserted_count: int
    duplicates_skipped_count: int
    invalid_skipped_count: int
    summarized_count: int
    summary_failed_count: int
    embedded_count: int
    feed_items_count: int
    error_message: str | None = None
    metadata_json: dict[str, Any]
    created_at: datetime | None = None
    logs: list[PipelineRunLogOut] = []

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class PipelineRunQueued(BaseModel):
    id: int
    status: str
    message: str


class AdminOverview(BaseModel):
    total_articles: int
    fresh_articles: int
    completed_summaries: int
    failed_summaries: int
    feed_items_generated: int
    users_with_feeds: int
    total_users: int
    viewed_count: int
    liked_count: int
    disliked_count: int
    saved_count: int
    newsapi_requests_planned: int
    newsapi_daily_target: int
    openai_summary_calls_planned: int
    openai_embedding_calls_planned: int
    last_successful_run_at: datetime | None = None
    next_scheduled_run_at: datetime | None = None


class AdminArticleOut(BaseModel):
    id: int
    title: str
    source: str | None = None
    country: str
    primary_category: str
    published_at: datetime | None = None
    fetched_at: datetime | None = None
    summary_status: str
    image_present: bool
    interaction_count: int
    is_protected: bool

    model_config = ConfigDict(from_attributes=True, use_enum_values=True)


class AdminArticleDetail(AdminArticleOut):
    original_url: str
    description: str | None = None
    cleaned_text: str | None = None
    summary_text: str | None = None
    main_takeaway: str | None = None


class AdminUserOut(BaseModel):
    id: int
    email: str
    interests: list[str]
    feed_count: int
    viewed_count: int
    liked_count: int
    disliked_count: int
    saved_count: int
    last_active: datetime | None = None
    last_feed_generated: datetime | None = None


class UserFeedItemOut(BaseModel):
    rank_position: int
    article_id: int
    title: str
    country: str
    category: str
    ranking_reason: str | None = None
    is_viewed: bool
    score: float
    liked: bool
    saved: bool
    disliked: bool


class SummaryReviewCreate(BaseModel):
    article_id: int
    rating: str
    issue_type: str | None = None
    notes: str | None = None


class SummaryReviewOut(BaseModel):
    id: int
    article_id: int
    summary_id: int | None = None
    reviewer_user_id: int | None = None
    rating: str
    issue_type: str | None = None
    notes: str | None = None
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class PipelineScheduleBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    schedule_type: str = "full_pipeline"
    hour: int = Field(ge=0, le=23)
    minute: int = Field(ge=0, le=59)
    countries: list[str] = []
    categories: list[str] = []
    article_target: int | None = Field(default=None, ge=1)
    summary_limit: int | None = Field(default=None, ge=1)
    force_feeds: bool = True


class PipelineScheduleCreate(PipelineScheduleBase):
    pass


class PipelineScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    schedule_type: str | None = None
    hour: int | None = Field(default=None, ge=0, le=23)
    minute: int | None = Field(default=None, ge=0, le=59)
    countries: list[str] | None = None
    categories: list[str] | None = None
    article_target: int | None = Field(default=None, ge=1)
    summary_limit: int | None = Field(default=None, ge=1)
    force_feeds: bool | None = None


class PipelineScheduleOut(PipelineScheduleBase):
    id: int
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
