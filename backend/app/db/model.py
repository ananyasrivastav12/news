# database tables for users, articles, feeds, signals, and pipeline runs
import enum

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class SourceType(enum.Enum):
    NEWS = "news"
    WIKI = "wiki"


class SummaryStatus(enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class InteractionType(enum.Enum):
    VIEW = "view"
    SKIP = "skip"
    CLICK = "click"
    LIKE = "like"
    SAVE = "save"


class PipelineRunStatus(enum.Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    interests = relationship(
        "UserInterest", back_populates="user", cascade="all, delete-orphan"
    )
    category_preferences = relationship(
        "UserCategoryPreference", back_populates="user", cascade="all, delete-orphan"
    )
    keyword_preferences = relationship(
        "UserKeywordPreference", back_populates="user", cascade="all, delete-orphan"
    )
    interactions = relationship(
        "UserArticleInteraction", back_populates="user", cascade="all, delete-orphan"
    )
    flashcards = relationship(
        "Flashcard", back_populates="user", cascade="all, delete-orphan"
    )
    support_messages = relationship(
        "SupportMessage", back_populates="user", cascade="all, delete-orphan"
    )
    embedding_profile = relationship(
        "UserEmbeddingProfile",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class Interest(Base):
    __tablename__ = "interests"

    # interests are user-selected topics or regions
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    source_type = Column(Enum(SourceType), nullable=False)

    users = relationship("UserInterest", back_populates="interest")


class UserInterest(Base):
    __tablename__ = "user_interests"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    interest_id = Column(Integer, ForeignKey("interests.id"), primary_key=True)

    user = relationship("User", back_populates="interests")
    interest = relationship("Interest", back_populates="users")


class Article(Base):
    __tablename__ = "articles"

    # articles are stored once and reused across users
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    normalized_title = Column(String, index=True, nullable=False)
    original_url = Column(String, unique=True, nullable=False)
    source = Column(String, index=True)
    country = Column(String, index=True, nullable=False, default="us")
    description = Column(Text)
    content = Column(Text)
    raw_text = Column(Text)
    cleaned_text = Column(Text)
    published_at = Column(DateTime(timezone=True), index=True)
    primary_category = Column(String, index=True, nullable=False)
    image_url = Column(String)
    keywords = Column(JSON, nullable=False, default=list)
    embedding = Column(JSON)
    story_key = Column(String, index=True, nullable=False)
    summary_status = Column(
        Enum(SummaryStatus), nullable=False, default=SummaryStatus.PENDING
    )
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True))

    summary = relationship(
        "Summary", back_populates="article", uselist=False, cascade="all, delete-orphan"
    )
    interactions = relationship("UserArticleInteraction", back_populates="article")
    flashcards = relationship("Flashcard", back_populates="article")
    summary_reviews = relationship(
        "SummaryReview", back_populates="article", cascade="all, delete-orphan"
    )


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("articles.id"), unique=True, nullable=False)
    display_headline = Column(Text, nullable=True)
    main_takeaway = Column(Text, nullable=False)
    supporting_lines = Column(JSON, nullable=False, default=list)
    summary_text = Column(Text, nullable=False)
    why_it_matters = Column(Text, nullable=True)
    model_name = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    article = relationship("Article", back_populates="summary")
    flashcards = relationship("Flashcard", back_populates="summary")
    reviews = relationship("SummaryReview", back_populates="summary")


class Flashcard(Base):
    __tablename__ = "flashcards"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "feed_date",
            "edition_type",
            "market_timezone",
            "article_id",
            name="uq_feed_edition_article",
        ),
        UniqueConstraint(
            "user_id",
            "feed_date",
            "edition_type",
            "market_timezone",
            "rank_position",
            name="uq_feed_edition_rank",
        ),
    )

    # flashcards keep each user's edition stable
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    article_id = Column(Integer, ForeignKey("articles.id"), nullable=False)
    summary_id = Column(Integer, ForeignKey("summaries.id"), nullable=False)
    feed_date = Column(Date, nullable=False, index=True)
    edition_type = Column(String, nullable=False, default="morning_brief", index=True)
    market_timezone = Column(
        String, nullable=False, default="America/New_York", index=True
    )
    rank_position = Column(Integer, nullable=False)
    ranking_score = Column(Float, nullable=False, default=0.0)
    ranking_reason = Column(String)
    delivered_at = Column(DateTime(timezone=True), server_default=func.now())
    is_viewed = Column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="flashcards")
    article = relationship("Article", back_populates="flashcards")
    summary = relationship("Summary", back_populates="flashcards")


