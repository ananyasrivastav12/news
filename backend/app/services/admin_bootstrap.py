# creates the first admin user from env on startup
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_password_hash
from app.db import model as db_model

logger = logging.getLogger(__name__)


def bootstrap_admin_user(db: Session) -> None:
    email = settings.ADMIN_BOOTSTRAP_EMAIL.strip().lower()
    password = settings.ADMIN_BOOTSTRAP_PASSWORD
    if not email or not password:
        return
    if len(password) < 8:
        logger.warning(
            "Skipping admin bootstrap because password is shorter than 8 characters."
        )
        return

    user = db.query(db_model.User).filter(db_model.User.email == email).first()
    password_hash = get_password_hash(password)
    if user is None:
        db.add(db_model.User(email=email, hashed_password=password_hash))
        logger.info("Created bootstrap admin user email=%s", email)
    else:
        user.hashed_password = password_hash
        logger.info("Updated bootstrap admin user password email=%s", email)
    db.commit()
