# In app/db/model.py

import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class SourceType(enum.Enum):
    NEWS = "news"
    WIKI = "wiki"


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    interests = relationship(
        "UserInterest", back_populates="user", cascade="all, delete-orphan"
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
    original_url = Column(String, unique=True, nullable=False)
    source = Column(String)
    content = Column(Text)
    published_at = Column(DateTime(timezone=True))


class Summary(Base):
    __tablename__ = "summaries"
    id = Column(Integer, primary_key=True, index=True)
    article_id = Column(Integer, ForeignKey("articles.id"))
    summary_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Flashcard(Base):
    __tablename__ = "flashcards"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    summary_id = Column(Integer, ForeignKey("summaries.id"))
    delivered_at = Column(DateTime(timezone=True), server_default=func.now())
    is_viewed = Column(Boolean, default=False)
