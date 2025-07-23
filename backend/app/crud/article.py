# In app/crud/article.py

from typing import Any, Dict

from sqlalchemy.orm import Session

from app.db import model as db_model


def get_article_by_url(db: Session, url: str) -> db_model.Article:
    """
    Retrieve an article from the database by its original URL.
    """
    return (
        db.query(db_model.Article).filter(db_model.Article.original_url == url).first()
    )


def create_article(db: Session, article_data: Dict[str, Any]) -> db_model.Article:
    """
    Create a new article in the database if it doesn't already exist.
    """
    # Check if an article with the same URL already exists
    db_article = get_article_by_url(db, url=article_data["url"])
    if db_article:
        return db_article

    new_article = db_model.Article(
        title=article_data["title"],
        original_url=article_data["url"],
        source=article_data.get("source", {}).get("name"),
        content=article_data.get("content"),
        published_at=article_data.get("publishedAt"),
    )
    db.add(new_article)
    db.commit()
    db.refresh(new_article)
    return new_article
