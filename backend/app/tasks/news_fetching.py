from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from math import ceil
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.celery_app import celery
from app.core.config import settings
from app.crud import interest as crud_interest
from app.db import model as db_model
from app.db.session import SessionLocal
from app.services.admin_observability import build_article_distribution
from app.services.article_pipeline import (
    is_duplicate_article,
    is_valid_article,
    normalize_article,
    recalculate_article_features,
    upsert_article,
)
from app.services.embeddings import EmbeddingService
from app.services.feed_editions import (
    DEFAULT_TIMEZONE,
    EDITION_BY_TYPE,
    EDITION_DEFINITIONS,
    MORNING_BRIEF,
    is_edition_due,
    local_feed_date,
    local_now,
    normalize_timezone,
    validate_edition_type,
)
from app.services.metadata import json_safe
from app.services.news import NewsApiService
from app.services.recommendations import build_today_feed
from app.services.summarizer import ArticleSummarizer


def _get_batch_categories() -> list[str]:
    return [
        category.strip().lower()
        for category in settings.NEWS_BATCH_CATEGORIES.split(",")
        if category.strip()
    ]


def _get_batch_countries() -> list[str]:
    return settings.news_api_countries


def _country_query_term(country: str) -> str:
    if country.lower() == "in":
        return "India"
    if country.lower() == "us":
        return "United States"
    return country


async def _fetch_country_category_articles(
    service: NewsApiService,
    *,
    country: str,
    category: str,
) -> tuple[list[dict], str]:
    default_country = settings.NEWS_API_COUNTRY.lower()
    if country.lower() == default_country:
        articles = await service.fetch_top_headlines(
            category=category,
            country=country,
        )
        return articles, "top-headlines-country"

    articles = await service.fetch_top_headlines_for_country_sources(
        category=category,
        country=country,
    )
    if articles:
        return articles, "top-headlines-sources"

    query = _country_query_term(country)
    if category != "general":
        query = f"{query} {category}"
    articles = await service.fetch_everything(
        query=query,
        country=country,
    )
    return articles, "everything-query"


async def _async_ingest_news(db: Session) -> dict[str, Any]:
    service = NewsApiService()
    categories = _get_batch_categories()
    countries = _get_batch_countries()
    fetched = 0
    inserted = 0
    target = max(1, settings.NEWS_DAILY_ARTICLE_TARGET)
    per_country_target = max(1, ceil(target / max(1, len(countries))))
    by_country: dict[str, dict[str, int]] = {
        country: {"fetched": 0, "inserted": 0} for country in countries
    }
    by_category: dict[str, dict[str, int]] = {
        category: {"fetched": 0, "inserted": 0} for category in categories
    }
    by_country_category: dict[str, dict[str, dict[str, int]]] = {
        country: {category: {"fetched": 0, "inserted": 0} for category in categories}
        for country in countries
    }
    by_strategy: dict[str, int] = {}

    for country in countries:
        country_inserted = 0
        for category in categories:
            articles, strategy = await _fetch_country_category_articles(
                service,
                country=country,
                category=category,
            )
            by_strategy[strategy] = by_strategy.get(strategy, 0) + 1
            fetched += len(articles)
            by_country[country]["fetched"] += len(articles)
            by_category[category]["fetched"] += len(articles)
            by_country_category[country][category]["fetched"] += len(articles)
            for raw_article in articles:
                if country_inserted >= per_country_target:
                    break
                if not is_valid_article(raw_article):
                    continue
                normalized = normalize_article(raw_article, category)
                if is_duplicate_article(db, normalized):
                    continue
                upsert_article(db, normalized)
                inserted += 1
                country_inserted += 1
                by_country[country]["inserted"] += 1
                by_category[category]["inserted"] += 1
                by_country_category[country][category]["inserted"] += 1
            db.commit()
            if country_inserted >= per_country_target:
                break

    pruned = _prune_article_pool(db)
    return {
        "fetched": fetched,
        "inserted": inserted,
        "target": target,
        "per_country_target": per_country_target,
        "pruned": pruned,
        "countries": len(countries),
        "by_country": by_country,
        "by_category": by_category,
        "by_country_category": by_country_category,
        "by_strategy": by_strategy,
        "requests_planned": len(countries) * len(categories),
    }


