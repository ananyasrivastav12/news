# tests backend contracts used by the mobile app and dashboard
import os
from asyncio import run
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("NEWS_API_KEY", "test-news-key")
os.environ.setdefault("ADMIN_EMAILS", "reader@example.com")

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_db
from app.core.security import get_password_hash
from app.db.model import (
    Article,
    Base,
    Flashcard,
    Interest,
    SourceType,
    Summary,
    SummaryStatus,
    User,
    UserInterest,
)
from app.main import app
from app.services.feed_editions import DEFAULT_TIMEZONE, MORNING_BRIEF, local_feed_date
from app.services.recommendations import (
    RankedArticle,
    rank_articles_for_user,
    rerank_with_constraints,
)
from app.tasks.news_fetching import (
    _async_ingest_news,
    _async_summarize_articles,
    _build_user_feed,
)

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
                Interest(name="Sports", source_type=SourceType.NEWS),
                Interest(name="India", source_type=SourceType.NEWS),
                User(
                    email="reader@example.com",
                    hashed_password=get_password_hash("TestPassword123"),
                ),
            ]
        )
        db.commit()
    finally:
        db.close()


def _article(
    *,
    title: str,
    country: str,
    category: str,
    published_at: datetime,
) -> Article:
    return Article(
        title=title,
        normalized_title=title.lower(),
        original_url=f"https://example.com/{title.lower().replace(' ', '-')}",
        source="Example",
        country=country,
        description=title,
        content=title,
        raw_text=title,
        cleaned_text=title,
        published_at=published_at,
        primary_category=category,
        image_url=None,
        keywords=[category],
        story_key=f"{country}-{category}-{title}",
        summary_status=SummaryStatus.COMPLETED,
    )


def _seed_demo_feed(db, user: User, feed_date: date) -> list[Flashcard]:
    # tests seed real-looking cards without exposing demo routes in the api
    now = datetime.now(timezone.utc)
    specs = [
        ("AI tools move into newsroom workflows", "technology"),
        ("Markets watch consumer spending forecasts", "business"),
        ("Researchers map neighborhood climate risk", "science"),
        ("Streaming platforms test shorter seasons", "entertainment"),
        ("Teams use player tracking for decisions", "sports"),
    ]
    articles = [
        _article(
            title=title,
            country="us",
            category=category,
            published_at=now - timedelta(minutes=index * 20),
        )
        for index, (title, category) in enumerate(specs)
    ]
    db.add_all(articles)
    db.flush()
    for article in articles:
        db.add(
            Summary(
                article_id=article.id,
                display_headline=article.title,
                main_takeaway=f"{article.title} is ready for the briefing.",
                supporting_lines=[
                    "The story has enough context for a compact card.",
                ],
                summary_text=f"{article.title} is ready for the briefing.",
                why_it_matters=None,
                model_name="test",
            )
        )
    db.commit()
    _build_user_feed(db, user, feed_date, force_refresh=True)
    return (
        db.query(Flashcard)
        .filter_by(
            user_id=user.id,
            feed_date=feed_date,
            edition_type=MORNING_BRIEF,
            market_timezone=DEFAULT_TIMEZONE,
        )
        .order_by(Flashcard.rank_position.asc())
        .all()
    )


def test_country_category_intersection_ranks_first():
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter_by(email="reader@example.com").one()
        interests = {
            interest.name: interest
            for interest in db.query(Interest)
            .filter(Interest.name.in_(["India", "Sports"]))
            .all()
        }
        db.add_all(
            [
                UserInterest(user_id=user.id, interest_id=interests["India"].id),
                UserInterest(user_id=user.id, interest_id=interests["Sports"].id),
            ]
        )
        now = datetime.now(timezone.utc)
        articles = [
            _article(
                title="India cricket final",
                country="in",
                category="sports",
                published_at=now - timedelta(hours=5),
            ),
            _article(
                title="US basketball trade",
                country="us",
                category="sports",
                published_at=now,
            ),
            _article(
                title="India cabinet update",
                country="in",
                category="general",
                published_at=now - timedelta(hours=1),
            ),
        ]
        db.add_all(articles)
        db.flush()
        for article in articles:
            db.add(
                Summary(
                    article_id=article.id,
                    display_headline=article.title,
                    main_takeaway=f"{article.title} summary.",
                    supporting_lines=[],
                    summary_text=f"{article.title} summary.",
                    why_it_matters=None,
                    model_name="test",
                )
            )
        db.commit()

        ranked = rank_articles_for_user(
            db,
            user=user,
            edition_type=MORNING_BRIEF,
            market_timezone="America/New_York",
        )

        assert ranked[0].article.title == "India cricket final"
        assert ranked[0].reason == "market_category"
    finally:
        db.close()


