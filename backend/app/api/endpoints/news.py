from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_current_user, get_db
from app.core.config import settings
from app.crud import article as crud_article
from app.db import model as db_model
from app.schemas import news as news_schema
from app.services.feed_editions import (
    DEFAULT_TIMEZONE,
    EDITION_BY_TYPE,
    EDITION_DEFINITIONS,
    MORNING_BRIEF,
    edition_publish_at,
    expected_edition_types,
    local_feed_date,
    local_now,
    normalize_timezone,
    validate_edition_type,
)
from app.services.recommendations import build_today_feed
from app.services.user_profile import log_interaction
from app.tasks import (
    backfill_interest_based_news_task,
    embed_articles_task,
    fetch_news_task,
    generate_feed_edition_task,
    reprocess_articles_task,
    run_daily_pipeline_task,
    summarize_articles_task,
)

router = APIRouter()


@router.post("/tasks/fetch-news", status_code=202)
def trigger_fetch_news():
    async_result = fetch_news_task.delay()
    return {"message": "News ingestion task queued.", "task_id": async_result.id}


@router.post("/tasks/summarize-news", status_code=202)
def trigger_summarization(
    limit: int = Query(default=100, ge=1, le=500),
    force_refresh: bool = Query(default=False),
):
    async_result = summarize_articles_task.delay(
        limit=limit, force_refresh=force_refresh
    )
    return {"message": "Summarization task queued.", "task_id": async_result.id}


