from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, desc
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.db import model as db_model
from app.services.embeddings import cosine_similarity
from app.services.feed_editions import DEFAULT_TIMEZONE, MORNING_BRIEF

logger = logging.getLogger(__name__)


@dataclass
class RankedArticle:
    article: db_model.Article
    score: float
    reason: str
    has_interaction: bool = False


COUNTRY_INTERESTS = {
    "india": "in",
    "in": "in",
    "united states": "us",
    "us": "us",
    "usa": "us",
}


def get_explicit_interest_names(user: db_model.User) -> set[str]:
    return {link.interest.name.lower() for link in user.interests}


def get_explicit_country_codes(explicit_interests: set[str]) -> set[str]:
    return {
        country_code
        for interest in explicit_interests
        if (country_code := COUNTRY_INTERESTS.get(interest))
    }


def _keyword_overlap(left: list[str] | None, right: list[str] | None) -> float:
    left_set = set(left or [])
    right_set = set(right or [])
    if not left_set or not right_set:
        return 0.0
    return len(left_set & right_set) / len(left_set | right_set)


def _stage_for_article(
    item: RankedArticle,
    *,
    explicit_interests: set[str],
    explicit_interest_terms: set[str],
    explicit_country_codes: set[str],
) -> int:
    category = item.article.primary_category
    keywords = set(item.article.keywords or [])
    if item.article.country in explicit_country_codes:
        return 0
    if category in explicit_interests:
        return 0
    if keywords & explicit_interest_terms:
        return 1
    if explicit_interests:
        return 2
    return 3


def build_today_feed(
    db: Session,
    *,
    user: db_model.User,
    feed_date: date | None = None,
    edition_type: str = MORNING_BRIEF,
    market_timezone: str = DEFAULT_TIMEZONE,
    force_refresh: bool = False,
) -> list[RankedArticle]:
    target_date = feed_date or date.today()
    existing = (
        db.query(db_model.Flashcard)
        .options(
            joinedload(db_model.Flashcard.article),
            joinedload(db_model.Flashcard.summary),
        )
        .filter(
            and_(
                db_model.Flashcard.user_id == user.id,
                db_model.Flashcard.feed_date == target_date,
                db_model.Flashcard.edition_type == edition_type,
                db_model.Flashcard.market_timezone == market_timezone,
            )
        )
        .order_by(db_model.Flashcard.rank_position.asc())
        .all()
    )
    active_existing = [
        flashcard
        for flashcard in existing
        if flashcard.rank_position <= settings.feed_edition_size
    ]
    if active_existing and not force_refresh:
        _log_feed_stats(
            user=user,
            feed_date=target_date,
            edition_type=edition_type,
            flashcards=active_existing,
            source="existing",
        )
        return [
            RankedArticle(
                article=flashcard.article,
                score=flashcard.ranking_score,
                reason=flashcard.ranking_reason or "precomputed",
            )
            for flashcard in active_existing
        ]

    excluded_article_ids = get_existing_feed_article_ids(
        db,
        user=user,
        feed_date=target_date,
        market_timezone=market_timezone,
        exclude_edition_type=edition_type,
    )
    excluded_article_ids.update(
        flashcard.article_id for flashcard in existing if flashcard.is_viewed
    )
    if force_refresh and existing:
        _archive_viewed_flashcards(existing)
        (
            db.query(db_model.Flashcard)
            .filter(
                and_(
                    db_model.Flashcard.user_id == user.id,
                    db_model.Flashcard.feed_date == target_date,
                    db_model.Flashcard.edition_type == edition_type,
                    db_model.Flashcard.market_timezone == market_timezone,
                    db_model.Flashcard.is_viewed.is_(False),
                )
            )
            .delete(synchronize_session=False)
        )
        db.flush()

    ranked = rank_articles_for_user(db, user=user)
    persist_feed(
        db,
        user=user,
        ranked_articles=ranked,
        feed_date=target_date,
        edition_type=edition_type,
        market_timezone=market_timezone,
        excluded_article_ids=excluded_article_ids,
    )
    db.commit()
    persisted = (
        db.query(db_model.Flashcard)
        .options(joinedload(db_model.Flashcard.article))
        .filter(
            and_(
                db_model.Flashcard.user_id == user.id,
                db_model.Flashcard.feed_date == target_date,
                db_model.Flashcard.edition_type == edition_type,
                db_model.Flashcard.market_timezone == market_timezone,
                db_model.Flashcard.rank_position <= settings.feed_edition_size,
            )
        )
        .all()
    )
    _log_feed_stats(
        user=user,
        feed_date=target_date,
        edition_type=edition_type,
        flashcards=persisted,
        source="rebuilt" if force_refresh else "new",
    )
    return ranked