def _prune_article_pool(db: Session) -> int:
    pool_limit = max(1, settings.ARTICLE_POOL_LIMIT)
    saved_article_ids = (
        select(db_model.UserArticleInteraction.article_id)
        .where(
            db_model.UserArticleInteraction.interaction_type
            == db_model.InteractionType.SAVE
        )
        .distinct()
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
    pending_articles = _select_articles_for_summarization(
        db,
        limit=limit,
        force_refresh=force_refresh,
    )

    processed = 0
    failed = 0
    embedded = 0
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
                summary.display_headline = summary_payload["display_headline"]
                summary.main_takeaway = summary_payload["main_takeaway"]
                summary.supporting_lines = summary_payload["supporting_lines"]
                summary.summary_text = summary_payload["summary_text"]
                summary.why_it_matters = summary_payload["why_it_matters"]
                summary.model_name = summary_payload["model_name"]
            article.summary_status = db_model.SummaryStatus.COMPLETED
            article.processed_at = datetime.now(timezone.utc)
            try:
                article.embedding = await embedding_service.embed_text(
                    summary.summary_text
                )
                embedded += 1
            except Exception:
                article.embedding = article.embedding
            processed += 1
        except Exception:
            article.summary_status = db_model.SummaryStatus.FAILED
            failed += 1
        db.commit()

    return {"processed": processed, "failed": failed, "embedded": embedded}


def _select_articles_for_summarization(
    db: Session, *, limit: int, force_refresh: bool
) -> list[db_model.Article]:
    limit = max(1, limit)
    countries = _get_batch_countries()
    per_country_limit = max(1, ceil(limit / max(1, len(countries))))
    selected: list[db_model.Article] = []
    selected_ids: set[int] = set()

    for country in countries:
        query = db.query(db_model.Article).filter(
            db_model.Article.country == country.lower()
        )
        if not force_refresh:
            query = query.filter(
                db_model.Article.summary_status == db_model.SummaryStatus.PENDING
            )
        for article in (
            query.order_by(db_model.Article.published_at.desc())
            .limit(per_country_limit)
            .all()
        ):
            selected.append(article)
            selected_ids.add(article.id)

    query = db.query(db_model.Article)
    if not force_refresh:
        query = query.filter(
            db_model.Article.summary_status == db_model.SummaryStatus.PENDING
        )
    if selected_ids:
        query = query.filter(db_model.Article.id.notin_(selected_ids))
    selected.extend(
        query.order_by(db_model.Article.published_at.desc())
        .limit(max(0, limit - len(selected)))
        .all()
    )
    return selected[:limit]


def _build_user_feed(
    db: Session,
    user: db_model.User,
    feed_date: date,
    *,
    edition_type: str = MORNING_BRIEF,
    market_timezone: str = DEFAULT_TIMEZONE,
    force_refresh: bool = False,
) -> int:
    validate_edition_type(edition_type)
    market_timezone = normalize_timezone(market_timezone)
    build_today_feed(
        db,
        user=user,
        feed_date=feed_date,
        edition_type=edition_type,
        market_timezone=market_timezone,
        force_refresh=force_refresh,
    )
    return (
        db.query(db_model.Flashcard)
        .filter(
            db_model.Flashcard.user_id == user.id,
            db_model.Flashcard.feed_date == feed_date,
            db_model.Flashcard.edition_type == edition_type,
            db_model.Flashcard.market_timezone == market_timezone,
            db_model.Flashcard.rank_position <= settings.feed_edition_size,
        )
        .count()
    )


def _status_value(status: db_model.PipelineRunStatus | str) -> str:
    return status.value if isinstance(status, db_model.PipelineRunStatus) else status


def _start_recorded_run(
    db: Session,
    *,
    run_type: str,
    metadata: dict[str, Any] | None = None,
) -> db_model.PipelineRun:
    pipeline_run = db_model.PipelineRun(
        run_type=run_type,
        status=db_model.PipelineRunStatus.RUNNING,
        started_at=datetime.now(timezone.utc),
        metadata_json=json_safe(metadata or {}),
    )
    db.add(pipeline_run)
    db.flush()
    db.add(
        db_model.PipelineRunLog(
            pipeline_run_id=pipeline_run.id,
            level="info",
            message=f"Started {run_type.replace('_', ' ')}.",
        )
    )
    db.commit()
    db.refresh(pipeline_run)
    return pipeline_run


def _finish_recorded_run(
    db: Session,
    pipeline_run: db_model.PipelineRun,
    *,
    metadata: dict[str, Any],
    ingestion: dict[str, Any] | None = None,
    summarization: dict[str, Any] | None = None,
    feeds: dict[str, Any] | None = None,
    embeddings: dict[str, Any] | None = None,
) -> None:
    if ingestion is not None:
        pipeline_run.fetched_count += int(ingestion.get("fetched", 0))
        pipeline_run.inserted_count += int(ingestion.get("inserted", 0))
        metadata["ingestion"] = ingestion
    if summarization is not None:
        pipeline_run.summarized_count += int(summarization.get("processed", 0))
        pipeline_run.summary_failed_count += int(summarization.get("failed", 0))
        pipeline_run.embedded_count += int(summarization.get("embedded", 0))
        metadata["summarization"] = summarization
    if feeds is not None:
        pipeline_run.feed_items_count += int(feeds.get("feed_items", 0))
        metadata["feeds"] = feeds
    if embeddings is not None:
        pipeline_run.embedded_count += int(embeddings.get("embedded", 0))
        metadata["embeddings"] = embeddings
    metadata["article_distribution"] = build_article_distribution(db)

    finished_at = datetime.now(timezone.utc)
    pipeline_run.status = db_model.PipelineRunStatus.SUCCEEDED
    pipeline_run.finished_at = finished_at
    if pipeline_run.started_at is not None:
        pipeline_run.duration_seconds = _duration_seconds(
            pipeline_run.started_at, finished_at
        )
    pipeline_run.metadata_json = json_safe(metadata)
    db.add(
        db_model.PipelineRunLog(
            pipeline_run_id=pipeline_run.id,
            level="info",
            message=f"Finished {pipeline_run.run_type.replace('_', ' ')}.",
        )
    )
    db.commit()


def _fail_recorded_run(
    db: Session,
    pipeline_run: db_model.PipelineRun,
    *,
    metadata: dict[str, Any],
    error: Exception,
) -> None:
    finished_at = datetime.now(timezone.utc)
    pipeline_run.status = db_model.PipelineRunStatus.FAILED
    pipeline_run.finished_at = finished_at
    if pipeline_run.started_at is not None:
        pipeline_run.duration_seconds = _duration_seconds(
            pipeline_run.started_at, finished_at
        )
    pipeline_run.error_message = str(error)
    pipeline_run.metadata_json = json_safe(metadata)
    db.add(
        db_model.PipelineRunLog(
            pipeline_run_id=pipeline_run.id,
            level="error",
            message=str(error),
        )
    )
    db.commit()


def _recorded_result(
    pipeline_run: db_model.PipelineRun,
    payload: dict[str, Any],
) -> dict[str, Any]:
    return {
        **payload,
        "pipeline_run_id": pipeline_run.id,
        "pipeline_run_status": _status_value(pipeline_run.status),
    }


def _duration_seconds(started_at: datetime, finished_at: datetime) -> float:
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    return (finished_at - started_at.astimezone(timezone.utc)).total_seconds()


@celery.task
def fetch_news_task(record_run: bool = True) -> dict[str, Any]:
    db = SessionLocal()
    metadata = {"source": "task", "task": "fetch_news_task"}
    pipeline_run = (
        _start_recorded_run(db, run_type="ingestion", metadata=metadata)
        if record_run
        else None
    )
    try:
        result = asyncio.run(_async_ingest_news(db))
        if pipeline_run is not None:
            _finish_recorded_run(
                db,
                pipeline_run,
                metadata=metadata,
                ingestion=result,
            )
            return _recorded_result(pipeline_run, result)
        return result
    except Exception as exc:
        if pipeline_run is not None:
            _fail_recorded_run(db, pipeline_run, metadata=metadata, error=exc)
        raise
    finally:
        db.close()


@celery.task
def summarize_articles_task(
    limit: int | None = None, force_refresh: bool = False, record_run: bool = True
) -> dict[str, Any]:
    db = SessionLocal()
    summary_limit = max(1, limit or settings.OPENAI_DAILY_SUMMARY_LIMIT)
    metadata = {
        "source": "task",
        "task": "summarize_articles_task",
        "limit": summary_limit,
        "force_refresh": force_refresh,
    }
    pipeline_run = (
        _start_recorded_run(db, run_type="summarization", metadata=metadata)
        if record_run
        else None
    )
    try:
        result = asyncio.run(
            _async_summarize_articles(
                db,
                limit=summary_limit,
                force_refresh=force_refresh,
            )
        )
        if pipeline_run is not None:
            _finish_recorded_run(
                db,
                pipeline_run,
                metadata=metadata,
                summarization=result,
            )
            return _recorded_result(pipeline_run, result)
        return result
    except Exception as exc:
        if pipeline_run is not None:
            _fail_recorded_run(db, pipeline_run, metadata=metadata, error=exc)
        raise
    finally:
        db.close()


@celery.task
def generate_morning_feeds_task(
    feed_date_iso: str | None = None,
    force_refresh: bool = False,
    summarize_first: bool = False,
    summary_limit: int = 100,
) -> dict[str, Any]:
    return generate_feed_edition_task(
        feed_date_iso=feed_date_iso,
        edition_type=MORNING_BRIEF,
        market_timezone=DEFAULT_TIMEZONE,
        force_refresh=force_refresh,
        summarize_first=summarize_first,
        summary_limit=summary_limit,
    )


@celery.task
def generate_feed_edition_task(
    feed_date_iso: str | None = None,
    edition_type: str = MORNING_BRIEF,
    market_timezone: str = DEFAULT_TIMEZONE,
    force_refresh: bool = False,
    summarize_first: bool = False,
    summary_limit: int = 100,
) -> dict[str, Any]:
    db = SessionLocal()
    metadata: dict[str, Any] = {
        "source": "task",
        "task": "generate_feed_edition_task",
        "edition_type": edition_type,
        "feed_date": feed_date_iso,
        "market_timezone": market_timezone,
        "force_refresh": force_refresh,
        "summarize_first": summarize_first,
        "summary_limit": summary_limit,
    }
    pipeline_run = _start_recorded_run(
        db, run_type="feed_generation", metadata=metadata
    )
    try:
        validate_edition_type(edition_type)
        market_timezone = normalize_timezone(market_timezone)
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
            date.fromisoformat(feed_date_iso)
            if feed_date_iso
            else local_feed_date(market_timezone)
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
                db,
                user,
                target_date,
                edition_type=edition_type,
                market_timezone=market_timezone,
                force_refresh=force_refresh,
            )
        result: dict[str, Any] = {
            "users": len(users),
            "feed_items": feed_count,
            "edition_type": edition_type,
            "feed_date": target_date.isoformat(),
            "market_timezone": market_timezone,
        }
        if summarization is not None:
            result["summarized"] = summarization["processed"]
            result["summary_failures"] = summarization["failed"]
        _finish_recorded_run(
            db,
            pipeline_run,
            metadata=metadata,
            summarization=summarization,
            feeds=result,
        )
        return _recorded_result(pipeline_run, result)
    except Exception as exc:
        _fail_recorded_run(db, pipeline_run, metadata=metadata, error=exc)
        raise
    finally:
        db.close()


