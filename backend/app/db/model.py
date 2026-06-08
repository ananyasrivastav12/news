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
    embedding_profile = relationship(
        "UserEmbeddingProfile",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class Interest(Base):
    __tablename__ = "interests"

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

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    normalized_title = Column(String, index=True, nullable=False)
    original_url = Column(String, unique=True, nullable=False)
    source = Column(String, index=True)
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


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("articles.id"), unique=True, nullable=False)
    main_takeaway = Column(Text, nullable=False)
    supporting_lines = Column(JSON, nullable=False, default=list)
    summary_text = Column(Text, nullable=False)
    model_name = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    article = relationship("Article", back_populates="summary")
    flashcards = relationship("Flashcard", back_populates="summary")


class Flashcard(Base):
    __tablename__ = "flashcards"
    __table_args__ = (
        UniqueConstraint("user_id", "feed_date", "article_id", name="uq_feed_article"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    article_id = Column(Integer, ForeignKey("articles.id"), nullable=False)
    summary_id = Column(Integer, ForeignKey("summaries.id"), nullable=False)
    feed_date = Column(Date, nullable=False, index=True)
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

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    embedding = Column(JSON, nullable=False, default=list)
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    user = relationship("User", back_populates="embedding_profile")
