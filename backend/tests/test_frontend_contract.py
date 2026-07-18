import os
from datetime import date

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("NEWS_API_KEY", "test-news-key")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_db
from app.core.security import get_password_hash
from app.db.model import Base, Flashcard, Interest, SourceType, User
from app.main import app
from app.tasks.news_fetching import _build_user_feed

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        db.add_all(
            [
                Interest(name="Technology", source_type=SourceType.NEWS),
                Interest(name="Business", source_type=SourceType.NEWS),
                User(
                    email="reader@example.com",
                    hashed_password=get_password_hash("TestPassword123"),
                ),
            ]
        )
        db.commit()
    finally:
        db.close()


def test_frontend_setup_and_feed_contract():
    client = TestClient(app)

    public_signup_response = client.post(
        "/api/users/",
        json={"email": "new-reader@example.com", "password": "TestPassword123"},
    )
    assert public_signup_response.status_code == 403

    login_response = client.post(
        "/api/login/access-token",
        data={"username": "reader@example.com", "password": "TestPassword123"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    interests_response = client.get("/api/interests/")
    assert interests_response.status_code == 200
    interests = interests_response.json()
    assert interests[0]["source_type"] == "news"

    selected_ids = [interest["id"] for interest in interests]
    update_response = client.post(
        "/api/users/me/interests",
        json=selected_ids,
        headers=headers,
    )
    assert update_response.status_code == 200
    assert {interest["name"] for interest in update_response.json()} == {
        "Technology",
        "Business",
    }

    feed_response = client.get(
        "/api/users/me/feed?force_refresh=true",
        headers=headers,
    )
    assert feed_response.status_code == 200
    assert feed_response.json() == []

    demo_response = client.post("/api/dev/demo-feed", headers=headers)
    assert demo_response.status_code == 201
    demo_payload = demo_response.json()
    assert demo_payload["message"].startswith("Loaded ")
    assert len(demo_payload["items"]) > 0
    assert demo_payload["items"][0]["article"]["summary"]["main_takeaway"]
    first_article_id = demo_payload["items"][0]["article"]["id"]

    save_response = client.post(
        "/api/users/me/interactions",
        json={
            "article_id": first_article_id,
            "interaction_type": "save",
            "dwell_time_seconds": 1,
        },
        headers=headers,
    )
    assert save_response.status_code == 201

    saved_response = client.get("/api/users/me/saved-articles", headers=headers)
    assert saved_response.status_code == 200
    assert saved_response.json()[0]["id"] == first_article_id

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter_by(email="reader@example.com").one()
        first_count = _build_user_feed(db, user, date.today(), force_refresh=False)
        second_count = _build_user_feed(db, user, date.today(), force_refresh=False)
        flashcard_count = (
            db.query(Flashcard)
            .filter_by(user_id=user.id, feed_date=date.today())
            .count()
        )
        assert second_count == first_count
        assert flashcard_count == first_count
    finally:
        db.close()

    interaction_response = client.post(
        "/api/users/me/interactions",
        json={
            "article_id": 999,
            "interaction_type": "view",
            "dwell_time_seconds": 1,
        },
        headers=headers,
    )
    assert interaction_response.status_code == 404


def test_health_and_cors_preflight():
    client = TestClient(app)

    health_response = client.get("/health")
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}

    cors_response = client.options(
        "/api/interests/",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert cors_response.status_code == 200
    assert (
        cors_response.headers["access-control-allow-origin"] == "http://localhost:8081"
    )


def test_google_login_requires_backend_configuration():
    client = TestClient(app)

    response = client.post("/api/login/google", json={"id_token": "not-real"})

    assert response.status_code == 503
    assert response.json()["detail"] == "Google login is not configured on the backend."