@celery.task
def run_daily_pipeline_task() -> dict[str, object]:
    db = SessionLocal()
    metadata: dict[str, Any] = {
        "source": "task",
        "task": "run_daily_pipeline_task",
    }
    pipeline_run = _start_recorded_run(db, run_type="full_pipeline", metadata=metadata)
    try:
        ingestion = asyncio.run(_async_ingest_news(db))
        summarization = asyncio.run(
            _async_summarize_articles(
                db,
                limit=max(1, settings.OPENAI_DAILY_SUMMARY_LIMIT),
                force_refresh=False,
            )
        )
        feeds = {
            "skipped": True,
            "reason": "Feeds are ranked lazily per user when the app loads.",
        }
        _finish_recorded_run(
            db,
            pipeline_run,
            metadata=metadata,
            ingestion=ingestion,
            summarization=summarization,
            feeds=feeds,
        )
        return _recorded_result(
            pipeline_run,
            {
                "ingestion": ingestion,
                "summarization": summarization,
                "feeds": feeds,
            },
        )
    except Exception as exc:
        _fail_recorded_run(db, pipeline_run, metadata=metadata, error=exc)
        raise
    finally:
        db.close()


@celery.task
def run_edition_pipeline_task(
    edition_type: str,
    market_timezone: str = DEFAULT_TIMEZONE,
    feed_date_iso: str | None = None,
    force_refresh: bool = False,
) -> dict[str, object]:
    validate_edition_type(edition_type)
    market_timezone = normalize_timezone(market_timezone)
    db = SessionLocal()
    metadata: dict[str, Any] = {
        "source": "scheduled",
        "task": "run_edition_pipeline_task",
        "edition_type": edition_type,
        "market_timezone": market_timezone,
        "feed_date": feed_date_iso,
        "force_refresh": force_refresh,
    }
    pipeline_run = _start_recorded_run(
        db, run_type="scheduled_edition_pipeline", metadata=metadata
    )
    try:
        ingestion = asyncio.run(_async_ingest_news(db))
        summarization = asyncio.run(
            _async_summarize_articles(
                db,
                limit=max(1, settings.OPENAI_DAILY_SUMMARY_LIMIT),
                force_refresh=False,
            )
        )
        feeds = {
            "skipped": True,
            "edition_type": edition_type,
            "market_timezone": market_timezone,
            "feed_date": feed_date_iso,
            "reason": "Feeds are ranked lazily per user when the app loads.",
        }
        _finish_recorded_run(
            db,
            pipeline_run,
            metadata=metadata,
            ingestion=ingestion,
            summarization=summarization,
            feeds=feeds,
        )
        return _recorded_result(
            pipeline_run,
            {
                "ingestion": ingestion,
                "summarization": summarization,
                "feeds": feeds,
            },
        )
    except Exception as exc:
        _fail_recorded_run(db, pipeline_run, metadata=metadata, error=exc)
        raise
    finally:
        db.close()