def invalidate_unread_feeds_for_user(db: Session, *, user: db_model.User) -> None:
    flashcards = (
        db.query(db_model.Flashcard).filter(db_model.Flashcard.user_id == user.id).all()
    )
    _archive_viewed_flashcards(flashcards)
    (
        db.query(db_model.Flashcard)
        .filter(
            db_model.Flashcard.user_id == user.id,
            db_model.Flashcard.is_viewed.is_(False),
        )
        .delete(synchronize_session=False)
    )
    db.flush()


def _archive_viewed_flashcards(flashcards: list[db_model.Flashcard]) -> None:
    for flashcard in flashcards:
        if flashcard.is_viewed:
            flashcard.rank_position = 1_000_000 + flashcard.id


def get_existing_feed_article_ids(
    db: Session,
    *,
    user: db_model.User,
    feed_date: date,
    market_timezone: str = DEFAULT_TIMEZONE,
    exclude_edition_type: str | None = None,
) -> set[int]:
    query = db.query(db_model.Flashcard.article_id).filter(
        db_model.Flashcard.user_id == user.id,
        db_model.Flashcard.feed_date == feed_date,
        db_model.Flashcard.market_timezone == market_timezone,
    )
    if exclude_edition_type is not None:
        query = query.filter(db_model.Flashcard.edition_type != exclude_edition_type)
    return {article_id for (article_id,) in query.all()}


def _log_feed_stats(
    *,
    user: db_model.User,
    feed_date: date,
    edition_type: str,
    flashcards: list[db_model.Flashcard],
    source: str,
) -> None:
    explicit_interests = get_explicit_interest_names(user)
    explicit_country_codes = get_explicit_country_codes(explicit_interests)
    explicit_matches = sum(
        1
        for flashcard in flashcards
        if flashcard.article is not None
        and (
            flashcard.article.primary_category in explicit_interests
            or flashcard.article.country in explicit_country_codes
        )
    )
    unread_count = sum(1 for flashcard in flashcards if not flashcard.is_viewed)
    logger.info(
        "Feed %s user_id=%s date=%s edition=%s total=%s unread=%s "
        "explicit_interest_matches=%s interests=%s",
        source,
        user.id,
        feed_date.isoformat(),
        edition_type,
        len(flashcards),
        unread_count,
        explicit_matches,
        sorted(explicit_interests),
    )


