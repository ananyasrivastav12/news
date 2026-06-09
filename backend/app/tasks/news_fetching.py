from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone

from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.celery_app import celery
from app.core.config import settings
from app.crud import interest as crud_interest
from app.db import model as db_model
from app.db.session import SessionLocal
from app.services.article_pipeline import (
    is_duplicate_article,
    is_valid_article,
    normalize_article,
    recalculate_article_features,
    upsert_article,
)
from app.services.embeddings import EmbeddingService
from app.services.news import NewsApiService
from app.services.recommendations import persist_feed, rank_articles_for_user
from app.services.summarizer import ArticleSummarizer


def _get_batch_categories() -> list[str]:
    return [
        category.strip().lower()
        for category in settings.NEWS_BATCH_CATEGORIES.split(",")
        if category.strip()
    ]


def _get_batch_countries() -> list[str]:
    return settings.news_api_countries


async def _async_ingest_news(db: Session) -> dict[str, int]:
    service = NewsApiService()
    categories = _get_batch_categories()
    countries = _get_batch_countries()
    fetched = 0
    inserted = 0
    target = max(1, settings.NEWS_DAILY_ARTICLE_TARGET)

    for country in countries:
        for category in categories:
            articles = await service.fetch_top_headlines(
                category=category,
                country=country,
            )
            fetched += len(articles)
            for raw_article in articles:
                if inserted >= target:
                    break
                if not is_valid_article(raw_article):
                    continue
                normalized = normalize_article(raw_article, category)
                if is_duplicate_article(db, normalized):
                    continue
                upsert_article(db, normalized)
                inserted += 1
            db.commit()
            if inserted >= target:
                break
        if inserted >= target:
            break

    pruned = _prune_article_pool(db)
    return {
        "fetched": fetched,
        "inserted": inserted,
        "target": target,
        "pruned": pruned,
        "countries": len(countries),
        "requests_planned": len(countries) * len(categories),
    }


def _prune_article_pool(db: Session) -> int:
    pool_limit = max(1, settings.ARTICLE_POOL_LIMIT)
    saved_article_ids = (
        db.query(db_model.UserArticleInteraction.article_id)
        .filter(
            db_model.UserArticleInteraction.interaction_type
            == db_model.InteractionType.SAVE
        )
        .distinct()
        .subquery()
    )
    article_ids_to_prune = [
        article_id
        for (article_id,) in (
            db.query(db_model.Article.id)
            .filter(db_model.Article.id.notin_(saved_article_ids))
            .order_by(
                desc(db_model.Article.published_at).nullslast(),
                desc(db_model.Article.fetched_at),
                desc(db_model.Article.id),
            )
            .offset(pool_limit)
            .all()
        )
    ]
    if not article_ids_to_prune:
        return 0

    (
        db.query(db_model.Flashcard)
        .filter(db_model.Flashcard.article_id.in_(article_ids_to_prune))
        .delete(synchronize_session=False)
    )
    (
        db.query(db_model.UserArticleInteraction)
        .filter(db_model.UserArticleInteraction.article_id.in_(article_ids_to_prune))
        .delete(synchronize_session=False)
    )
    (
        db.query(db_model.Summary)
        .filter(db_model.Summary.article_id.in_(article_ids_to_prune))
        .delete(synchronize_session=False)
    )
    (
        db.query(db_model.Article)
        .filter(db_model.Article.id.in_(article_ids_to_prune))
        .delete(synchronize_session=False)
    )
    db.commit()
    return len(article_ids_to_prune)


async def _async_summarize_articles(
    db: Session, *, limit: int = 100, force_refresh: bool = False
) -> dict[str, int]:
    summarizer = ArticleSummarizer()
    embedding_service = EmbeddingService()
    query = db.query(db_model.Article)
    if not force_refresh:
        query = query.filter(
            db_model.Article.summary_status == db_model.SummaryStatus.PENDING
        )
    pending_articles = (
        query.order_by(db_model.Article.published_at.desc()).limit(limit).all()
    )

    processed = 0
    failed = 0
    for article in pending_articles:
        try:
            summary_payload = await summarizer.summarize(
                title=article.title,
                description=article.description,
                content=article.cleaned_text or article.raw_text or article.content,
            )
            summary = (
                db.query(db_model.Summary)
                .filter(db_model.Summary.article_id == article.id)
                .first()
            )
            if summary is None:
                summary = db_model.Summary(article_id=article.id, **summary_payload)
                db.add(summary)
            else:
                summary.main_takeaway = summary_payload["main_takeaway"]
                summary.supporting_lines = summary_payload["supporting_lines"]
                summary.summary_text = summary_payload["summary_text"]
                summary.model_name = summary_payload["model_name"]
            article.summary_status = db_model.SummaryStatus.COMPLETED
            article.processed_at = datetime.now(timezone.utc)
            try:
                article.embedding = await embedding_service.embed_text(
                    summary.summary_text
                )
            except Exception:
                article.embedding = article.embedding
            processed += 1
        except Exception:
            article.summary_status = db_model.SummaryStatus.FAILED
            failed += 1
        db.commit()

    return {"processed": processed, "failed": failed}


