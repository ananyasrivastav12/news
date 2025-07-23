# In app/api/endpoints/news.py

from fastapi import APIRouter

from app.tasks import fetch_news_task  # <-- Simplified import

router = APIRouter()


@router.post("/tasks/fetch-news", status_code=202)
def trigger_fetch_news():
    """
    Triggers a Celery background task to fetch news for all users.
    """
    fetch_news_task.delay()
    return {"message": "News fetching task has been sent to the queue."}