def rank_articles_for_user(db: Session, *, user: db_model.User) -> list[RankedArticle]:
    explicit_interests = get_explicit_interest_names(user)
    explicit_country_codes = get_explicit_country_codes(explicit_interests)
    explicit_interest_terms = {
        token.lower()
        for interest in explicit_interests
        for token in interest.replace("-", " ").split()
        if token
    }
    category_scores = {pref.category: pref.score for pref in user.category_preferences}
    keyword_scores = {
        pref.keyword: pref.score for pref in user.keyword_preferences if pref.score > 0
    }
    negative_keywords = {
        pref.keyword: pref.score for pref in user.keyword_preferences if pref.score < 0
    }

    fresh_cutoff = datetime.now(timezone.utc) - timedelta(
        hours=settings.ARTICLE_MAX_AGE_HOURS
    )
    recent_interactions = (
        db.query(db_model.UserArticleInteraction)
        .options(joinedload(db_model.UserArticleInteraction.article))
        .filter(db_model.UserArticleInteraction.user_id == user.id)
        .order_by(desc(db_model.UserArticleInteraction.created_at))
        .limit(max(settings.MAX_FEED_ITEMS * 2, 1000))
        .all()
    )
    interacted_story_keys = {
        interaction.article.story_key
        for interaction in recent_interactions
        if interaction.article is not None
    }
    positive_story_keys = {
        interaction.article.story_key
        for interaction in recent_interactions
        if interaction.article is not None
        and interaction.interaction_type
        in {
            db_model.InteractionType.LIKE,
            db_model.InteractionType.SAVE,
            db_model.InteractionType.CLICK,
        }
    }
    negative_story_keys = {
        interaction.article.story_key
        for interaction in recent_interactions
        if interaction.article is not None
        and interaction.interaction_type == db_model.InteractionType.SKIP
    }
    user_embedding = (
        user.embedding_profile.embedding
        if user.embedding_profile is not None and user.embedding_profile.embedding
        else None
    )

    candidates = (
        db.query(db_model.Article)
        .options(joinedload(db_model.Article.summary))
        .filter(
            and_(
                db_model.Article.summary_status == db_model.SummaryStatus.COMPLETED,
                db_model.Article.published_at >= fresh_cutoff,
            )
        )
        .order_by(desc(db_model.Article.published_at))
        .limit(settings.MAX_FEED_ITEMS)
        .all()
    )

    ranked: list[RankedArticle] = []
    now = datetime.now(timezone.utc)
    for article in candidates:
        if article.summary is None:
            continue
        has_interaction = article.story_key in interacted_story_keys

        explicit_score = 2.5 if article.primary_category in explicit_interests else 0.0
        country_score = 2.75 if article.country in explicit_country_codes else 0.0
        explicit_keyword_score = sum(
            0.35 for keyword in article.keywords if keyword in explicit_interest_terms
        )
        preference_score = category_scores.get(article.primary_category, 0.0)
        keyword_score = sum(
            keyword_scores.get(keyword, 0.0) for keyword in article.keywords
        )
        raw_negative_penalty = sum(
            abs(negative_keywords.get(keyword, 0.0)) for keyword in article.keywords
        )
        negative_penalty = min(
            raw_negative_penalty,
            1.0 if article.primary_category in explicit_interests else 2.0,
        )
        if article.published_at:
            recency_hours = (
                now - article.published_at.astimezone(timezone.utc)
            ).total_seconds() / 3600
        else:
            recency_hours = settings.ARTICLE_MAX_AGE_HOURS
        recency_score = max(
            0.0, 1.75 - (recency_hours / settings.ARTICLE_MAX_AGE_HOURS) * 1.75
        )

        exploration_bonus = 0.0
        if explicit_interests and article.primary_category not in explicit_interests:
            exploration_bonus = 0.15
        elif not explicit_interests:
            exploration_bonus = 0.4

        engagement_similarity = 0.0
        if article.story_key in positive_story_keys:
            engagement_similarity += 0.8
        if article.story_key in negative_story_keys:
            engagement_similarity -= 1.2
        if has_interaction:
            engagement_similarity -= 2.25
        embedding_similarity_score = (
            cosine_similarity(user_embedding, article.embedding) * 1.5
        )

        score = (
            explicit_score
            + country_score
            + explicit_keyword_score
            + preference_score
            + keyword_score
            + recency_score
            + exploration_bonus
            + engagement_similarity
            + embedding_similarity_score
            - negative_penalty
        )
        if score <= 0 and not (
            article.primary_category in explicit_interests
            or article.country in explicit_country_codes
            or explicit_keyword_score > 0
        ):
            continue

        if country_score > 0:
            reason = "country-match"
        elif explicit_score > 0:
            reason = "interest-match"
        elif explicit_keyword_score > 0:
            reason = "keyword-match"
        elif keyword_score > 0:
            reason = "behavioral-similarity"
        else:
            reason = "fresh-exploration"
        ranked.append(
            RankedArticle(
                article=article,
                score=round(score, 4),
                reason=reason,
                has_interaction=has_interaction,
            )
        )

    ranked.sort(key=lambda item: (item.has_interaction, -item.score))
    return rerank_with_constraints(ranked, explicit_interests=explicit_interests)