@celery.task
def dispatch_scheduled_editions_task() -> dict[str, object]:
    queued: list[dict[str, str]] = []
    for market_timezone in settings.feed_market_timezones:
        normalized_timezone = normalize_timezone(market_timezone)
        now = local_now(normalized_timezone)
        for definition in EDITION_DEFINITIONS:
            if is_edition_due(now, definition.edition_type):
                run_edition_pipeline_task.delay(
                    definition.edition_type,
                    normalized_timezone,
                    now.date().isoformat(),
                    False,
                )
                queued.append(
                    {
                        "edition_type": definition.edition_type,
                        "title": EDITION_BY_TYPE[definition.edition_type].title,
                        "feed_date": now.date().isoformat(),
                        "market_timezone": normalized_timezone,
                    }
                )
    return {"queued": queued, "count": len(queued)}


@celery.task
def backfill_interest_based_news_task() -> dict[str, Any]:
    db = SessionLocal()
    metadata: dict[str, Any] = {
        "source": "task",
        "task": "backfill_interest_based_news_task",
    }
    pipeline_run = _start_recorded_run(
        db, run_type="interest_backfill", metadata=metadata
    )
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
        result = {"inserted": inserted}
        _finish_recorded_run(
            db,
            pipeline_run,
            metadata=metadata,
            ingestion={"fetched": 0, "inserted": inserted},
        )
        return _recorded_result(pipeline_run, result)
    except Exception as exc:
        _fail_recorded_run(db, pipeline_run, metadata=metadata, error=exc)
        raise
    finally:
        db.close()