def test_ranker_keeps_stale_articles_behind_fresh_feed_items(monkeypatch):
    monkeypatch.setattr(
        "app.services.recommendations.settings.FEED_PRIMARY_MAX_AGE_HOURS", 36
    )
    monkeypatch.setattr("app.services.recommendations.settings.FEED_EDITION_SIZE", 3)
    monkeypatch.setattr("app.services.recommendations.settings.MAX_FEED_ITEMS", 3)

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter_by(email="reader@example.com").one()
        interests = {
            interest.name: interest
            for interest in db.query(Interest)
            .filter(Interest.name.in_(["India", "Sports"]))
            .all()
        }
        db.add_all(
            [
                UserInterest(user_id=user.id, interest_id=interests["India"].id),
                UserInterest(user_id=user.id, interest_id=interests["Sports"].id),
            ]
        )
        now = datetime.now(timezone.utc)
        articles = [
            _article(
                title="India cricket archive",
                country="in",
                category="sports",
                published_at=now - timedelta(hours=72),
            ),
            _article(
                title="India economy today",
                country="in",
                category="business",
                published_at=now - timedelta(hours=2),
            ),
            _article(
                title="US basketball today",
                country="us",
                category="sports",
                published_at=now - timedelta(hours=3),
            ),
        ]
        db.add_all(articles)
        db.flush()
        for article in articles:
            db.add(
                Summary(
                    article_id=article.id,
                    display_headline=article.title,
                    main_takeaway=f"{article.title} summary.",
                    supporting_lines=[],
                    summary_text=f"{article.title} summary.",
                    why_it_matters=None,
                    model_name="test",
                )
            )
        db.commit()

        ranked = rank_articles_for_user(
            db,
            user=user,
            edition_type=MORNING_BRIEF,
            market_timezone="America/New_York",
        )

        assert [item.article.title for item in ranked] == [
            "India economy today",
            "US basketball today",
            "India cricket archive",
        ]
    finally:
        db.close()


def test_ingestion_selects_across_categories_before_filling_cap(monkeypatch):
    now = datetime.now(timezone.utc)

    def raw_article(title: str, category: str, index: int) -> dict:
        return {
            "title": title,
            "source": "Example",
            "country": "us",
            "url": f"https://example.com/{category}/{index}",
            "published_at": now - timedelta(minutes=index),
            "description": (
                f"{title} gives readers useful context about {category} news today."
            ),
            "content": (
                f"{title} includes enough article text for validation and ranking."
            ),
            "image_url": None,
        }

    fixtures = {
        "business": [
            raw_article(f"Business story {index}", "business", index)
            for index in range(8)
        ],
        "sports": [
            raw_article(f"Sports story {index}", "sports", index) for index in range(2)
        ],
    }

    class FakeNewsApiService:
        async def fetch_top_headlines(
            self, *, category, country=None, query=None, page_size=None
        ):
            return fixtures[category][:page_size]

    monkeypatch.setattr("app.tasks.news_fetching.NewsApiService", FakeNewsApiService)
    monkeypatch.setattr("app.tasks.news_fetching.settings.NEWS_API_COUNTRY", "us")
    monkeypatch.setattr("app.tasks.news_fetching.settings.NEWS_API_COUNTRIES", "us")
    monkeypatch.setattr(
        "app.tasks.news_fetching.settings.NEWS_BATCH_CATEGORIES",
        "business,sports",
    )
    monkeypatch.setattr("app.tasks.news_fetching.settings.NEWS_DAILY_ARTICLE_TARGET", 4)
    monkeypatch.setattr("app.tasks.news_fetching.settings.ARTICLE_POOL_LIMIT", 100)

    db = TestingSessionLocal()
    try:
        result = run(_async_ingest_news(db))
        categories = {
            category: count
            for category, count in db.query(
                Article.primary_category,
                func.count(Article.id),
            )
            .group_by(Article.primary_category)
            .all()
        }

        assert result["inserted"] == 4
        assert result["by_category"]["business"]["inserted"] == 2
        assert result["by_category"]["sports"]["inserted"] == 2
        assert categories == {"business": 2, "sports": 2}
    finally:
        db.close()


