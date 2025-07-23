# In app/tasks/news_fetching.py

import asyncio
import traceback

from app.core.celery_app import celery
from app.crud import article as crud_article
from app.crud import user as crud_user
from app.db.model import SourceType
from app.db.session import SessionLocal
from app.services import news as news_service  # <-- Moved back to top


async def _async_fetch_and_save(db):
    print("--- Celery task: Async helper started. ---")
    users = db.query(crud_user.db_model.User).all()
    print(f"--- Found {len(users)} users to process. ---")

    for user in users:
        print(f"--- Processing user ID: {user.id} ---")
        news_interests = [
            ui.interest
            for ui in user.interests
            if ui.interest.source_type == SourceType.NEWS
        ]
        print(
            f"--- User {user.id} has news interests: {[i.name for i in news_interests]} ---"
        )

        for interest in news_interests:
            print(f"--- Fetching articles for interest: {interest.name} ---")
            articles_data = await news_service.fetch_top_headlines(
                category=interest.name
            )
            print(f"--- Found {len(articles_data)} articles for {interest.name}. ---")

            for article_data in articles_data:
                try:
                    if not article_data.get("url"):
                        print(
                            f"--- Skipping article with no URL: {article_data.get('title')} ---"
                        )
                        continue
                    crud_article.create_article(db=db, article_data=article_data)
                except Exception as article_exc:
                    print(
                        f"--- Could not process article: {article_data.get('title')} ---"
                    )
                    print(f"--- Reason: {article_exc} ---")


@celery.task
def fetch_news_task():
    print("--- Celery task started: Fetching news... ---")
    db = SessionLocal()
    try:
        asyncio.run(_async_fetch_and_save(db))
        print("--- Celery task finished successfully. ---")
    except Exception:
        print("--- A critical error occurred in the Celery task: ---")
        print(traceback.format_exc())
    finally:
        print("--- Celery task: Closing database session. ---")
        db.close()
