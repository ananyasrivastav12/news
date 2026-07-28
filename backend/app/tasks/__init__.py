# exports celery task entry points
from .news_fetching import (
    backfill_interest_based_news_task,
    dispatch_scheduled_editions_task,
    embed_articles_task,
    fetch_news_task,
    generate_feed_edition_task,
    generate_morning_feeds_task,
    reprocess_articles_task,
    run_daily_pipeline_task,
    run_edition_pipeline_task,
    summarize_articles_task,
)
