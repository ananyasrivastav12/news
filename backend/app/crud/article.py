# article database helpers
from sqlalchemy.orm import Session

from app.db import model as db_model


def get_article_by_url(db: Session, url: str) -> db_model.Article | None:
    return (
        db.query(db_model.Article).filter(db_model.Article.original_url == url).first()
    )


def get_article(db: Session, article_id: int) -> db_model.Article | None:
    return db.query(db_model.Article).filter(db_model.Article.id == article_id).first()
