# ranks articles and persists stable user feed editions
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import and_, desc
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.db import model as db_model
from app.services.embeddings import cosine_similarity
from app.services.feed_editions import (
    DAILY_DIGEST,
    DEFAULT_TIMEZONE,
    MIDDAY_CATCH_UP,
    MORNING_BRIEF,
)

logger = logging.getLogger(__name__)


@dataclass
class RankedArticle:
    article: db_model.Article
    score: float
    reason: str
    has_interaction: bool = False
    lane: str = "exploration"


COUNTRY_INTERESTS = {
    "india": "in",
    "in": "in",
    "united states": "us",
    "us": "us",
    "usa": "us",
}
MARKET_COUNTRY_BY_TIMEZONE = {
    "America/New_York": "us",
    "Asia/Kolkata": "in",
}
# Lanes make ranking explainable: first fill a user's market/category interests,
# then add market context, global category matches, and a small exploration slice.
EDITION_LANE_RATIOS = {
    MORNING_BRIEF: {
        "market_category": 0.60,
        "market_context": 0.20,
        "category_global": 0.15,
        "exploration": 0.05,
    },
    MIDDAY_CATCH_UP: {
        "market_category": 0.50,
        "market_context": 0.20,
        "category_global": 0.20,
        "exploration": 0.10,
    },
    DAILY_DIGEST: {
        "market_category": 0.55,
        "market_context": 0.25,
        "category_global": 0.10,
        "exploration": 0.10,
    },
}


def get_explicit_interest_names(user: db_model.User) -> set[str]:
    return {link.interest.name.lower() for link in user.interests}


def get_explicit_country_codes(explicit_interests: set[str]) -> set[str]:
    return {
        country_code
        for interest in explicit_interests
        if (country_code := COUNTRY_INTERESTS.get(interest))
    }


def get_explicit_category_names(explicit_interests: set[str]) -> set[str]:
    country_interest_names = set(COUNTRY_INTERESTS)
    return {
        interest
        for interest in explicit_interests
        if interest not in country_interest_names
    }


def get_market_country_codes(
    explicit_country_codes: set[str], market_timezone: str
) -> set[str]:
    if explicit_country_codes:
        return explicit_country_codes
    default_country = MARKET_COUNTRY_BY_TIMEZONE.get(market_timezone)
    return {default_country} if default_country else set()


def _article_lane(
    article: db_model.Article,
    *,
    selected_country_codes: set[str],
    selected_categories: set[str],
    explicit_country_codes: set[str],
    explicit_interest_terms: set[str],
) -> str:
    country_match = article.country in selected_country_codes
    explicit_country_match = article.country in explicit_country_codes
    category_match = article.primary_category in selected_categories
    keyword_match = bool(set(article.keywords or []) & explicit_interest_terms)

    if country_match and category_match:
        return "market_category"
    if explicit_country_match or (country_match and not selected_categories):
        return "market_context"
    if category_match or keyword_match:
        return "category_global"
    return "exploration"


def _reason_for_lane(lane: str, *, has_behavioral_signal: bool) -> str:
    if has_behavioral_signal:
        return f"{lane}+learned-signal"
    return lane


def _keyword_overlap(left: list[str] | None, right: list[str] | None) -> float:
    left_set = set(left or [])
    right_set = set(right or [])
    if not left_set or not right_set:
        return 0.0
    return len(left_set & right_set) / len(left_set | right_set)


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

    # Viewed cards are archived instead of deleted so refreshes keep read history stable.
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

    ranked = rank_articles_for_user(
        db,
        user=user,
        edition_type=edition_type,
        market_timezone=market_timezone,
    )
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


