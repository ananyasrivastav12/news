# app/crud/user.py

# user creation and lookup helpers
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.db import model


def get_user_by_email(db: Session, email: str):
    return db.query(model.User).filter(model.User.email == email).first()


def create_user(db: Session, user):
    hashed_password = get_password_hash(user.password)

    db_user = model.User(email=user.email, hashed_password=hashed_password)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def create_google_user(db: Session, *, email: str):
    db_user = model.User(
        email=email,
        hashed_password=get_password_hash(f"google-auth:{email}"),
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user