class UserArticleInteraction(Base):
    __tablename__ = "user_article_interactions"

    # signals record what users did with a story
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    article_id = Column(Integer, ForeignKey("articles.id"), nullable=False, index=True)
    interaction_type = Column(Enum(InteractionType), nullable=False)
    dwell_time_seconds = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    metadata_json = Column(JSON, nullable=False, default=dict)

    user = relationship("User", back_populates="interactions")
    article = relationship("Article", back_populates="interactions")


class UserCategoryPreference(Base):
    __tablename__ = "user_category_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "category", name="uq_user_category_preference"),
    )

    # learned category scores nudge future feeds
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String, nullable=False, index=True)
    score = Column(Float, nullable=False, default=0.0)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User", back_populates="category_preferences")


class UserKeywordPreference(Base):
    __tablename__ = "user_keyword_preferences"
    __table_args__ = (
        UniqueConstraint("user_id", "keyword", name="uq_user_keyword_preference"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    keyword = Column(String, nullable=False, index=True)
    score = Column(Float, nullable=False, default=0.0)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User", back_populates="keyword_preferences")


class UserEmbeddingProfile(Base):
    __tablename__ = "user_embedding_profiles"

    # averaged positive-story embedding for semantic matches
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    embedding = Column(JSON, nullable=False, default=list)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User", back_populates="embedding_profile")


class PipelineRun(Base):
    __tablename__ = "pipeline_runs"

    id = Column(Integer, primary_key=True, index=True)
    run_type = Column(String, nullable=False, index=True)
    status = Column(
        Enum(PipelineRunStatus),
        nullable=False,
        default=PipelineRunStatus.QUEUED,
        index=True,
    )
    started_at = Column(DateTime(timezone=True))
    finished_at = Column(DateTime(timezone=True))
    duration_seconds = Column(Float)
    fetched_count = Column(Integer, nullable=False, default=0)
    inserted_count = Column(Integer, nullable=False, default=0)
    duplicates_skipped_count = Column(Integer, nullable=False, default=0)
    invalid_skipped_count = Column(Integer, nullable=False, default=0)
    summarized_count = Column(Integer, nullable=False, default=0)
    summary_failed_count = Column(Integer, nullable=False, default=0)
    embedded_count = Column(Integer, nullable=False, default=0)
    feed_items_count = Column(Integer, nullable=False, default=0)
    error_message = Column(Text)
    metadata_json = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    logs = relationship(
        "PipelineRunLog", back_populates="pipeline_run", cascade="all, delete-orphan"
    )


class PipelineRunLog(Base):
    __tablename__ = "pipeline_run_logs"

    id = Column(Integer, primary_key=True, index=True)
    pipeline_run_id = Column(Integer, ForeignKey("pipeline_runs.id"), nullable=False)
    level = Column(String, nullable=False, default="info")
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    pipeline_run = relationship("PipelineRun", back_populates="logs")


class SummaryReview(Base):
    __tablename__ = "summary_reviews"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("articles.id"), nullable=False, index=True)
    summary_id = Column(Integer, ForeignKey("summaries.id"), nullable=True, index=True)
    reviewer_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    rating = Column(String, nullable=False)
    issue_type = Column(String)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    article = relationship("Article", back_populates="summary_reviews")
    summary = relationship("Summary", back_populates="reviews")
    reviewer = relationship("User")


class SupportMessage(Base):
    __tablename__ = "support_messages"

    # users can send admin-readable support notes from profile
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    subject = Column(String(120))
    message = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default="open", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    user = relationship("User", back_populates="support_messages")


class PipelineSchedule(Base):
    __tablename__ = "pipeline_schedules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    schedule_type = Column(String, nullable=False, default="full_pipeline")
    hour = Column(Integer, nullable=False, default=7)
    minute = Column(Integer, nullable=False, default=0)
    countries = Column(JSON, nullable=False, default=list)
    categories = Column(JSON, nullable=False, default=list)
    article_target = Column(Integer)
    summary_limit = Column(Integer)
    force_feeds = Column(Boolean, nullable=False, default=True)
    last_run_at = Column(DateTime(timezone=True))
    next_run_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
