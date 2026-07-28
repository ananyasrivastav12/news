# admin-only routes for dashboard metrics, users, articles, and pipeline control
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import desc, or_
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
    embedded_articles = (
        db.query(db_model.Article)
        .filter(
            db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED,
            db_model.Article.embedding.isnot(None),
        )
        .count()
    )
    fresh_embedded_articles = (
        db.query(db_model.Article)
        .filter(
            db_model.Article.published_at >= fresh_cutoff,
            db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED,
            db_model.Article.embedding.isnot(None),
        )
        .count()
    )
    _refresh_schedule_next_runs(db)
    last_successful_run = (
        db.query(db_model.PipelineRun)
        .filter(db_model.PipelineRun.status == db_model.PipelineRunStatus.SUCCEEDED)
        .order_by(desc(db_model.PipelineRun.finished_at))
        .first()
    )
    latest_content_pipeline_run = (
        db.query(db_model.PipelineRun)
        .filter(
            db_model.PipelineRun.status == db_model.PipelineRunStatus.SUCCEEDED,
            db_model.PipelineRun.run_type != "feed_generation",
        )
        .order_by(desc(db_model.PipelineRun.finished_at))
        .first()
    )
    latest_article = (
        db.query(db_model.Article)
        .order_by(desc(db_model.Article.fetched_at).nullslast())
        .first()
    )
    latest_processed_article = (
        db.query(db_model.Article)
        .filter(db_model.Article.processed_at.isnot(None))
        .order_by(desc(db_model.Article.processed_at))
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
    total_users = db.query(db_model.User).count()
    protected_articles = (
        db.query(db_model.UserArticleInteraction.article_id)
        .filter(
            db_model.UserArticleInteraction.interaction_type
            == db_model.InteractionType.SAVE
        )
        .distinct()
        .count()
    )
    today_start, today_end = _local_day_bounds(DEFAULT_TIMEZONE)
    recent_start = datetime.now(timezone.utc) - timedelta(days=7)
    return {
        "total_articles": db.query(db_model.Article).count(),
        "fresh_articles": db.query(db_model.Article)
        .filter(db_model.Article.published_at >= fresh_cutoff)
        .count(),
        "fresh_completed_articles": db.query(db_model.Article)
        .filter(
            db_model.Article.published_at >= fresh_cutoff,
            db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED,
        )
        .count(),
        "fresh_cutoff_at": fresh_cutoff,
        "pending_summaries": pending_summaries,
        "completed_summaries": db.query(db_model.Article)
        .filter(db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED)
        .count(),
        "failed_summaries": db.query(db_model.Article)
        .filter(db_model.Article.summary_status == db_model.SummaryStatus.FAILED)
        .count(),
        "feed_items_generated": db.query(db_model.Flashcard).count(),
        "embedded_articles": embedded_articles,
        "fresh_embedded_articles": fresh_embedded_articles,
        "users_with_feeds": db.query(db_model.Flashcard.user_id).distinct().count(),
        "users_with_interests": (
            db.query(db_model.UserInterest.user_id).distinct().count()
        ),
        "total_users": total_users,
        "protected_articles": protected_articles,
        "current_feed_size": settings.feed_edition_size,
        "article_pool_limit": settings.ARTICLE_POOL_LIMIT,
        "max_feed_items": settings.MAX_FEED_ITEMS,
        "viewed_count": _interaction_count(db, db_model.InteractionType.VIEW),
        "liked_count": _interaction_count(db, db_model.InteractionType.LIKE),
        "disliked_count": _interaction_count(db, db_model.InteractionType.SKIP),
        "saved_count": _interaction_count(db, db_model.InteractionType.SAVE),
        "today_viewed_count": _interaction_count(
            db,
            db_model.InteractionType.VIEW,
            created_from=today_start,
            created_to=today_end,
        ),
        "today_liked_count": _interaction_count(
            db,
            db_model.InteractionType.LIKE,
            created_from=today_start,
            created_to=today_end,
        ),
        "today_disliked_count": _interaction_count(
            db,
            db_model.InteractionType.SKIP,
            created_from=today_start,
            created_to=today_end,
        ),
        "today_saved_count": _interaction_count(
            db,
            db_model.InteractionType.SAVE,
            created_from=today_start,
            created_to=today_end,
        ),
        "active_users_today": _active_user_count(
            db, created_from=today_start, created_to=today_end
        ),
        "active_users_recent": _active_user_count(db, created_from=recent_start),
        "newsapi_requests_planned": len(settings.news_api_countries) * len(categories),
        "newsapi_page_size": settings.NEWS_API_PAGE_SIZE,
        "newsapi_daily_target": settings.NEWS_DAILY_ARTICLE_TARGET,
        "openai_summary_calls_planned": pending_summaries,
        "openai_daily_summary_limit": settings.OPENAI_DAILY_SUMMARY_LIMIT,
        "openai_embedding_calls_planned": embedding_candidates,
        "last_successful_run_at": (
            last_successful_run.finished_at if last_successful_run else None
        ),
        "latest_content_pipeline_at": (
            latest_content_pipeline_run.finished_at
            if latest_content_pipeline_run
            else None
        ),
        "latest_article_fetched_at": (
            latest_article.fetched_at if latest_article else None
        ),
        "latest_article_processed_at": (
            latest_processed_article.processed_at if latest_processed_article else None
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
    fresh_only: bool = False,
    has_image: bool | None = None,
    has_signals: bool | None = None,
    interaction_type: db_model.InteractionType | None = None,
    is_protected: bool | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_field: str = "published",
    market_timezone: str = DEFAULT_TIMEZONE,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    query = _filtered_article_query(
        db,
        country=country,
        category=category,
        source=source,
        summary_status=summary_status,
        fresh_only=fresh_only,
        has_image=has_image,
        has_signals=has_signals,
        interaction_type=interaction_type,
        is_protected=is_protected,
        date_from=date_from,
        date_to=date_to,
        date_field=date_field,
        market_timezone=market_timezone,
    ).options(selectinload(db_model.Article.interactions))
    order_column = _article_date_column(date_field)
    articles = (
        query.order_by(
            desc(order_column).nullslast(),
            desc(db_model.Article.fetched_at).nullslast(),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_article_row(article) for article in articles]


@router.get(
    "/articles/summary",
    response_model=admin_schema.AdminArticleSearchSummary,
)
def read_admin_article_search_summary(
    country: str | None = None,
    category: str | None = None,
    source: str | None = None,
    summary_status: db_model.SummaryStatus | None = None,
    fresh_only: bool = False,
    has_image: bool | None = None,
    has_signals: bool | None = None,
    interaction_type: db_model.InteractionType | None = None,
    is_protected: bool | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_field: str = "published",
    market_timezone: str = DEFAULT_TIMEZONE,
    db: Session = Depends(get_db),
):
    query = _filtered_article_query(
        db,
        country=country,
        category=category,
        source=source,
        summary_status=summary_status,
        fresh_only=fresh_only,
        has_image=has_image,
        has_signals=has_signals,
        interaction_type=interaction_type,
        is_protected=is_protected,
        date_from=date_from,
        date_to=date_to,
        date_field=date_field,
        market_timezone=market_timezone,
    )
    missing_image_filter = or_(
        db_model.Article.image_url.is_(None),
        db_model.Article.image_url == "",
    )
    return {
        "total_count": query.count(),
        "completed_count": query.filter(
            db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED
        ).count(),
        "missing_image_count": query.filter(missing_image_filter).count(),
        "with_signal_count": query.filter(db_model.Article.interactions.any()).count(),
        "viewed_count": query.filter(
            db_model.Article.interactions.any(
                db_model.UserArticleInteraction.interaction_type
                == db_model.InteractionType.VIEW
            )
        ).count(),
        "liked_count": query.filter(
            db_model.Article.interactions.any(
                db_model.UserArticleInteraction.interaction_type
                == db_model.InteractionType.LIKE
            )
        ).count(),
        "disliked_count": query.filter(
            db_model.Article.interactions.any(
                db_model.UserArticleInteraction.interaction_type
                == db_model.InteractionType.SKIP
            )
        ).count(),
        "saved_count": query.filter(
            db_model.Article.interactions.any(
                db_model.UserArticleInteraction.interaction_type
                == db_model.InteractionType.SAVE
            )
        ).count(),
    }


@router.get("/articles/sources", response_model=list[str])
def read_admin_article_sources(
    country: str | None = None,
    category: str | None = None,
    summary_status: db_model.SummaryStatus | None = None,
    fresh_only: bool = False,
    has_image: bool | None = None,
    has_signals: bool | None = None,
    interaction_type: db_model.InteractionType | None = None,
    is_protected: bool | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_field: str = "published",
    market_timezone: str = DEFAULT_TIMEZONE,
    db: Session = Depends(get_db),
):
    query = _filtered_article_query(
        db,
        country=country,
        category=category,
        source=None,
        summary_status=summary_status,
        fresh_only=fresh_only,
        has_image=has_image,
        has_signals=has_signals,
        interaction_type=interaction_type,
        is_protected=is_protected,
        date_from=date_from,
        date_to=date_to,
        date_field=date_field,
        market_timezone=market_timezone,
    )
    rows = (
        query.with_entities(db_model.Article.source)
        .filter(db_model.Article.source.isnot(None), db_model.Article.source != "")
        .distinct()
        .order_by(db_model.Article.source.asc())
        .all()
    )
    return [source for (source,) in rows if source]


@router.get(
    "/article-distribution",
    response_model=admin_schema.ArticleDistributionOut,
)
def read_article_distribution(
    fresh_only: bool = False,
    summary_status: db_model.SummaryStatus | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    date_field: str = "published",
    market_timezone: str = DEFAULT_TIMEZONE,
    db: Session = Depends(get_db),
):
    range_from, range_to = _published_date_range(
        date_from=date_from,
        date_to=date_to,
        market_timezone=market_timezone,
    )
    _article_date_column(date_field)
    return build_article_distribution(
        db,
        fresh_only=fresh_only,
        summary_status=summary_status,
        date_field=date_field,
        date_from=range_from,
        date_to=range_to,
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
            "display_headline": (
                article.summary.display_headline if article.summary else None
            ),
            "main_takeaway": article.summary.main_takeaway if article.summary else None,
            "why_it_matters": (
                article.summary.why_it_matters if article.summary else None
            ),
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
            selectinload(db_model.User.embedding_profile),
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
            "article_has_embedding": bool(flashcard.article.embedding),
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
    _refresh_schedule_next_runs(db)
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


def _refresh_schedule_next_runs(db: Session) -> None:
    now = datetime.now(timezone.utc)
    changed = False
    schedules = db.query(db_model.PipelineSchedule).all()
    for schedule in schedules:
        if not schedule.enabled:
            if schedule.next_run_at is not None:
                schedule.next_run_at = None
                changed = True
            continue
        next_run_at = schedule.next_run_at
        expected_next_run_at = next_daily_run_at(schedule.hour, schedule.minute)
        if (
            next_run_at is None
            or _as_utc(next_run_at) <= now
            or abs((_as_utc(next_run_at) - expected_next_run_at).total_seconds()) > 60
        ):
            schedule.next_run_at = expected_next_run_at
            changed = True
    if changed:
        db.commit()


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _queue_pipeline_run(
    db: Session,
    background_tasks: BackgroundTasks,
    run_type: str,
    options: dict[str, object] | None = None,
) -> dict[str, object]:
    active_run = (
        db.query(db_model.PipelineRun)
        .filter(
            db_model.PipelineRun.status.in_(
                [
                    db_model.PipelineRunStatus.QUEUED,
                    db_model.PipelineRunStatus.RUNNING,
                ]
            )
        )
        .order_by(desc(db_model.PipelineRun.created_at), desc(db_model.PipelineRun.id))
        .first()
    )
    if active_run is not None:
        active_status = active_run.status.value
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Pipeline run #{active_run.id} is already {active_status}. "
                "Wait for it to finish before starting another run."
            ),
        )

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


def _interaction_count(
    db: Session,
    interaction_type: db_model.InteractionType,
    *,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
) -> int:
    query = db.query(db_model.UserArticleInteraction).filter(
        db_model.UserArticleInteraction.interaction_type == interaction_type
    )
    if created_from is not None:
        query = query.filter(db_model.UserArticleInteraction.created_at >= created_from)
    if created_to is not None:
        query = query.filter(db_model.UserArticleInteraction.created_at < created_to)
    return query.count()


def _active_user_count(
    db: Session,
    *,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
) -> int:
    query = db.query(db_model.UserArticleInteraction.user_id)
    if created_from is not None:
        query = query.filter(db_model.UserArticleInteraction.created_at >= created_from)
    if created_to is not None:
        query = query.filter(db_model.UserArticleInteraction.created_at < created_to)
    return query.distinct().count()


def _local_day_bounds(timezone_name: str) -> tuple[datetime, datetime]:
    local_today = local_feed_date(timezone_name)
    range_start, range_end = _published_date_range(
        date_from=local_today,
        date_to=local_today,
        market_timezone=timezone_name,
    )
    assert range_start is not None
    assert range_end is not None
    return range_start, range_end


def _filtered_article_query(
    db: Session,
    *,
    country: str | None,
    category: str | None,
    source: str | None,
    summary_status: db_model.SummaryStatus | None,
    fresh_only: bool,
    has_image: bool | None,
    has_signals: bool | None,
    interaction_type: db_model.InteractionType | None,
    is_protected: bool | None,
    date_from: date | None,
    date_to: date | None,
    date_field: str,
    market_timezone: str,
):
    range_from, range_to = _published_date_range(
        date_from=date_from,
        date_to=date_to,
        market_timezone=market_timezone,
    )
    date_column = _article_date_column(date_field)
    query = db.query(db_model.Article)
    if country:
        query = query.filter(db_model.Article.country == country.lower())
    if category:
        query = query.filter(db_model.Article.primary_category == category.lower())
    if source:
        query = query.filter(db_model.Article.source.ilike(f"%{source}%"))
    if summary_status:
        query = query.filter(db_model.Article.summary_status == summary_status)
    if fresh_only:
        fresh_cutoff = datetime.now(timezone.utc) - timedelta(
            hours=settings.ARTICLE_MAX_AGE_HOURS
        )
        query = query.filter(db_model.Article.published_at >= fresh_cutoff)
    if has_image is not None:
        missing_image_filter = or_(
            db_model.Article.image_url.is_(None),
            db_model.Article.image_url == "",
        )
        query = query.filter(
            ~missing_image_filter if has_image else missing_image_filter
        )
    if has_signals is not None:
        signal_filter = db_model.Article.interactions.any()
        query = query.filter(signal_filter if has_signals else ~signal_filter)
    if interaction_type is not None:
        query = query.filter(
            db_model.Article.interactions.any(
                db_model.UserArticleInteraction.interaction_type == interaction_type
            )
        )
    if is_protected is not None:
        protected_filter = db_model.Article.interactions.any(
            db_model.UserArticleInteraction.interaction_type
            == db_model.InteractionType.SAVE
        )
        query = query.filter(protected_filter if is_protected else ~protected_filter)
    if range_from is not None:
        query = query.filter(date_column >= range_from)
    if range_to is not None:
        query = query.filter(date_column < range_to)
    return query


def _article_date_column(date_field: str):
    if date_field == "published":
        return db_model.Article.published_at
    if date_field == "fetched":
        return db_model.Article.fetched_at
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="date_field must be 'published' or 'fetched'.",
    )


def _published_date_range(
    *,
    date_from: date | None,
    date_to: date | None,
    market_timezone: str,
) -> tuple[datetime | None, datetime | None]:
    if date_from is None and date_to is None:
        return None, None
    timezone_name = normalize_timezone(market_timezone)
    local_timezone = ZoneInfo(timezone_name)
    start = (
        datetime.combine(date_from, time.min, tzinfo=local_timezone)
        if date_from is not None
        else None
    )
    end_date = date_to if date_to is not None else date_from
    end = (
        datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=local_timezone)
        if end_date is not None
        else None
    )
    return (
        start.astimezone(timezone.utc) if start is not None else None,
        end.astimezone(timezone.utc) if end is not None else None,
    )


def _article_row(article: db_model.Article) -> dict[str, object]:
    viewed_count = sum(
        1
        for interaction in article.interactions
        if interaction.interaction_type == db_model.InteractionType.VIEW
    )
    liked_count = sum(
        1
        for interaction in article.interactions
        if interaction.interaction_type == db_model.InteractionType.LIKE
    )
    disliked_count = sum(
        1
        for interaction in article.interactions
        if interaction.interaction_type == db_model.InteractionType.SKIP
    )
    saved_count = sum(
        1
        for interaction in article.interactions
        if interaction.interaction_type == db_model.InteractionType.SAVE
    )
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
        "viewed_count": viewed_count,
        "liked_count": liked_count,
        "disliked_count": disliked_count,
        "saved_count": saved_count,
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
        "has_embedding_profile": bool(
            user.embedding_profile is not None and user.embedding_profile.embedding
        ),
        "last_active": last_active,
        "last_feed_generated": last_feed_generated,
    }
