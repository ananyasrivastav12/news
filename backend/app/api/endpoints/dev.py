from datetime import datetime, timedelta, timezone
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_current_user, get_db
from app.core.config import settings
from app.db import model as db_model
from app.schemas import news as news_schema
from app.services.article_pipeline import build_story_key, normalize_title
from app.services.recommendations import build_today_feed
from app.tasks.news_fetching import fetch_news_task

router = APIRouter()


@router.post("/dev/smoke", status_code=status.HTTP_202_ACCEPTED)
def smoke(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Triggers a minimal background run to verify:
    - Redis/Celery wiring works
    - News fetch task can be queued
    - Required config is present
    """
    if not settings.NEWS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="NEWS_API_KEY is not set",
        )

    # enqueue celery task
    async_result = fetch_news_task.delay()

    return {
        "queued": True,
        "task_id": async_result.id,
        "user_id": getattr(current_user, "id", None),
    }


DEMO_ARTICLES = [
    {
        "category": "technology",
        "title": "AI tools move from demos into daily newsroom workflows",
        "source": "Local Demo",
        "url": "https://example.com/demo/ai-newsroom-workflows",
        "description": "Editors are testing AI assistants for research, headline review, and story packaging.",
        "takeaway": "News teams are shifting AI from novelty demos into practical production steps.",
        "supporting": [
            "The highest-value uses are repetitive research and format conversion.",
            "Editors still keep final control over language, sourcing, and publication.",
        ],
        "keywords": ["ai", "software", "newsroom", "workflow"],
    },
    {
        "category": "business",
        "title": "Markets watch consumer spending as companies update forecasts",
        "source": "Local Demo",
        "url": "https://example.com/demo/consumer-spending-forecasts",
        "description": "Retailers and analysts are looking for signs that household budgets are tightening.",
        "takeaway": "Consumer spending is becoming the key signal for near-term business confidence.",
        "supporting": [
            "Forecast updates are focusing on demand quality, not just headline revenue.",
            "Companies with pricing power are expected to hold up better.",
        ],
        "keywords": ["market", "earnings", "economy", "company"],
    },
    {
        "category": "health",
        "title": "New wellness programs put sleep and stress data in one dashboard",
        "source": "Local Demo",
        "url": "https://example.com/demo/wellness-sleep-stress",
        "description": "Clinics and employers are experimenting with integrated health tracking.",
        "takeaway": "Health programs are treating sleep and stress as connected signals.",
        "supporting": [
            "The new tools aim to spot patterns before symptoms become acute.",
            "Privacy and consent remain central concerns for broad adoption.",
        ],
        "keywords": ["health", "wellness", "patient", "diagnosis"],
    },
    {
        "category": "science",
        "title": "Researchers test cheaper sensors for neighborhood climate mapping",
        "source": "Local Demo",
        "url": "https://example.com/demo/neighborhood-climate-sensors",
        "description": "A new study explores lower-cost ways to map heat and air quality block by block.",
        "takeaway": "Cheaper sensors could make climate data more useful at a neighborhood level.",
        "supporting": [
            "Local readings can show risks that citywide averages hide.",
            "Researchers are still validating accuracy across weather conditions.",
        ],
        "keywords": ["research", "climate", "study", "science"],
    },
    {
        "category": "entertainment",
        "title": "Streaming platforms experiment with shorter seasons and faster releases",
        "source": "Local Demo",
        "url": "https://example.com/demo/streaming-shorter-seasons",
        "description": "Studios are rethinking release cadence as audiences split time across services.",
        "takeaway": "Streaming services are testing faster formats to keep audiences engaged.",
        "supporting": [
            "Shorter seasons can reduce production risk and speed up feedback.",
            "The tradeoff is less time for shows to build deep fan habits.",
        ],
        "keywords": ["streaming", "series", "show", "tv"],
    },
    {
        "category": "sports",
        "title": "Teams lean on player tracking data for late-season decisions",
        "source": "Local Demo",
        "url": "https://example.com/demo/player-tracking-decisions",
        "description": "Coaches are blending performance data with scouting notes before key matchups.",
        "takeaway": "Player tracking data is becoming a routine part of coaching decisions.",
        "supporting": [
            "The data helps staff balance workload, fatigue, and matchup planning.",
            "Coaches say context still matters more than any single metric.",
        ],
        "keywords": ["game", "player", "coach", "season"],
    },
]


@router.post("/dev/demo-feed", status_code=status.HTTP_201_CREATED)
def seed_demo_feed(
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    created = 0

    for index, payload in enumerate(DEMO_ARTICLES):
        article = (
            db.query(db_model.Article)
            .filter(db_model.Article.original_url == payload["url"])
            .first()
        )
        if article is None:
            normalized_title = normalize_title(payload["title"])
            article = db_model.Article(
                title=payload["title"],
                normalized_title=normalized_title,
                original_url=payload["url"],
                source=payload["source"],
                country="us",
                description=payload["description"],
                content=payload["description"],
                raw_text=f"{payload['title']}\n{payload['description']}",
                cleaned_text=f"{payload['title']} {payload['description']}",
                published_at=now - timedelta(minutes=index * 25),
                primary_category=payload["category"],
                image_url=None,
                keywords=payload["keywords"],
                story_key=build_story_key(normalized_title),
                summary_status=db_model.SummaryStatus.COMPLETED,
                processed_at=now,
            )
            db.add(article)
            db.flush()
            created += 1

        if article.summary is None:
            db.add(
                db_model.Summary(
                    article_id=article.id,
                    main_takeaway=payload["takeaway"],
                    supporting_lines=payload["supporting"],
                    summary_text=" ".join(
                        [
                            cast(str, payload["takeaway"]),
                            *cast(list[str], payload["supporting"]),
                        ]
                    ),
                    model_name="local-demo",
                )
            )
            article.summary_status = db_model.SummaryStatus.COMPLETED

    db.commit()

    user = (
        db.query(db_model.User)
        .options(
            joinedload(db_model.User.interests).joinedload(
                db_model.UserInterest.interest
            ),
            joinedload(db_model.User.category_preferences),
            joinedload(db_model.User.keyword_preferences),
            joinedload(db_model.User.embedding_profile),
            joinedload(db_model.User.interactions).joinedload(
                db_model.UserArticleInteraction.article
            ),
        )
        .filter(db_model.User.id == current_user.id)
        .one()
    )
    build_today_feed(db, user=user, force_refresh=True)
    flashcards = (
        db.query(db_model.Flashcard)
        .options(
            joinedload(db_model.Flashcard.article).joinedload(db_model.Article.summary),
        )
        .filter(db_model.Flashcard.user_id == current_user.id)
        .order_by(db_model.Flashcard.rank_position.asc())
        .all()
    )
    items = [news_schema.FeedItem.model_validate(card) for card in flashcards]
    return {
        "message": f"Loaded {len(items)} demo cards.",
        "created_articles": created,
        "items": items,
    }
