from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session, selectinload

from app.db import model as db_model
from app.db.session import SessionLocal
from app.tasks.news_fetching import (
    _async_ingest_news,
    _async_summarize_articles,
    _build_user_feed,
)


def next_daily_run_at(hour: int, minute: int) -> datetime:
    now = datetime.now(timezone.utc)
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def create_pipeline_run(db: Session, run_type: str) -> db_model.PipelineRun:
    pipeline_run = db_model.PipelineRun(
        run_type=run_type,
        status=db_model.PipelineRunStatus.QUEUED,
        metadata_json={},
    )
    db.add(pipeline_run)
    db.commit()
    db.refresh(pipeline_run)
    return pipeline_run


def add_pipeline_log(
    db: Session,
    *,
    pipeline_run_id: int,
    message: str,
    level: str = "info",
) -> None:
    db.add(
        db_model.PipelineRunLog(
            pipeline_run_id=pipeline_run_id,
            level=level,
            message=message,
        )
    )
    db.commit()


def run_pipeline_background(pipeline_run_id: int, run_type: str) -> None:
    db = SessionLocal()
    try:
        run_pipeline_now(db, pipeline_run_id=pipeline_run_id, run_type=run_type)
    finally:
        db.close()


def run_pipeline_now(db: Session, *, pipeline_run_id: int, run_type: str) -> None:
    pipeline_run = db.get(db_model.PipelineRun, pipeline_run_id)
    if pipeline_run is None:
        return

    started_at = datetime.now(timezone.utc)
    pipeline_run.status = db_model.PipelineRunStatus.RUNNING
    pipeline_run.started_at = started_at
    pipeline_run.error_message = None
    db.commit()
    add_pipeline_log(
        db,
        pipeline_run_id=pipeline_run_id,
        message=f"Started {run_type.replace('_', ' ')}.",
    )

    metadata: dict[str, Any] = {}
    try:
        if run_type == "ingestion":
            ingestion = _run_ingestion(db)
            _apply_ingestion_counts(pipeline_run, ingestion)
            metadata["ingestion"] = ingestion
        elif run_type == "summarization":
            summarization = _run_summarization(db)
            _apply_summarization_counts(pipeline_run, summarization)
            metadata["summarization"] = summarization
        elif run_type == "feed_generation":
            feeds = _run_feed_generation(db, force_refresh=True)
            _apply_feed_counts(pipeline_run, feeds)
            metadata["feeds"] = feeds
        else:
            ingestion = _run_step(db, pipeline_run_id, "ingestion", _run_ingestion)
            _apply_ingestion_counts(pipeline_run, ingestion)
            metadata["ingestion"] = ingestion

            summarization = _run_step(
                db, pipeline_run_id, "summarization", _run_summarization
            )
            _apply_summarization_counts(pipeline_run, summarization)
            metadata["summarization"] = summarization

            feeds = _run_step(
                db,
                pipeline_run_id,
                "feed generation",
                lambda session: _run_feed_generation(session, force_refresh=True),
            )
            _apply_feed_counts(pipeline_run, feeds)
            metadata["feeds"] = feeds

        finished_at = datetime.now(timezone.utc)
        pipeline_run.status = db_model.PipelineRunStatus.SUCCEEDED
        pipeline_run.finished_at = finished_at
        pipeline_run.duration_seconds = (finished_at - started_at).total_seconds()
        pipeline_run.metadata_json = metadata
        db.commit()
        add_pipeline_log(
            db,
            pipeline_run_id=pipeline_run_id,
            message=f"Finished {run_type.replace('_', ' ')}.",
        )
    except Exception as exc:
        finished_at = datetime.now(timezone.utc)
        pipeline_run.status = db_model.PipelineRunStatus.FAILED
        pipeline_run.finished_at = finished_at
        pipeline_run.duration_seconds = (finished_at - started_at).total_seconds()
        pipeline_run.error_message = str(exc)
        pipeline_run.metadata_json = metadata
        db.commit()
        add_pipeline_log(
            db,
            pipeline_run_id=pipeline_run_id,
            message=str(exc),
            level="error",
        )


def _run_step(
    db: Session,
    pipeline_run_id: int,
    label: str,
    callback: Callable[[Session], dict[str, Any]],
) -> dict[str, Any]:
    add_pipeline_log(db, pipeline_run_id=pipeline_run_id, message=f"Starting {label}.")
    result = callback(db)
    add_pipeline_log(
        db,
        pipeline_run_id=pipeline_run_id,
        message=f"Completed {label}: {result}.",
    )
    return result


def _run_ingestion(db: Session) -> dict[str, Any]:
    return asyncio.run(_async_ingest_news(db))


def _run_summarization(db: Session) -> dict[str, Any]:
    return asyncio.run(_async_summarize_articles(db, limit=10, force_refresh=False))


def _run_feed_generation(db: Session, *, force_refresh: bool) -> dict[str, Any]:
    target_date = date.today()
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
    feed_items = 0
    for user in users:
        feed_items += _build_user_feed(
            db, user, target_date, force_refresh=force_refresh
        )
    return {"users": len(users), "feed_items": feed_items}


def _apply_ingestion_counts(
    pipeline_run: db_model.PipelineRun, result: dict[str, Any]
) -> None:
    pipeline_run.fetched_count += int(result.get("fetched", 0))
    pipeline_run.inserted_count += int(result.get("inserted", 0))


def _apply_summarization_counts(
    pipeline_run: db_model.PipelineRun, result: dict[str, Any]
) -> None:
    pipeline_run.summarized_count += int(result.get("processed", 0))
    pipeline_run.summary_failed_count += int(result.get("failed", 0))


def _apply_feed_counts(
    pipeline_run: db_model.PipelineRun, result: dict[str, Any]
) -> None:
    pipeline_run.feed_items_count += int(result.get("feed_items", 0))