@router.post("/tasks/generate-feeds", status_code=202)
def trigger_feed_generation(
    feed_date: date | None = None,
    edition_type: str = Query(default=MORNING_BRIEF),
    market_timezone: str = Query(default=DEFAULT_TIMEZONE),
    force_refresh: bool = Query(default=False),
    summarize_first: bool = Query(default=True),
    summary_limit: int = Query(default=100, ge=1, le=500),
):
    try:
        validate_edition_type(edition_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    market_timezone = normalize_timezone(market_timezone)
    async_result = generate_feed_edition_task.delay(
        feed_date.isoformat() if feed_date else None,
        edition_type,
        market_timezone,
        force_refresh,
        summarize_first,
        summary_limit,
    )
    return {"message": "Feed generation task queued.", "task_id": async_result.id}


@router.post("/tasks/daily-pipeline", status_code=202)
def trigger_daily_pipeline():
    async_result = run_daily_pipeline_task.delay()
    return {"message": "Daily news pipeline queued.", "task_id": async_result.id}


@router.post("/tasks/backfill-interest-news", status_code=202)
def trigger_interest_backfill():
    async_result = backfill_interest_based_news_task.delay()
    return {"message": "Interest backfill task queued.", "task_id": async_result.id}


@router.post("/tasks/reprocess-articles", status_code=202)
def trigger_article_reprocessing():
    async_result = reprocess_articles_task.delay()
    return {"message": "Article reprocessing task queued.", "task_id": async_result.id}


@router.post("/tasks/embed-articles", status_code=202)
def trigger_article_embeddings(limit: int = Query(default=200, ge=1, le=1000)):
    async_result = embed_articles_task.delay(limit=limit)
    return {"message": "Article embedding task queued.", "task_id": async_result.id}


def _edition_status(
    db: Session,
    *,
    user: db_model.User,
    feed_date: date,
    edition_type: str,
    market_timezone: str,
) -> news_schema.FeedEditionOut:
    total = (
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
    unread = (
        db.query(db_model.Flashcard)
        .filter(
            db_model.Flashcard.user_id == user.id,
            db_model.Flashcard.feed_date == feed_date,
            db_model.Flashcard.edition_type == edition_type,
            db_model.Flashcard.market_timezone == market_timezone,
            db_model.Flashcard.rank_position <= settings.feed_edition_size,
            db_model.Flashcard.is_viewed.is_(False),
        )
        .count()
    )
    definition = EDITION_BY_TYPE[edition_type]
    return news_schema.FeedEditionOut(
        feed_date=feed_date,
        edition_type=edition_type,
        title=definition.title,
        market_timezone=market_timezone,
        expected_publish_at=edition_publish_at(
            feed_date, edition_type, market_timezone
        ),
        is_ready=total > 0,
        total=total,
        unread=unread,
        completed=total > 0 and unread == 0,
    )


@router.get(
    "/users/me/feed-editions",
    response_model=news_schema.FeedEditionsResponse,
    response_model_by_alias=False,
)
def read_my_feed_editions(
    market_timezone: str = Query(default=DEFAULT_TIMEZONE),
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    market_timezone = normalize_timezone(market_timezone)
    today = local_feed_date(market_timezone)
    dates = [today, today - timedelta(days=1)]
    editions = [
        _edition_status(
            db,
            user=current_user,
            feed_date=feed_date,
            edition_type=definition.edition_type,
            market_timezone=market_timezone,
        )
        for feed_date in dates
        for definition in EDITION_DEFINITIONS
    ]

    now = local_now(market_timezone)
    expected_today = expected_edition_types(now)
    if expected_today:
        selected_feed_date = today
        selected_edition_type = expected_today[-1]
    else:
        selected_feed_date = today - timedelta(days=1)
        selected_edition_type = EDITION_DEFINITIONS[-1].edition_type
    return news_schema.FeedEditionsResponse(
        selected_feed_date=selected_feed_date,
        selected_edition_type=selected_edition_type,
        market_timezone=market_timezone,
        editions=editions,
    )


@router.get(
    "/users/me/feed",
    response_model=list[news_schema.FeedItem],
    response_model_by_alias=False,
)
def read_my_feed(
    feed_date: date | None = None,
    edition_type: str = Query(default=MORNING_BRIEF),
    market_timezone: str = Query(default=DEFAULT_TIMEZONE),
    force_refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    try:
        validate_edition_type(edition_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    market_timezone = normalize_timezone(market_timezone)
    target_date = feed_date or local_feed_date(market_timezone)
    build_today_feed(
        db,
        user=current_user,
        feed_date=target_date,
        edition_type=edition_type,
        market_timezone=market_timezone,
        force_refresh=force_refresh,
    )
    flashcards = (
        db.query(db_model.Flashcard)
        .options(
            joinedload(db_model.Flashcard.article).joinedload(db_model.Article.summary),
        )
        .filter(
            db_model.Flashcard.user_id == current_user.id,
            db_model.Flashcard.feed_date == target_date,
            db_model.Flashcard.edition_type == edition_type,
            db_model.Flashcard.market_timezone == market_timezone,
            db_model.Flashcard.rank_position <= settings.feed_edition_size,
        )
        .order_by(db_model.Flashcard.rank_position.asc())
        .limit(settings.feed_edition_size)
        .all()
    )
    return flashcards


@router.get(
    "/users/me/saved-articles",
    response_model=list[news_schema.FeedArticle],
    response_model_by_alias=False,
)
def read_saved_articles(
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    interactions = (
        db.query(db_model.UserArticleInteraction)
        .options(
            joinedload(db_model.UserArticleInteraction.article).joinedload(
                db_model.Article.summary
            )
        )
        .filter(
            db_model.UserArticleInteraction.user_id == current_user.id,
            db_model.UserArticleInteraction.interaction_type
            == db_model.InteractionType.SAVE,
        )
        .order_by(db_model.UserArticleInteraction.created_at.desc())
        .all()
    )
    saved_articles = []
    seen_article_ids = set()
    for interaction in interactions:
        article = interaction.article
        if article is None or article.summary is None or article.id in seen_article_ids:
            continue
        saved_articles.append(article)
        seen_article_ids.add(article.id)
    return saved_articles


@router.post(
    "/users/me/interactions",
    response_model=news_schema.InteractionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_interaction(
    payload: news_schema.InteractionCreate,
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    article = crud_article.get_article(db, payload.article_id)
    if article is None:
        raise HTTPException(status_code=404, detail="Article not found")

    interaction = log_interaction(
        db,
        user=current_user,
        article=article,
        interaction_type=payload.interaction_type,
        dwell_time_seconds=payload.dwell_time_seconds,
    )
    db.commit()
    db.refresh(interaction)
    return interaction


@router.delete("/users/me/interactions", status_code=status.HTTP_204_NO_CONTENT)
def delete_interaction(
    article_id: int = Query(..., ge=1),
    interaction_type: db_model.InteractionType = Query(...),
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    (
        db.query(db_model.UserArticleInteraction)
        .filter(
            db_model.UserArticleInteraction.user_id == current_user.id,
            db_model.UserArticleInteraction.article_id == article_id,
            db_model.UserArticleInteraction.interaction_type == interaction_type,
        )
        .delete(synchronize_session=False)
    )
    db.commit()
