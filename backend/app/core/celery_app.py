from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery = Celery(
    "tasks",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks"],
)

celery.conf.timezone = "UTC"
celery.conf.beat_schedule = {
    "feed-edition-dispatcher": {
        "task": "app.tasks.news_fetching.dispatch_scheduled_editions_task",
        "schedule": crontab(minute="*/15"),
    },
}
