# In app/api/endpoints/users.py

# user account and profile summary routes
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core import security
from app.core.config import settings
from app.crud import interest as crud_interest
from app.crud import user as crud_user
from app.db import model as db_model
from app.schemas import interest as interest_schema
from app.schemas import user as user_schema
from app.services.recommendations import get_explicit_country_codes

router = APIRouter()


@router.post(
    "/users/", response_model=user_schema.User, status_code=status.HTTP_201_CREATED
)
def create_user(user: user_schema.UserCreate, db: Session = Depends(get_db)):
    if not settings.ENABLE_PUBLIC_SIGNUP:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public signup is disabled for this beta.",
        )

    db_user = crud_user.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    try:
        return crud_user.create_user(db=db, user=user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/users/me", response_model=user_schema.User)
def read_users_me(current_user: user_schema.User = Depends(get_current_user)):
    return current_user


@router.get("/users/me/interests", response_model=list[interest_schema.Interest])
def read_my_interests(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return crud_interest.get_user_interests(db, user_id=current_user.id)


@router.get("/users/me/profile-summary", response_model=user_schema.ProfileSummary)
def read_profile_summary(
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    selected_interests = crud_interest.get_user_interests(db, user_id=current_user.id)
    selected_categories = {
        interest.name.lower()
        for interest in selected_interests
        if interest.source_type == db_model.SourceType.NEWS
    }
    selected_country_codes = get_explicit_country_codes(selected_categories)

    signal_counts = {
        interaction_type.value: count
        for interaction_type, count in db.query(
            db_model.UserArticleInteraction.interaction_type,
            func.count(db_model.UserArticleInteraction.id),
        )
        .filter(db_model.UserArticleInteraction.user_id == current_user.id)
        .group_by(db_model.UserArticleInteraction.interaction_type)
        .all()
    }

    today = date.today()
    flashcards = (
        db.query(db_model.Flashcard)
        .join(db_model.Article)
        .filter(
            db_model.Flashcard.user_id == current_user.id,
            db_model.Flashcard.feed_date == today,
            db_model.Flashcard.rank_position <= settings.feed_edition_size,
        )
        .all()
    )
    explicit_matches = sum(
        1
        for flashcard in flashcards
        if flashcard.article.primary_category in selected_categories
        or flashcard.article.country in selected_country_codes
    )
    unread_count = sum(1 for flashcard in flashcards if not flashcard.is_viewed)

    return user_schema.ProfileSummary(
        interests=[interest.name for interest in selected_interests],
        signal_counts=user_schema.ProfileSignalCounts(
            viewed=signal_counts.get(db_model.InteractionType.VIEW.value, 0),
            liked=signal_counts.get(db_model.InteractionType.LIKE.value, 0),
            disliked=signal_counts.get(db_model.InteractionType.SKIP.value, 0),
            saved=signal_counts.get(db_model.InteractionType.SAVE.value, 0),
            clicked=signal_counts.get(db_model.InteractionType.CLICK.value, 0),
        ),
        today_feed=user_schema.FeedProfileStats(
            total=len(flashcards),
            unread=unread_count,
            explicit_interest_matches=explicit_matches,
        ),
    )


@router.post(
    "/users/me/support-messages",
    response_model=user_schema.SupportMessageOut,
    status_code=status.HTTP_201_CREATED,
)
def create_support_message(
    payload: user_schema.SupportMessageCreate,
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    message_text = payload.message.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    subject = payload.subject.strip() if payload.subject else None
    support_message = db_model.SupportMessage(
        user_id=current_user.id,
        subject=subject or None,
        message=message_text,
    )
    db.add(support_message)
    db.commit()
    db.refresh(support_message)
    return support_message


@router.post("/users/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_my_password(
    payload: user_schema.PasswordChange,
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    if not security.verify_password(
        payload.current_password, current_user.hashed_password
    ):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    crud_user.update_password(db, current_user, payload.new_password)


@router.delete("/users/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_my_account(
    payload: user_schema.AccountDelete,
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    if not security.verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Password is incorrect.")
    (
        db.query(db_model.SummaryReview)
        .filter(db_model.SummaryReview.reviewer_user_id == current_user.id)
        .update({"reviewer_user_id": None}, synchronize_session=False)
    )
    db.delete(current_user)
    db.commit()
