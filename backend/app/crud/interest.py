# In app/crud/interest.py

from typing import List

from sqlalchemy.orm import Session

from app.db import model as db_model


def get_interests(
    db: Session, skip: int = 0, limit: int = 100
) -> List[db_model.Interest]:
    """
    Retrieve all interests from the database.
    """
    return db.query(db_model.Interest).offset(skip).limit(limit).all()


def add_user_interests(db: Session, user: db_model.User, interest_ids: List[int]):
    """
    Associate a list of interests with a user by creating UserInterest objects.
    """
    # First, clear existing interests for this user
    db.query(db_model.UserInterest).filter(
        db_model.UserInterest.user_id == user.id
    ).delete()

    # Then, create and add the new association objects
    for interest_id in interest_ids:
        user_interest_link = db_model.UserInterest(
            user_id=user.id, interest_id=interest_id
        )
        db.add(user_interest_link)

    db.commit()
    return user


def get_user_interests(db: Session, user_id: int) -> List[db_model.Interest]:
    user_interest_links = (
        db.query(db_model.UserInterest)
        .filter(db_model.UserInterest.user_id == user_id)
        .all()
    )
    return [link.interest for link in user_interest_links if link.interest is not None]
