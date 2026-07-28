# login routes for password and optional google auth
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core import security
from app.core.config import settings
from app.crud import user as crud_user
from app.schemas import token as token_schema

router = APIRouter()


@router.post("/login/access-token", response_model=token_schema.Token)
def login_for_access_token(
    db: Session = Depends(get_db), form_data: OAuth2PasswordRequestForm = Depends()
):
    user = crud_user.get_user_by_email(db, email=form_data.username)
    if not user or not security.verify_password(
        form_data.password, user.hashed_password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(
        minutes=security.settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    access_token = security.create_access_token(
        subject=user.id, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "email": user.email}


@router.post("/login/google", response_model=token_schema.Token)
def login_with_google(
    payload: token_schema.GoogleLogin,
    db: Session = Depends(get_db),
):
    google_client_ids = settings.google_client_ids
    if not google_client_ids:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google login is not configured on the backend.",
        )

    token_info = None
    last_error: Exception | None = None
    request = google_requests.Request()
    for client_id in google_client_ids:
        try:
            token_info = google_id_token.verify_oauth2_token(
                payload.id_token,
                request,
                client_id,
            )
            break
        except ValueError as exc:
            last_error = exc

    if token_info is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google token: {last_error}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    email = token_info.get("email")
    email_verified = token_info.get("email_verified")
    if not email or email_verified is not True:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google account email is not verified.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = crud_user.get_user_by_email(db, email=email)
    if user is None:
        user = crud_user.create_google_user(db, email=email)

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = security.create_access_token(
        subject=user.id,
        expires_delta=access_token_expires,
    )
    return {"access_token": access_token, "token_type": "bearer", "email": user.email}
