from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery = Celery(
    "tasks",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks"],
)

celery.conf.timezone = "America/New_York"
celery.conf.beat_schedule = {
    "daily-news-pipeline": {
        "task": "app.tasks.news_fetching.run_daily_pipeline_task",
        "schedule": crontab(
            hour=settings.MORNING_FEED_HOUR, minute=settings.MORNING_FEED_MINUTE
        ),
    },
}