def test_rerank_counts_selected_exploration_items_only(monkeypatch):
    monkeypatch.setattr("app.services.recommendations.settings.FEED_EDITION_SIZE", 4)
    monkeypatch.setattr("app.services.recommendations.settings.MAX_FEED_ITEMS", 4)
    monkeypatch.setattr(
        "app.services.recommendations.settings.FEED_EXPLORATION_RATIO", 0.25
    )

    market_article = _article(
        title="Market technology lead",
        country="us",
        category="technology",
        published_at=datetime.now(timezone.utc),
    )
    exploration_article = _article(
        title="Exploration article",
        country="fr",
        category="science",
        published_at=datetime.now(timezone.utc),
    )
    global_article = _article(
        title="Global technology article",
        country="fr",
        category="technology",
        published_at=datetime.now(timezone.utc),
    )

    ranked = rerank_with_constraints(
        [
            RankedArticle(
                article=market_article,
                score=10.0,
                reason="market_category",
                lane="market_category",
            ),
            RankedArticle(
                article=exploration_article,
                score=6.0,
                reason="exploration",
                lane="exploration",
            ),
            RankedArticle(
                article=global_article,
                score=5.5,
                reason="category_global",
                lane="category_global",
            ),
        ],
        explicit_interests={"technology"},
        explicit_categories={"technology"},
        explicit_country_codes=set(),
        selected_country_codes=set(),
        edition_type=MORNING_BRIEF,
    )

    assert [item.article.title for item in ranked[:2]] == [
        "Market technology lead",
        "Exploration article",
    ]


def test_summarization_counts_only_created_embeddings(monkeypatch):
    async def fake_summarize(self, *, title, description, content):
        return {
            "display_headline": title,
            "main_takeaway": "The article has a concise summary.",
            "supporting_lines": [],
            "summary_text": "The article has a concise summary.",
            "why_it_matters": "",
            "model_name": "test",
        }

    async def fake_embed_text(self, text):
        return None

    monkeypatch.setattr(
        "app.tasks.news_fetching.ArticleSummarizer.summarize", fake_summarize
    )
    monkeypatch.setattr(
        "app.tasks.news_fetching.EmbeddingService.embed_text", fake_embed_text
    )

    db = TestingSessionLocal()
    try:
        article = _article(
            title="Pending summary article",
            country="us",
            category="technology",
            published_at=datetime.now(timezone.utc),
        )
        article.summary_status = SummaryStatus.PENDING
        db.add(article)
        db.commit()

        result = run(_async_summarize_articles(db, limit=1))

        assert result == {"processed": 1, "failed": 0, "embedded": 0}
    finally:
        db.close()


