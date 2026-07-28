# updates learned preferences from user interactions
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.db import model as db_model
from app.services.embeddings import average_embeddings

BASE_DELTAS = {
    db_model.InteractionType.VIEW: 0.2,
    db_model.InteractionType.CLICK: 0.8,
    db_model.InteractionType.LIKE: 1.4,
    db_model.InteractionType.SAVE: 1.8,
    db_model.InteractionType.SKIP: -1.0,
}
COUNTRY_INTEREST_NAMES = {"india", "in", "united states", "us", "usa"}


def log_interaction(
    db: Session,
    *,
    user: db_model.User,
    article: db_model.Article,
    interaction_type: db_model.InteractionType,
    dwell_time_seconds: int | None,
    metadata: dict[str, object] | None = None,
) -> db_model.UserArticleInteraction:
    interaction = db_model.UserArticleInteraction(
        user_id=user.id,
        article_id=article.id,
        interaction_type=interaction_type,
        dwell_time_seconds=dwell_time_seconds,
        metadata_json=metadata or {},
    )
    db.add(interaction)
    _update_preferences(
        db,
        user=user,
        category=article.primary_category,
        keywords=article.keywords or [],
        interaction_type=interaction_type,
        dwell_time_seconds=dwell_time_seconds,
    )

    flashcard = (
        db.query(db_model.Flashcard)
        .filter(
            db_model.Flashcard.user_id == user.id,
            db_model.Flashcard.article_id == article.id,
        )
        .order_by(db_model.Flashcard.delivered_at.desc())
        .first()
    )
    if flashcard and interaction_type in {
        db_model.InteractionType.VIEW,
        db_model.InteractionType.CLICK,
        db_model.InteractionType.LIKE,
        db_model.InteractionType.SAVE,
    }:
        flashcard.is_viewed = True

    _refresh_user_embedding_profile(db, user=user)

    db.flush()
    return interaction


def sync_explicit_interests(
    db: Session,
    *,
    user: db_model.User,
    interests: Iterable[db_model.Interest],
) -> None:
    selected_news_categories = {
        interest.name.lower()
        for interest in interests
        if interest.source_type == db_model.SourceType.NEWS
        and interest.name.lower() not in COUNTRY_INTEREST_NAMES
    }

    existing_preferences = {
        preference.category: preference
        for preference in db.query(db_model.UserCategoryPreference)
        .filter(db_model.UserCategoryPreference.user_id == user.id)
        .all()
    }

    for category in selected_news_categories:
        preference = existing_preferences.get(category)
        if preference is None:
            preference = db_model.UserCategoryPreference(
                user_id=user.id,
                category=category,
                score=0.0,
            )
            db.add(preference)
        preference.score = max(preference.score, 4.0)

    for category, preference in existing_preferences.items():
        if category not in selected_news_categories:
            decayed_score = round(preference.score * 0.15, 4)
            preference.score = decayed_score if abs(decayed_score) >= 0.25 else 0.0


def _update_preferences(
    db: Session,
    *,
    user: db_model.User,
    category: str,
    keywords: Iterable[str],
    interaction_type: db_model.InteractionType,
    dwell_time_seconds: int | None,
) -> None:
    delta = BASE_DELTAS[interaction_type]
    if dwell_time_seconds is not None:
        if dwell_time_seconds >= 20:
            delta += 0.8
        elif dwell_time_seconds <= 3:
            delta -= 0.6

    category_pref = (
        db.query(db_model.UserCategoryPreference)
        .filter(
            db_model.UserCategoryPreference.user_id == user.id,
            db_model.UserCategoryPreference.category == category,
        )
        .first()
    )
    if category_pref is None:
        category_pref = db_model.UserCategoryPreference(
            user_id=user.id,
            category=category,
            score=0.0,
        )
        db.add(category_pref)
    category_pref.score = round(category_pref.score * 0.85 + delta, 4)

    for keyword in list(keywords)[:8]:
        keyword_pref = (
            db.query(db_model.UserKeywordPreference)
            .filter(
                db_model.UserKeywordPreference.user_id == user.id,
                db_model.UserKeywordPreference.keyword == keyword,
            )
            .first()
        )
        if keyword_pref is None:
            keyword_pref = db_model.UserKeywordPreference(
                user_id=user.id,
                keyword=keyword,
                score=0.0,
            )
            db.add(keyword_pref)
        keyword_pref.score = round(keyword_pref.score * 0.9 + delta / 2, 4)


def _refresh_user_embedding_profile(db: Session, *, user: db_model.User) -> None:
    positive_vectors = [
        interaction.article.embedding
        for interaction in db.query(db_model.UserArticleInteraction)
        .filter(db_model.UserArticleInteraction.user_id == user.id)
        .order_by(db_model.UserArticleInteraction.created_at.desc())
        .limit(50)
        .all()
        if interaction.article is not None
        and interaction.article.embedding
        and interaction.interaction_type
        in {
            db_model.InteractionType.CLICK,
            db_model.InteractionType.LIKE,
            db_model.InteractionType.SAVE,
        }
    ]
    average = average_embeddings(positive_vectors)
    if average is None:
        return

    profile = (
        db.query(db_model.UserEmbeddingProfile)
        .filter(db_model.UserEmbeddingProfile.user_id == user.id)
        .first()
    )
    if profile is None:
        profile = db_model.UserEmbeddingProfile(user_id=user.id, embedding=average)
        db.add(profile)
    else:
        profile.embedding = average