def _build_user_feed(
    db: Session, user: db_model.User, feed_date: date, *, force_refresh: bool = False
) -> int:
    existing_count = (
        db.query(db_model.Flashcard)
        .filter(
            db_model.Flashcard.user_id == user.id,
            db_model.Flashcard.feed_date == feed_date,
        )
        .count()
    )
    if existing_count and not force_refresh:
        return existing_count

    if force_refresh:
        (
            db.query(db_model.Flashcard)
            .filter(
                db_model.Flashcard.user_id == user.id,
                db_model.Flashcard.feed_date == feed_date,
            )
            .delete(synchronize_session=False)
        )
        db.flush()
    ranked = rank_articles_for_user(db, user=user)
    persist_feed(db, user=user, ranked_articles=ranked, feed_date=feed_date)
    db.commit()
    return len(ranked)


@celery.task
def fetch_news_task() -> dict[str, int]:
    db = SessionLocal()
    try:
        return asyncio.run(_async_ingest_news(db))
    finally:
        db.close()


@celery.task
def summarize_articles_task(
    limit: int = 100, force_refresh: bool = False
) -> dict[str, int]:
    db = SessionLocal()
    try:
        return asyncio.run(
            _async_summarize_articles(db, limit=limit, force_refresh=force_refresh)
        )
    finally:
        db.close()


@celery.task
def generate_morning_feeds_task(
    feed_date_iso: str | None = None,
    force_refresh: bool = False,
    summarize_first: bool = False,
    summary_limit: int = 100,
) -> dict[str, int]:
    db = SessionLocal()
    try:
        summarization = None
        if summarize_first:
            summarization = asyncio.run(
                _async_summarize_articles(
                    db,
                    limit=summary_limit,
                    force_refresh=False,
                )
            )

        target_date = (
            date.fromisoformat(feed_date_iso) if feed_date_iso else date.today()
        )
        users = (
            db.query(db_model.User)
            .options(
                selectinload(db_model.User.interests).joinedload(
                    db_model.UserInterest.interest
                ),
                selectinload(db_model.User.category_preferences),
                selectinload(db_model.User.keyword_preferences),
                selectinload(db_model.User.embedding_profile),
                selectinload(db_model.User.interactions).joinedload(
                    db_model.UserArticleInteraction.article
                ),
            )
            .all()
        )
        feed_count = 0
        for user in users:
            feed_count += _build_user_feed(
                db, user, target_date, force_refresh=force_refresh
            )
        result = {"users": len(users), "feed_items": feed_count}
        if summarization is not None:
            result["summarized"] = summarization["processed"]
            result["summary_failures"] = summarization["failed"]
        return result
    finally:
        db.close()


@celery.task
def run_daily_pipeline_task() -> dict[str, object]:
    ingestion = fetch_news_task()
    summarization = summarize_articles_task()
    feeds = generate_morning_feeds_task(force_refresh=True, summarize_first=False)
    return {
        "ingestion": ingestion,
        "summarization": summarization,
        "feeds": feeds,
    }


@celery.task
def backfill_interest_based_news_task() -> dict[str, int]:
    db = SessionLocal()
    try:
        service = NewsApiService()
        users = (
            db.query(db_model.User)
            .options(
                joinedload(db_model.User.interests).joinedload(
                    db_model.UserInterest.interest
                )
            )
            .all()
        )
        inserted = 0
        for user in users:
            interests = crud_interest.get_user_interests(db, user_id=user.id)
            news_interests = [
                interest.name.lower()
                for interest in interests
                if interest.source_type == db_model.SourceType.NEWS
            ]
            for interest_name in news_interests:
                category = (
                    interest_name
                    if interest_name in _get_batch_categories()
                    else "general"
                )
                countries = (
                    ["in"]
                    if interest_name == "india"
                    else (
                        ["us"]
                        if interest_name in {"united states", "us", "usa"}
                        else _get_batch_countries()
                    )
                )
                for country in countries:
                    articles = asyncio.run(
                        service.fetch_top_headlines(
                            category=category,
                            country=country,
                            query=interest_name,
                        )
                    )
                    for raw_article in articles:
                        if not is_valid_article(raw_article):
                            continue
                        normalized = normalize_article(raw_article, category)
                        if is_duplicate_article(db, normalized):
                            continue
                        upsert_article(db, normalized)
                        inserted += 1
            db.commit()
        return {"inserted": inserted}
    finally:
        db.close()


@celery.task
def reprocess_articles_task() -> dict[str, int]:
    db = SessionLocal()
    try:
        articles = db.query(db_model.Article).all()
        for article in articles:
            recalculate_article_features(article)
        db.commit()
        return {"processed": len(articles)}
    finally:
        db.close()


@celery.task
def embed_articles_task(limit: int = 200) -> dict[str, int]:
    db = SessionLocal()
    try:
        return asyncio.run(_async_embed_articles(db, limit=limit))
    finally:
        db.close()


async def _async_embed_articles(db: Session, *, limit: int = 200) -> dict[str, int]:
    embedding_service = EmbeddingService()
    articles = (
        db.query(db_model.Article)
        .options(joinedload(db_model.Article.summary))
        .filter(db_model.Article.embedding.is_(None))
        .order_by(db_model.Article.published_at.desc())
        .limit(limit)
        .all()
    )
    embedded = 0
    for article in articles:
        if article.summary is None:
            continue
        try:
            article.embedding = await embedding_service.embed_text(
                article.summary.summary_text
            )
        except Exception:
            article.embedding = None
        if article.embedding:
            embedded += 1
        db.commit()
    return {"embedded": embedded}