def rank_articles_for_user(
    db: Session,
    *,
    user: db_model.User,
    edition_type: str = MORNING_BRIEF,
    market_timezone: str = DEFAULT_TIMEZONE,
) -> list[RankedArticle]:
    explicit_interests = get_explicit_interest_names(user)
    explicit_country_codes = get_explicit_country_codes(explicit_interests)
    explicit_categories = get_explicit_category_names(explicit_interests)
    selected_country_codes = get_market_country_codes(
        explicit_country_codes, market_timezone
    )
    explicit_interest_terms = {
        token.lower()
        for interest in explicit_categories
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
        .limit(max(settings.MAX_FEED_ITEMS, settings.ARTICLE_POOL_LIMIT))
        .all()
    )

    ranked: list[RankedArticle] = []
    now = datetime.now(timezone.utc)
    for article in candidates:
        if article.summary is None:
            continue
        has_interaction = article.story_key in interacted_story_keys

        lane = _article_lane(
            article,
            selected_country_codes=selected_country_codes,
            selected_categories=explicit_categories,
            explicit_country_codes=explicit_country_codes,
            explicit_interest_terms=explicit_interest_terms,
        )
        category_match = article.primary_category in explicit_categories
        country_match = article.country in selected_country_codes
        explicit_country_match = article.country in explicit_country_codes
        intersection_match = country_match and category_match

        explicit_score = 3.0 if category_match else 0.0
        country_score = (
            3.25 if explicit_country_match else 0.75 if country_match else 0.0
        )
        intersection_score = 4.0 if intersection_match else 0.0
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
            1.0 if category_match else 2.0,
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
        if explicit_interests and lane == "exploration":
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
            intersection_score
            + explicit_score
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
            category_match or country_match or explicit_keyword_score > 0
        ):
            continue

        reason = _reason_for_lane(
            lane,
            has_behavioral_signal=keyword_score > 0 or embedding_similarity_score > 0,
        )
        ranked.append(
            RankedArticle(
                article=article,
                score=round(score, 4),
                reason=reason,
                has_interaction=has_interaction,
                lane=lane,
            )
        )

    ranked.sort(key=lambda item: (item.has_interaction, -item.score))
    return rerank_with_constraints(
        ranked,
        explicit_interests=explicit_interests,
        explicit_categories=explicit_categories,
        explicit_country_codes=explicit_country_codes,
        selected_country_codes=selected_country_codes,
        edition_type=edition_type,
    )


