from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload, selectinload

from app.api.dependencies import get_current_admin_user, get_db
from app.core.config import settings
from app.crud import user as crud_user
from app.db import model as db_model
from app.schemas import admin as admin_schema
from app.services.admin_observability import build_article_distribution
from app.services.admin_pipeline import (
    create_pipeline_run,
    next_daily_run_at,
    run_pipeline_background,
)
from app.services.feed_editions import (
    DEFAULT_TIMEZONE,
    MORNING_BRIEF,
    local_feed_date,
    normalize_timezone,
    validate_edition_type,
)
from app.tasks.news_fetching import _build_user_feed

router = APIRouter(prefix="/admin", dependencies=[Depends(get_current_admin_user)])


@router.get("/overview", response_model=admin_schema.AdminOverview)
def read_admin_overview(db: Session = Depends(get_db)):
    fresh_cutoff = datetime.now(timezone.utc) - timedelta(
        hours=settings.ARTICLE_MAX_AGE_HOURS
    )
    categories = [
        category.strip()
        for category in settings.NEWS_BATCH_CATEGORIES.split(",")
        if category.strip()
    ]
    pending_summaries = (
        db.query(db_model.Article)
        .filter(db_model.Article.summary_status == db_model.SummaryStatus.PENDING)
        .count()
    )
    embedding_candidates = (
        db.query(db_model.Article)
        .filter(
            db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED,
            db_model.Article.embedding.is_(None),
        )
        .count()
    )
    last_successful_run = (
        db.query(db_model.PipelineRun)
        .filter(db_model.PipelineRun.status == db_model.PipelineRunStatus.SUCCEEDED)
        .order_by(desc(db_model.PipelineRun.finished_at))
        .first()
    )
    next_schedule = (
        db.query(db_model.PipelineSchedule)
        .filter(
            db_model.PipelineSchedule.enabled.is_(True),
            db_model.PipelineSchedule.next_run_at.isnot(None),
        )
        .order_by(db_model.PipelineSchedule.next_run_at.asc())
        .first()
    )
    return {
        "total_articles": db.query(db_model.Article).count(),
        "fresh_articles": db.query(db_model.Article)
        .filter(db_model.Article.published_at >= fresh_cutoff)
        .count(),
        "pending_summaries": pending_summaries,
        "completed_summaries": db.query(db_model.Article)
        .filter(db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED)
        .count(),
        "failed_summaries": db.query(db_model.Article)
        .filter(db_model.Article.summary_status == db_model.SummaryStatus.FAILED)
        .count(),
        "feed_items_generated": db.query(db_model.Flashcard).count(),
        "users_with_feeds": db.query(db_model.Flashcard.user_id).distinct().count(),
        "total_users": db.query(db_model.User).count(),
        "current_feed_size": settings.feed_edition_size,
        "article_pool_limit": settings.ARTICLE_POOL_LIMIT,
        "max_feed_items": settings.MAX_FEED_ITEMS,
        "viewed_count": _interaction_count(db, db_model.InteractionType.VIEW),
        "liked_count": _interaction_count(db, db_model.InteractionType.LIKE),
        "disliked_count": _interaction_count(db, db_model.InteractionType.SKIP),
        "saved_count": _interaction_count(db, db_model.InteractionType.SAVE),
        "newsapi_requests_planned": len(settings.news_api_countries) * len(categories),
        "newsapi_page_size": settings.NEWS_API_PAGE_SIZE,
        "newsapi_daily_target": settings.NEWS_DAILY_ARTICLE_TARGET,
        "openai_summary_calls_planned": pending_summaries,
        "openai_daily_summary_limit": settings.OPENAI_DAILY_SUMMARY_LIMIT,
        "openai_embedding_calls_planned": embedding_candidates,
        "last_successful_run_at": (
            last_successful_run.finished_at if last_successful_run else None
        ),
        "next_scheduled_run_at": next_schedule.next_run_at if next_schedule else None,
    }


