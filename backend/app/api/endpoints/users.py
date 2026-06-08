# In app/api/endpoints/users.py

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.crud import interest as crud_interest
from app.crud import user as crud_user  # <--- CHANGED
from app.schemas import interest as interest_schema
from app.schemas import user as user_schema

router = APIRouter()


@router.post(
    "/users/", response_model=user_schema.User, status_code=status.HTTP_201_CREATED
)
def create_user(user: user_schema.UserCreate, db: Session = Depends(get_db)):
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