def rerank_with_constraints(
    ranked_articles: list[RankedArticle],
    *,
    explicit_interests: set[str],
    explicit_categories: set[str],
    explicit_country_codes: set[str],
    selected_country_codes: set[str],
    edition_type: str,
) -> list[RankedArticle]:
    max_feed_items = settings.MAX_FEED_ITEMS
    # These targets shape the first visible edition; overflow can still fill
    # MAX_FEED_ITEMS so users can keep swiping without immediate repetition.
    lane_targets = _lane_targets(
        edition_type=edition_type,
        total=settings.feed_edition_size,
        has_countries=bool(explicit_country_codes),
        has_categories=bool(explicit_categories),
    )
    remaining = sorted(
        ranked_articles,
        key=lambda item: (
            item.has_interaction,
            _lane_sort_order(item.lane),
            -item.score,
        ),
    )
    ordered: list[RankedArticle] = []
    source_counts: dict[str, int] = {}
    category_counts: dict[str, int] = {}
    country_counts: dict[str, int] = {}
    lane_counts: dict[str, int] = {}
    exploration_count = 0
    recent_categories: list[str] = []
    selected_keywords: list[list[str]] = []

    while remaining and len(ordered) < max_feed_items:
        eligible_lanes = _eligible_lanes(
            remaining,
            lane_targets=lane_targets,
            lane_counts=lane_counts,
            ordered_count=len(ordered),
        )
        best_index = 0
        best_item: RankedArticle | None = None
        best_adjusted_score = float("-inf")
        prefer_unseen = any(
            not item.has_interaction
            for item in remaining
            if not eligible_lanes or item.lane in eligible_lanes
        )

        for index, item in enumerate(remaining):
            if prefer_unseen and item.has_interaction:
                continue
            if eligible_lanes and item.lane not in eligible_lanes:
                continue

            article = item.article
            category = article.primary_category
            source_name = article.source or "unknown"
            is_exploration = item.lane == "exploration"

            adjusted_score = item.score
            if item.has_interaction:
                adjusted_score -= (
                    8.0 if len(ordered) < settings.feed_edition_size else 2.0
                )
            adjusted_score -= 0.45 * source_counts.get(source_name, 0)
            adjusted_score -= 0.25 * category_counts.get(category, 0)
            adjusted_score -= 0.18 * country_counts.get(article.country, 0)
            if recent_categories[-2:] == [category, category]:
                adjusted_score -= 0.65

            if item.lane == "market_category":
                adjusted_score += 0.7
            elif item.lane == "market_context":
                adjusted_score += 0.45
            elif item.lane == "category_global":
                adjusted_score += 0.2
            else:
                adjusted_score -= 0.2

            if is_exploration and len(ordered) < settings.feed_edition_size:
                max_early_exploration = max(
                    1, int(settings.feed_edition_size * settings.FEED_EXPLORATION_RATIO)
                )
                if exploration_count >= max_early_exploration:
                    adjusted_score -= 0.9
            if category in explicit_categories:
                adjusted_score += 0.2
            if article.country in selected_country_codes:
                adjusted_score += 0.35

            if selected_keywords:
                # Penalize near-duplicate keyword sets so one topic does not dominate a feed.
                max_similarity = max(
                    _keyword_overlap(article.keywords, existing_keywords)
                    for existing_keywords in selected_keywords[-5:]
                )
                adjusted_score -= max_similarity * 0.8

            if explicit_interests and len(ordered) < settings.feed_edition_size:
                distinct_interest_categories_used = sum(
                    1 for key in category_counts if key in explicit_categories
                )
                if (
                    category in explicit_categories
                    and category_counts.get(category, 0) == 0
                    and distinct_interest_categories_used < len(explicit_categories)
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
                lane=best_item.lane,
            )
        )
        selected_article = best_item.article
        selected_category = selected_article.primary_category
        selected_source = selected_article.source or "unknown"
        source_counts[selected_source] = source_counts.get(selected_source, 0) + 1
        category_counts[selected_category] = (
            category_counts.get(selected_category, 0) + 1
        )
        country_counts[selected_article.country] = (
            country_counts.get(selected_article.country, 0) + 1
        )
        lane_counts[best_item.lane] = lane_counts.get(best_item.lane, 0) + 1
        if best_item.lane == "exploration":
            exploration_count += 1
        recent_categories.append(selected_category)
        selected_keywords.append(selected_article.keywords or [])
        remaining.pop(best_index)

    return ordered


def _lane_targets(
    *,
    edition_type: str,
    total: int,
    has_countries: bool,
    has_categories: bool,
) -> dict[str, int]:
    if not has_countries and not has_categories:
        return {"market_context": total}
    if has_countries and not has_categories:
        return {
            "market_context": round(total * 0.75),
            "category_global": round(total * 0.10),
            "exploration": total,
        }
    if has_categories and not has_countries:
        return {
            "market_category": round(total * 0.55),
            "category_global": round(total * 0.30),
            "exploration": total,
        }

    ratios = EDITION_LANE_RATIOS.get(edition_type, EDITION_LANE_RATIOS[MORNING_BRIEF])
    targets = {lane: max(1, round(total * ratio)) for lane, ratio in ratios.items()}
    difference = total - sum(targets.values())
    targets["market_category"] = max(1, targets.get("market_category", 0) + difference)
    return targets


def _eligible_lanes(
    remaining: list[RankedArticle],
    *,
    lane_targets: dict[str, int],
    lane_counts: dict[str, int],
    ordered_count: int,
) -> set[str]:
    if ordered_count >= settings.feed_edition_size:
        return set()

    return {
        lane
        for lane, target in lane_targets.items()
        if lane_counts.get(lane, 0) < target
        and any(item.lane == lane for item in remaining)
    }


def _lane_sort_order(lane: str) -> int:
    return {
        "market_category": 0,
        "market_context": 1,
        "category_global": 2,
        "exploration": 3,
    }.get(lane, 4)


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
