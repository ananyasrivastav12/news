import logging
from datetime import date
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.crud import interest as crud_interest
from app.db import model as db_model
from app.schemas import interest as interest_schema
from app.services.recommendations import build_today_feed
from app.services.user_profile import sync_explicit_interests

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/interests/", response_model=List[interest_schema.Interest])
def read_interests(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    Retrieve a list of all available interests.
    """
    interests = crud_interest.get_interests(db, skip=skip, limit=limit)
    return interests


@router.post("/users/me/interests", response_model=List[interest_schema.Interest])
def update_user_interests(
    interest_ids: List[int],
    db: Session = Depends(get_db),
    current_user: db_model.User = Depends(get_current_user),
):
    """
    Update the interests for the currently logged-in user.
    """
    previous_interests = {
        interest.id
        for interest in crud_interest.get_user_interests(db, user_id=current_user.id)
    }
    crud_interest.add_user_interests(
        db=db, user=current_user, interest_ids=interest_ids
    )
    selected_interests = crud_interest.get_user_interests(db, user_id=current_user.id)
    sync_explicit_interests(db, user=current_user, interests=selected_interests)
    db.commit()
    db.expire(current_user)

    selected_interest_ids = {interest.id for interest in selected_interests}
    if selected_interest_ids != previous_interests:
        rebuilt_feed = build_today_feed(
            db,
            user=current_user,
            feed_date=date.today(),
            force_refresh=True,
        )
        logger.info(
            "Rebuilt feed after interest update for user_id=%s interests=%s "
            "feed_items=%s",
            current_user.id,
            [interest.name for interest in selected_interests],
            len(rebuilt_feed),
        )

    return selected_interests
