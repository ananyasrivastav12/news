from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Query, Session

from app.core.config import settings
from app.db import model as db_model


def build_article_distribution(
    db: Session,
    *,
    fresh_only: bool = False,
    summary_status: db_model.SummaryStatus | None = None,
    published_from: datetime | None = None,
    published_to: datetime | None = None,
) -> dict[str, Any]:
    fresh_cutoff = datetime.now(timezone.utc) - timedelta(
        hours=settings.ARTICLE_MAX_AGE_HOURS
    )
    base_query = db.query(db_model.Article)
    if fresh_only:
        base_query = base_query.filter(db_model.Article.published_at >= fresh_cutoff)
    if summary_status is not None:
        base_query = base_query.filter(
            db_model.Article.summary_status == summary_status
        )
    if published_from is not None:
        base_query = base_query.filter(db_model.Article.published_at >= published_from)
    if published_to is not None:
        base_query = base_query.filter(db_model.Article.published_at < published_to)

    totals = _counts_for_query(base_query, fresh_cutoff)
    return {
        "generated_at": datetime.now(timezone.utc),
        "fresh_cutoff": fresh_cutoff,
        "filters": {
            "fresh_only": fresh_only,
            "summary_status": summary_status.value if summary_status else None,
            "date_from": published_from.isoformat() if published_from else None,
            "date_to": published_to.isoformat() if published_to else None,
        },
        "totals": totals,
        "by_country": _grouped_counts(
            base_query,
            fresh_cutoff,
            db_model.Article.country,
            "country",
        ),
        "by_category": _grouped_counts(
            base_query,
            fresh_cutoff,
            db_model.Article.primary_category,
            "category",
        ),
        "by_country_category": _country_category_counts(base_query, fresh_cutoff),
    }


def _counts_for_query(query: Query, fresh_cutoff: datetime) -> dict[str, int]:
    row = query.with_entities(
        func.count(db_model.Article.id),
        _sum_if(db_model.Article.published_at >= fresh_cutoff),
        _sum_if(db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED),
        _sum_if(db_model.Article.summary_status == db_model.SummaryStatus.PENDING),
        _sum_if(db_model.Article.summary_status == db_model.SummaryStatus.FAILED),
        _sum_if(db_model.Article.image_url.isnot(None)),
    ).one()
    return _count_payload(row)


def _grouped_counts(
    query: Query,
    fresh_cutoff: datetime,
    group_column: Any,
    key_name: str,
) -> list[dict[str, object]]:
    rows = (
        query.with_entities(
            group_column,
            func.count(db_model.Article.id),
            _sum_if(db_model.Article.published_at >= fresh_cutoff),
            _sum_if(
                db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED
            ),
            _sum_if(db_model.Article.summary_status == db_model.SummaryStatus.PENDING),
            _sum_if(db_model.Article.summary_status == db_model.SummaryStatus.FAILED),
            _sum_if(db_model.Article.image_url.isnot(None)),
        )
        .group_by(group_column)
        .order_by(func.count(db_model.Article.id).desc())
        .all()
    )
    return [{key_name: row[0] or "unknown", **_count_payload(row[1:])} for row in rows]


def _country_category_counts(
    query: Query,
    fresh_cutoff: datetime,
) -> list[dict[str, object]]:
    rows = (
        query.with_entities(
            db_model.Article.country,
            db_model.Article.primary_category,
            func.count(db_model.Article.id),
            _sum_if(db_model.Article.published_at >= fresh_cutoff),
            _sum_if(
                db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED
            ),
            _sum_if(db_model.Article.summary_status == db_model.SummaryStatus.PENDING),
            _sum_if(db_model.Article.summary_status == db_model.SummaryStatus.FAILED),
            _sum_if(db_model.Article.image_url.isnot(None)),
        )
        .group_by(db_model.Article.country, db_model.Article.primary_category)
        .order_by(
            db_model.Article.country.asc(),
            func.count(db_model.Article.id).desc(),
        )
        .all()
    )
    return [
        {
            "country": country or "unknown",
            "category": category or "unknown",
            **_count_payload(row),
        }
        for country, category, *row in rows
    ]


def _sum_if(condition: Any) -> Any:
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


def _count_payload(row: Sequence[Any]) -> dict[str, int]:
    values = list(row)
    return {
        "total_count": int(values[0] or 0),
        "fresh_count": int(values[1] or 0),
        "completed_count": int(values[2] or 0),
        "pending_count": int(values[3] or 0),
        "failed_count": int(values[4] or 0),
        "image_count": int(values[5] or 0),
    }
