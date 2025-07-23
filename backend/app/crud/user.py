# In app/crud/user.py

from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.db import model as db_model
from app.schemas import user as user_schema


def get_user_by_email(db: Session, email: str):
    return db.query(db_model.User).filter(db_model.User.email == email).first()


def create_user(db: Session, user: user_schema.UserCreate):
    hashed_password = get_password_hash(user.password)
    db_user = db_model.User(email=user.email, hashed_password=hashed_password)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user