@celery.task
def reprocess_articles_task() -> dict[str, Any]:
    db = SessionLocal()
    metadata: dict[str, Any] = {
        "source": "task",
        "task": "reprocess_articles_task",
    }
    pipeline_run = _start_recorded_run(
        db, run_type="article_reprocessing", metadata=metadata
    )
    try:
        articles = db.query(db_model.Article).all()
        for article in articles:
            recalculate_article_features(article)
        db.commit()
        result = {"processed": len(articles)}
        metadata["reprocessing"] = result
        _finish_recorded_run(db, pipeline_run, metadata=metadata)
        return _recorded_result(pipeline_run, result)
    except Exception as exc:
        _fail_recorded_run(db, pipeline_run, metadata=metadata, error=exc)
        raise
    finally:
        db.close()


@celery.task
def embed_articles_task(limit: int = 200) -> dict[str, Any]:
    db = SessionLocal()
    metadata: dict[str, Any] = {
        "source": "task",
        "task": "embed_articles_task",
        "limit": limit,
    }
    pipeline_run = _start_recorded_run(
        db, run_type="article_embeddings", metadata=metadata
    )
    try:
        result = asyncio.run(_async_embed_articles(db, limit=limit))
        _finish_recorded_run(
            db,
            pipeline_run,
            metadata=metadata,
            embeddings=result,
        )
        return _recorded_result(pipeline_run, result)
    except Exception as exc:
        _fail_recorded_run(db, pipeline_run, metadata=metadata, error=exc)
        raise
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
