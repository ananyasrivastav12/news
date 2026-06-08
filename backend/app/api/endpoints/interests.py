# In app/api/endpoints/interests.py

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.crud import interest as crud_interest
from app.db import model as db_model
from app.schemas import interest as interest_schema
from app.services.user_profile import sync_explicit_interests

router = APIRouter()


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
    crud_interest.add_user_interests(
        db=db, user=current_user, interest_ids=interest_ids
    )
    selected_interests = crud_interest.get_user_interests(db, user_id=current_user.id)
    sync_explicit_interests(db, user=current_user, interests=selected_interests)
    db.commit()

    return selected_interests
