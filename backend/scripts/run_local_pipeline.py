# runs the producer pipeline locally without celery
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import date
from pathlib import Path

from sqlalchemy.orm import selectinload

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import model as db_model  # noqa: E402
from app.db.scripts.initial_data import populate_interests  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.tasks.news_fetching import (  # noqa: E402
    _async_ingest_news,
    _async_summarize_articles,
    _build_user_feed,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the local news ingestion/summarization/feed pipeline."
    )
    parser.add_argument(
        "--summary-limit",
        type=int,
        default=250,
        help="Maximum pending articles to summarize in this run.",
    )
    parser.add_argument(
        "--force-summaries",
        action="store_true",
        help="Re-summarize already processed articles.",
    )
    parser.add_argument(
        "--skip-ingestion",
        action="store_true",
        help="Skip NewsAPI ingestion and only process existing articles.",
    )
    parser.add_argument(
        "--skip-feeds",
        action="store_true",
        help="Skip rebuilding user flashcard feeds.",
    )
    parser.add_argument(
        "--force-feeds",
        action="store_true",
        help="Delete and rebuild today's feed for every user.",
    )
    parser.add_argument(
        "--feed-date",
        default=None,
        help="Feed date to build in YYYY-MM-DD format. Defaults to today.",
    )
    return parser.parse_args()


def rebuild_feeds(*, force_refresh: bool, feed_date: date) -> dict[str, int]:
    db = SessionLocal()
    try:
        users = (
            db.query(db_model.User)
            .options(
                selectinload(db_model.User.interests).joinedload(
                    db_model.UserInterest.interest
                ),
                selectinload(db_model.User.category_preferences),
                selectinload(db_model.User.keyword_preferences),
                selectinload(db_model.User.embedding_profile),
            )
            .all()
        )
        feed_items = 0
        for user in users:
            feed_items += _build_user_feed(
                db,
                user,
                feed_date,
                force_refresh=force_refresh,
            )
        return {"users": len(users), "feed_items": feed_items}
    finally:
        db.close()


def main() -> None:
    args = parse_args()
    target_feed_date = (
        date.fromisoformat(args.feed_date) if args.feed_date else date.today()
    )

    logger.info("Ensuring baseline interests exist")
    populate_interests()

    db = SessionLocal()
    try:
        if args.skip_ingestion:
            ingestion = {"skipped": 1}
        else:
            logger.info("Ingesting articles from NewsAPI")
            ingestion = asyncio.run(_async_ingest_news(db))

        logger.info("Summarizing and embedding pending articles")
        summarization = asyncio.run(
            _async_summarize_articles(
                db,
                limit=args.summary_limit,
                force_refresh=args.force_summaries,
            )
        )
    finally:
        db.close()

    if args.skip_feeds:
        feeds = {"skipped": 1}
    else:
        logger.info("Rebuilding personalized feeds")
        feeds = rebuild_feeds(
            force_refresh=args.force_feeds,
            feed_date=target_feed_date,
        )

    logger.info(
        "Local pipeline complete: ingestion=%s summarization=%s feeds=%s",
        ingestion,
        summarization,
        feeds,
    )


if __name__ == "__main__":
    main()