def rerank_with_constraints(
    ranked_articles: list[RankedArticle], *, explicit_interests: set[str]
) -> list[RankedArticle]:
    max_feed_items = settings.MAX_FEED_ITEMS
    explicit_interest_terms = {
        token.lower()
        for interest in explicit_interests
        for token in interest.replace("-", " ").split()
        if token
    }
    explicit_country_codes = get_explicit_country_codes(explicit_interests)
    remaining = sorted(
        ranked_articles,
        key=lambda item: (
            item.has_interaction,
            _stage_for_article(
                item,
                explicit_interests=explicit_interests,
                explicit_interest_terms=explicit_interest_terms,
                explicit_country_codes=explicit_country_codes,
            ),
            -item.score,
        ),
    )
    ordered: list[RankedArticle] = []
    source_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    exploration_count = 0
    recent_categories: list[str] = []
    selected_keywords: list[list[str]] = []

    while remaining and len(ordered) < max_feed_items:
        best_index = 0
        best_item: RankedArticle | None = None
        best_adjusted_score = float("-inf")
        prefer_unseen = any(not item.has_interaction for item in remaining)

        for index, item in enumerate(remaining):
            if prefer_unseen and item.has_interaction:
                continue

            article = item.article
            category = article.primary_category
            source_name = article.source or "unknown"
            is_exploration = (
                bool(explicit_interests) and category not in explicit_interests
            )
            stage = _stage_for_article(
                item,
                explicit_interests=explicit_interests,
                explicit_interest_terms=explicit_interest_terms,
                explicit_country_codes=explicit_country_codes,
            )

            adjusted_score = item.score
            if item.has_interaction:
                adjusted_score -= (
                    8.0 if len(ordered) < settings.feed_edition_size else 2.0
                )
            adjusted_score -= 0.45 * source_counts.get(source_name, 0)
            adjusted_score -= 0.25 * category_counts.get(category, 0)
            if recent_categories[-2:] == [category, category]:
                adjusted_score -= 0.65
            if stage == 0:
                adjusted_score += 0.45
            elif stage == 1:
                adjusted_score += 0.2
            elif stage == 2:
                adjusted_score -= 0.15
            else:
                adjusted_score -= 0.35
            if is_exploration and len(ordered) < settings.feed_edition_size:
                max_early_exploration = max(
                    1, int(settings.feed_edition_size * settings.FEED_EXPLORATION_RATIO)
                )
                if exploration_count >= max_early_exploration:
                    adjusted_score -= 0.9
            if category in explicit_interests:
                adjusted_score += 0.2
            if article.country in explicit_country_codes:
                adjusted_score += 0.35

            if selected_keywords:
                max_similarity = max(
                    _keyword_overlap(article.keywords, existing_keywords)
                    for existing_keywords in selected_keywords[-5:]
                )
                adjusted_score -= max_similarity * 0.8

            if explicit_interests and len(ordered) < settings.feed_edition_size:
                distinct_interest_categories_used = sum(
                    1 for key in category_counts if key in explicit_interests
                )
                if (
                    category in explicit_interests
                    and category_counts.get(category, 0) == 0
                    and distinct_interest_categories_used < len(explicit_interests)
                ):
                    adjusted_score += 0.3

            if adjusted_score > best_adjusted_score:
                best_adjusted_score = adjusted_score
                best_item = item
                best_index = index

        assert best_item is not None
        ordered.append(
            RankedArticle(
                article=best_item.article,
                score=round(best_adjusted_score, 4),
                reason=best_item.reason,
                has_interaction=best_item.has_interaction,
            )
        )
        selected_article = best_item.article
        selected_category = selected_article.primary_category
        selected_source = selected_article.source or "unknown"
        source_counts[selected_source] = source_counts.get(selected_source, 0) + 1
        category_counts[selected_category] = (
            category_counts.get(selected_category, 0) + 1
        )
        if explicit_interests and selected_category not in explicit_interests:
            exploration_count += 1
        recent_categories.append(selected_category)
        selected_keywords.append(selected_article.keywords or [])
        remaining.pop(best_index)

    return ordered


def persist_feed(
    db: Session,
    *,
    user: db_model.User,
    ranked_articles: list[RankedArticle],
    feed_date: date,
    edition_type: str = MORNING_BRIEF,
    market_timezone: str = DEFAULT_TIMEZONE,
    excluded_article_ids: set[int] | None = None,
) -> int:
    persisted_count = 0
    excluded_article_ids = excluded_article_ids or set()
    selected = [
        item for item in ranked_articles if item.article.id not in excluded_article_ids
    ][: settings.feed_edition_size]
    for index, item in enumerate(selected, start=1):
        if item.article.summary is None:
            continue
        db.add(
            db_model.Flashcard(
                user_id=user.id,
                article_id=item.article.id,
                summary_id=item.article.summary.id,
                feed_date=feed_date,
                edition_type=edition_type,
                market_timezone=market_timezone,
                rank_position=index,
                ranking_score=item.score,
                ranking_reason=item.reason,
            )
        )
        persisted_count += 1
    return persisted_count