def test_admin_article_distribution_counts_country_category_intersections():
    db = TestingSessionLocal()
    try:
        now = datetime.now(timezone.utc)
        articles = [
            _article(
                title="India sports",
                country="in",
                category="sports",
                published_at=now,
            ),
            _article(
                title="India business",
                country="in",
                category="business",
                published_at=now,
            ),
            _article(
                title="US sports",
                country="us",
                category="sports",
                published_at=now,
            ),
        ]
        db.add_all(articles)
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    login_response = client.post(
        "/api/login/access-token",
        data={"username": "reader@example.com", "password": "TestPassword123"},
    )
    token = login_response.json()["access_token"]
    response = client.get(
        "/api/admin/article-distribution",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["totals"]["total_count"] == 3
    assert {item["country"]: item["total_count"] for item in payload["by_country"]} == {
        "in": 2,
        "us": 1,
    }
    intersections = {
        (item["country"], item["category"]): item["total_count"]
        for item in payload["by_country_category"]
    }
    assert intersections[("in", "sports")] == 1
    assert intersections[("in", "business")] == 1
    assert intersections[("us", "sports")] == 1


def test_login_rejects_invalid_email_format():
    client = TestClient(app)

    response = client.post(
        "/api/login/access-token",
        data={"username": "not-an-email", "password": "TestPassword123"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Enter a valid email address"


def test_user_can_change_password_and_delete_account():
    client = TestClient(app)
    login_response = client.post(
        "/api/login/access-token",
        data={"username": "reader@example.com", "password": "TestPassword123"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    wrong_password_response = client.post(
        "/api/users/me/password",
        json={"current_password": "wrong", "new_password": "NextPassword123"},
        headers=headers,
    )
    assert wrong_password_response.status_code == 400

    change_response = client.post(
        "/api/users/me/password",
        json={
            "current_password": "TestPassword123",
            "new_password": "NextPassword123",
        },
        headers=headers,
    )
    assert change_response.status_code == 204

    old_login_response = client.post(
        "/api/login/access-token",
        data={"username": "reader@example.com", "password": "TestPassword123"},
    )
    assert old_login_response.status_code == 401

    new_login_response = client.post(
        "/api/login/access-token",
        data={"username": "reader@example.com", "password": "NextPassword123"},
    )
    assert new_login_response.status_code == 200
    delete_headers = {
        "Authorization": f"Bearer {new_login_response.json()['access_token']}"
    }

    delete_response = client.request(
        "DELETE",
        "/api/users/me",
        json={"password": "NextPassword123"},
        headers=delete_headers,
    )
    assert delete_response.status_code == 204

    deleted_login_response = client.post(
        "/api/login/access-token",
        data={"username": "reader@example.com", "password": "NextPassword123"},
    )
    assert deleted_login_response.status_code == 401


def test_admin_can_reset_and_delete_beta_user():
    client = TestClient(app)
    login_response = client.post(
        "/api/login/access-token",
        data={"username": "reader@example.com", "password": "TestPassword123"},
    )
    admin_headers = {"Authorization": f"Bearer {login_response.json()['access_token']}"}

    create_response = client.post(
        "/api/admin/users",
        json={"email": "beta-user@example.com", "password": "StartPassword123"},
        headers=admin_headers,
    )
    assert create_response.status_code == 201
    user_id = create_response.json()["id"]

    reset_response = client.post(
        f"/api/admin/users/{user_id}/password",
        json={"password": "ResetPassword123"},
        headers=admin_headers,
    )
    assert reset_response.status_code == 204

    beta_login_response = client.post(
        "/api/login/access-token",
        data={"username": "beta-user@example.com", "password": "ResetPassword123"},
    )
    assert beta_login_response.status_code == 200

    delete_response = client.delete(
        f"/api/admin/users/{user_id}",
        headers=admin_headers,
    )
    assert delete_response.status_code == 204

    deleted_login_response = client.post(
        "/api/login/access-token",
        data={"username": "beta-user@example.com", "password": "ResetPassword123"},
    )
    assert deleted_login_response.status_code == 401


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

    selected_ids = [
        interest["id"]
        for interest in interests
        if interest["name"] in {"Technology", "Business"}
    ]
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

    target_feed_date = local_feed_date(DEFAULT_TIMEZONE)
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter_by(email="reader@example.com").one()
        seeded_cards = _seed_demo_feed(db, user, target_feed_date)
        first_article_id = seeded_cards[0].article_id
    finally:
        db.close()

    demo_feed_response = client.get("/api/users/me/feed", headers=headers)
    assert demo_feed_response.status_code == 200
    demo_items = demo_feed_response.json()
    assert len(demo_items) > 0
    assert demo_items[0]["article"]["summary"]["main_takeaway"]

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

    support_response = client.post(
        "/api/users/me/support-messages",
        json={"message": "The app could not refresh my midday edition."},
        headers=headers,
    )
    assert support_response.status_code == 201
    assert support_response.json()["status"] == "open"

    inbox_response = client.get("/api/admin/support-messages", headers=headers)
    assert inbox_response.status_code == 200
    inbox_messages = inbox_response.json()
    assert inbox_messages[0]["user_email"] == "reader@example.com"
    assert inbox_messages[0]["message"] == (
        "The app could not refresh my midday edition."
    )

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter_by(email="reader@example.com").one()
        first_count = _build_user_feed(db, user, target_feed_date, force_refresh=False)
        second_count = _build_user_feed(db, user, target_feed_date, force_refresh=False)
        flashcard_count = (
            db.query(Flashcard)
            .filter_by(user_id=user.id, feed_date=target_feed_date)
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