@router.get("/pipeline-runs", response_model=list[admin_schema.PipelineRunOut])
def read_pipeline_runs(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return (
        db.query(db_model.PipelineRun)
        .options(selectinload(db_model.PipelineRun.logs))
        .order_by(desc(db_model.PipelineRun.created_at), desc(db_model.PipelineRun.id))
        .limit(limit)
        .all()
    )


@router.post(
    "/pipeline-runs/full",
    response_model=admin_schema.PipelineRunQueued,
    status_code=status.HTTP_202_ACCEPTED,
)
def run_full_pipeline(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    return _queue_pipeline_run(db, background_tasks, "full_pipeline")


@router.post(
    "/pipeline-runs/ingest",
    response_model=admin_schema.PipelineRunQueued,
    status_code=status.HTTP_202_ACCEPTED,
)
def run_ingestion(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    return _queue_pipeline_run(db, background_tasks, "ingestion")


@router.post(
    "/pipeline-runs/summarize",
    response_model=admin_schema.PipelineRunQueued,
    status_code=status.HTTP_202_ACCEPTED,
)
def run_summarization(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    return _queue_pipeline_run(db, background_tasks, "summarization")


@router.post(
    "/pipeline-runs/generate-feeds",
    response_model=admin_schema.PipelineRunQueued,
    status_code=status.HTTP_202_ACCEPTED,
)
def run_feed_generation(
    payload: admin_schema.AdminFeedGenerationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    if payload.edition_type != "all":
        try:
            validate_edition_type(payload.edition_type)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _queue_pipeline_run(
        db,
        background_tasks,
        "feed_generation",
        options={
            "edition_type": payload.edition_type,
            "market_timezone": normalize_timezone(payload.market_timezone),
            "feed_date": payload.feed_date,
            "force_refresh": payload.force_refresh,
            "summarize_first": payload.summarize_first,
            "run_ingestion_first": payload.run_ingestion_first,
        },
    )


@router.get("/articles", response_model=list[admin_schema.AdminArticleOut])
def read_admin_articles(
    country: str | None = None,
    category: str | None = None,
    source: str | None = None,
    summary_status: db_model.SummaryStatus | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(db_model.Article).options(
        selectinload(db_model.Article.interactions)
    )
    if country:
        query = query.filter(db_model.Article.country == country.lower())
    if category:
        query = query.filter(db_model.Article.primary_category == category.lower())
    if source:
        query = query.filter(db_model.Article.source.ilike(f"%{source}%"))
    if summary_status:
        query = query.filter(db_model.Article.summary_status == summary_status)

    articles = (
        query.order_by(
            desc(db_model.Article.published_at).nullslast(),
            desc(db_model.Article.fetched_at),
        )
        .limit(limit)
        .all()
    )
    return [_article_row(article) for article in articles]


@router.get(
    "/article-distribution",
    response_model=admin_schema.ArticleDistributionOut,
)
def read_article_distribution(
    fresh_only: bool = False,
    summary_status: db_model.SummaryStatus | None = None,
    db: Session = Depends(get_db),
):
    return build_article_distribution(
        db,
        fresh_only=fresh_only,
        summary_status=summary_status,
    )


@router.get("/articles/{article_id}", response_model=admin_schema.AdminArticleDetail)
def read_admin_article(article_id: int, db: Session = Depends(get_db)):
    article = (
        db.query(db_model.Article)
        .options(
            joinedload(db_model.Article.summary),
            selectinload(db_model.Article.interactions),
        )
        .filter(db_model.Article.id == article_id)
        .first()
    )
    if article is None:
        raise HTTPException(status_code=404, detail="Article not found")
    row = _article_row(article)
    row.update(
        {
            "original_url": article.original_url,
            "description": article.description,
            "cleaned_text": article.cleaned_text,
            "summary_text": article.summary.summary_text if article.summary else None,
            "main_takeaway": article.summary.main_takeaway if article.summary else None,
        }
    )
    return row


@router.post(
    "/articles/{article_id}/resummarize",
    response_model=admin_schema.PipelineRunQueued,
    status_code=status.HTTP_202_ACCEPTED,
)
def resummarize_article(
    article_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    article = db.get(db_model.Article, article_id)
    if article is None:
        raise HTTPException(status_code=404, detail="Article not found")
    article.summary_status = db_model.SummaryStatus.PENDING
    db.commit()
    return _queue_pipeline_run(db, background_tasks, "summarization")


@router.delete("/articles/{article_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_admin_article(article_id: int, db: Session = Depends(get_db)):
    article = db.get(db_model.Article, article_id)
    if article is None:
        raise HTTPException(status_code=404, detail="Article not found")
    (
        db.query(db_model.Flashcard)
        .filter(db_model.Flashcard.article_id == article_id)
        .delete(synchronize_session=False)
    )
    (
        db.query(db_model.UserArticleInteraction)
        .filter(db_model.UserArticleInteraction.article_id == article_id)
        .delete(synchronize_session=False)
    )
    (
        db.query(db_model.SummaryReview)
        .filter(db_model.SummaryReview.article_id == article_id)
        .delete(synchronize_session=False)
    )
    db.delete(article)
    db.commit()


@router.get("/users", response_model=list[admin_schema.AdminUserOut])
def read_admin_users(db: Session = Depends(get_db)):
    users = (
        db.query(db_model.User)
        .options(
            selectinload(db_model.User.interests).joinedload(
                db_model.UserInterest.interest
            ),
            selectinload(db_model.User.interactions),
            selectinload(db_model.User.flashcards),
        )
        .order_by(db_model.User.email.asc())
        .all()
    )
    return [_user_row(user) for user in users]


@router.post(
    "/users",
    response_model=admin_schema.AdminUserCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_admin_user(
    payload: admin_schema.AdminUserCreate,
    db: Session = Depends(get_db),
):
    existing = crud_user.get_user_by_email(db, email=str(payload.email))
    if existing is not None:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = crud_user.create_user(db, payload)
    return {
        "id": user.id,
        "email": user.email,
        "interests": [],
    }


@router.get("/users/{user_id}/feed", response_model=list[admin_schema.UserFeedItemOut])
def read_admin_user_feed(user_id: int, db: Session = Depends(get_db)):
    user = db.get(db_model.User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    interactions = (
        db.query(db_model.UserArticleInteraction)
        .filter(db_model.UserArticleInteraction.user_id == user_id)
        .all()
    )
    by_article: dict[int, set[db_model.InteractionType]] = {}
    for interaction in interactions:
        by_article.setdefault(interaction.article_id, set()).add(
            interaction.interaction_type
        )
    flashcards = (
        db.query(db_model.Flashcard)
        .options(joinedload(db_model.Flashcard.article))
        .filter(
            db_model.Flashcard.user_id == user_id,
            db_model.Flashcard.rank_position <= settings.feed_edition_size,
        )
        .order_by(
            desc(db_model.Flashcard.feed_date),
            db_model.Flashcard.edition_type,
            db_model.Flashcard.rank_position,
        )
        .limit(settings.MAX_FEED_ITEMS)
        .all()
    )
    return [
        {
            "feed_date": flashcard.feed_date.isoformat(),
            "edition_type": flashcard.edition_type,
            "market_timezone": flashcard.market_timezone,
            "rank_position": flashcard.rank_position,
            "article_id": flashcard.article_id,
            "title": flashcard.article.title,
            "country": flashcard.article.country,
            "category": flashcard.article.primary_category,
            "ranking_reason": flashcard.ranking_reason,
            "is_viewed": flashcard.is_viewed,
            "score": flashcard.ranking_score,
            "liked": db_model.InteractionType.LIKE
            in by_article.get(flashcard.article_id, set()),
            "saved": db_model.InteractionType.SAVE
            in by_article.get(flashcard.article_id, set()),
            "disliked": db_model.InteractionType.SKIP
            in by_article.get(flashcard.article_id, set()),
        }
        for flashcard in flashcards
        if flashcard.article is not None
    ]


@router.post("/users/{user_id}/rebuild-feed")
def rebuild_admin_user_feed(
    user_id: int,
    edition_type: str = Query(default=MORNING_BRIEF),
    market_timezone: str = Query(default=DEFAULT_TIMEZONE),
    feed_date: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        validate_edition_type(edition_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    market_timezone = normalize_timezone(market_timezone)
    target_date = (
        datetime.fromisoformat(feed_date).date()
        if feed_date
        else local_feed_date(market_timezone)
    )
    user = (
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
        .filter(db_model.User.id == user_id)
        .first()
    )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    feed_count = _build_user_feed(
        db,
        user,
        target_date,
        edition_type=edition_type,
        market_timezone=market_timezone,
        force_refresh=True,
    )
    return {
        "user_id": user_id,
        "feed_items": feed_count,
        "feed_date": target_date.isoformat(),
        "edition_type": edition_type,
        "market_timezone": market_timezone,
    }


@router.get("/summary-reviews", response_model=list[admin_schema.SummaryReviewOut])
def read_summary_reviews(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return (
        db.query(db_model.SummaryReview)
        .order_by(desc(db_model.SummaryReview.created_at))
        .limit(limit)
        .all()
    )


@router.post(
    "/summary-reviews",
    response_model=admin_schema.SummaryReviewOut,
    status_code=status.HTTP_201_CREATED,
)
def create_summary_review(
    payload: admin_schema.SummaryReviewCreate,
    db: Session = Depends(get_db),
    admin_user: db_model.User = Depends(get_current_admin_user),
):
    article = (
        db.query(db_model.Article)
        .options(joinedload(db_model.Article.summary))
        .filter(db_model.Article.id == payload.article_id)
        .first()
    )
    if article is None:
        raise HTTPException(status_code=404, detail="Article not found")
    review = db_model.SummaryReview(
        article_id=article.id,
        summary_id=article.summary.id if article.summary else None,
        reviewer_user_id=admin_user.id,
        rating=payload.rating,
        issue_type=payload.issue_type,
        notes=payload.notes,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


@router.get("/schedules", response_model=list[admin_schema.PipelineScheduleOut])
def read_schedules(db: Session = Depends(get_db)):
    return (
        db.query(db_model.PipelineSchedule)
        .order_by(db_model.PipelineSchedule.hour, db_model.PipelineSchedule.minute)
        .all()
    )


@router.post(
    "/schedules",
    response_model=admin_schema.PipelineScheduleOut,
    status_code=status.HTTP_201_CREATED,
)
def create_schedule(
    payload: admin_schema.PipelineScheduleCreate,
    db: Session = Depends(get_db),
):
    schedule = db_model.PipelineSchedule(
        **payload.model_dump(),
        next_run_at=(
            next_daily_run_at(payload.hour, payload.minute) if payload.enabled else None
        ),
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return schedule


@router.patch(
    "/schedules/{schedule_id}", response_model=admin_schema.PipelineScheduleOut
)
def update_schedule(
    schedule_id: int,
    payload: admin_schema.PipelineScheduleUpdate,
    db: Session = Depends(get_db),
):
    schedule = db.get(db_model.PipelineSchedule, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(schedule, key, value)
    if {"enabled", "hour", "minute"} & updates.keys():
        schedule.next_run_at = (
            next_daily_run_at(schedule.hour, schedule.minute)
            if schedule.enabled
            else None
        )
    db.commit()
    db.refresh(schedule)
    return schedule


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_schedule(schedule_id: int, db: Session = Depends(get_db)):
    schedule = db.get(db_model.PipelineSchedule, schedule_id)
    if schedule is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    db.delete(schedule)
    db.commit()


def _queue_pipeline_run(
    db: Session,
    background_tasks: BackgroundTasks,
    run_type: str,
    options: dict[str, object] | None = None,
) -> dict[str, object]:
    metadata = {"options": options or {}}
    pipeline_run = create_pipeline_run(db, run_type, metadata=metadata)
    background_tasks.add_task(
        run_pipeline_background,
        pipeline_run.id,
        run_type,
        options or {},
    )
    return {
        "id": pipeline_run.id,
        "status": pipeline_run.status.value,
        "message": f"{run_type.replace('_', ' ').title()} queued.",
    }


def _interaction_count(db: Session, interaction_type: db_model.InteractionType) -> int:
    return (
        db.query(db_model.UserArticleInteraction)
        .filter(db_model.UserArticleInteraction.interaction_type == interaction_type)
        .count()
    )


def _article_row(article: db_model.Article) -> dict[str, object]:
    is_protected = any(
        interaction.interaction_type == db_model.InteractionType.SAVE
        for interaction in article.interactions
    )
    return {
        "id": article.id,
        "title": article.title,
        "source": article.source,
        "country": article.country,
        "primary_category": article.primary_category,
        "published_at": article.published_at,
        "fetched_at": article.fetched_at,
        "summary_status": article.summary_status.value,
        "image_present": bool(article.image_url),
        "interaction_count": len(article.interactions),
        "is_protected": is_protected,
    }


def _user_row(user: db_model.User) -> dict[str, object]:
    interactions = user.interactions
    flashcards = user.flashcards
    today = datetime.now(timezone.utc).date()
    current_flashcards = [
        flashcard
        for flashcard in flashcards
        if flashcard.feed_date == today
        and flashcard.rank_position <= settings.feed_edition_size
    ]
    last_active = max(
        (
            interaction.created_at
            for interaction in interactions
            if interaction.created_at
        ),
        default=None,
    )
    last_feed_generated = max(
        (flashcard.delivered_at for flashcard in flashcards if flashcard.delivered_at),
        default=None,
    )
    return {
        "id": user.id,
        "email": user.email,
        "interests": [link.interest.name for link in user.interests if link.interest],
        "feed_count": len(current_flashcards),
        "viewed_count": sum(
            1
            for item in interactions
            if item.interaction_type == db_model.InteractionType.VIEW
        ),
        "liked_count": sum(
            1
            for item in interactions
            if item.interaction_type == db_model.InteractionType.LIKE
        ),
        "disliked_count": sum(
            1
            for item in interactions
            if item.interaction_type == db_model.InteractionType.SKIP
        ),
        "saved_count": sum(
            1
            for item in interactions
            if item.interaction_type == db_model.InteractionType.SAVE
        ),
        "last_active": last_active,
        "last_feed_generated": last_feed_generated,
    }
