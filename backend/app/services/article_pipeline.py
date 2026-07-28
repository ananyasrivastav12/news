# normalizes, validates, categorizes, and dedupes incoming articles
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import model as db_model

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "in",
    "is",
    "it",
    "its",
    "of",
    "on",
    "that",
    "the",
    "to",
    "was",
    "were",
    "will",
    "with",
}

CATEGORY_KEYWORDS = {
    "business": {
        "market",
        "stocks",
        "earnings",
        "economy",
        "trade",
        "finance",
        "inflation",
        "tariff",
        "company",
        "ceo",
    },
    "technology": {
        "ai",
        "software",
        "chip",
        "app",
        "device",
        "tech",
        "startup",
        "robot",
        "platform",
        "cyber",
    },
    "health": {
        "health",
        "medical",
        "disease",
        "drug",
        "hospital",
        "wellness",
        "patient",
        "diagnosis",
        "symptom",
        "endometriosis",
        "virus",
    },
    "sports": {
        "game",
        "league",
        "player",
        "season",
        "match",
        "sports",
        "tournament",
        "playoff",
        "championship",
        "coach",
    },
    "entertainment": {
        "movie",
        "music",
        "show",
        "actor",
        "celebrity",
        "streaming",
        "series",
        "film",
        "tv",
        "awards",
    },
    "science": {
        "study",
        "research",
        "space",
        "climate",
        "science",
        "discovery",
        "scientists",
        "nasa",
        "experiment",
        "physics",
    },
    "general": {"government", "community", "news", "policy", "world"},
}


# normalized articles are the clean boundary between external api data and db rows
@dataclass
class NormalizedArticle:
    title: str
    normalized_title: str
    original_url: str
    source: str | None
    country: str
    description: str | None
    content: str | None
    raw_text: str
    cleaned_text: str
    published_at: datetime | None
    primary_category: str
    image_url: str | None
    keywords: list[str]
    story_key: str


def normalize_title(title: str) -> str:
    # normalized titles support fuzzy duplicate detection
    normalized = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", title.lower())).strip()
    return normalized


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"\[[^\]]+\]", " ", value)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def build_raw_text(title: str, description: str | None, content: str | None) -> str:
    parts = [clean_text(title), clean_text(description), clean_text(content)]
    return "\n".join([part for part in parts if part])


def extract_keywords(text: str, *, max_keywords: int = 8) -> list[str]:
    # simple keyword counts give ranking useful signals before ml exists
    counts: dict[str, int] = {}
    for token in re.findall(r"[a-zA-Z][a-zA-Z0-9'-]{2,}", text.lower()):
        if token in STOPWORDS:
            continue
        counts[token] = counts.get(token, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [word for word, _ in ranked[:max_keywords]]


def _category_scores(title: str, text: str) -> dict[str, float]:
    title_text = f" {title.lower()} "
    body_text = f" {text.lower()} "
    scores: dict[str, float] = {}
    for candidate, keywords in CATEGORY_KEYWORDS.items():
        score = 0.0
        for keyword in keywords:
            needle = f" {keyword.lower()} "
            if needle in title_text:
                score += 2.0
            if needle in body_text:
                score += 1.0
        scores[candidate] = score
    return scores


def enrich_category(category: str, title: str, text: str) -> str:
    # newsapi categories are broad, so title/text keywords can correct obvious misses
    default_category = (category or "general").lower()
    default_category = (
        default_category if default_category in CATEGORY_KEYWORDS else "general"
    )

    scores = _category_scores(title, text)
    scores[default_category] += 1.5

    best_category, best_score = max(scores.items(), key=lambda item: item[1])
    default_score = scores[default_category]

    if best_category == default_category:
        return default_category
    if best_score >= default_score + 2.0:
        return best_category
    if best_score >= 4.0 and best_score > default_score:
        return best_category
    return default_category


def build_story_key(normalized_title: str) -> str:
    # story keys catch repeated coverage across sources with different urls
    tokens = [token for token in normalized_title.split() if token not in STOPWORDS][
        :10
    ]
    base = " ".join(tokens) or normalized_title
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]


def is_recent(published_at: datetime | None) -> bool:
    if published_at is None:
        return False
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    age = datetime.now(timezone.utc) - published_at.astimezone(timezone.utc)
    return age <= timedelta(hours=settings.ARTICLE_MAX_AGE_HOURS)


def is_valid_article(raw_article: dict[str, Any]) -> bool:
    # reject thin or stale articles before they consume summary quota
    title = clean_text(raw_article.get("title"))
    url = (raw_article.get("url") or "").strip()
    raw_text = build_raw_text(
        title,
        raw_article.get("description"),
        raw_article.get("content"),
    )
    if not title or not url:
        return False
    if len(raw_text) < settings.MIN_ARTICLE_TEXT_LENGTH:
        return False
    return is_recent(raw_article.get("published_at"))


def normalize_article(raw_article: dict[str, Any], category: str) -> NormalizedArticle:
    title = clean_text(raw_article.get("title"))
    normalized_title = normalize_title(title)
    description = clean_text(raw_article.get("description"))
    content = clean_text(raw_article.get("content"))
    raw_text = build_raw_text(title, description, content)
    cleaned_text = clean_text(raw_text)
    primary_category = enrich_category(category, title, cleaned_text)
    keywords = extract_keywords(cleaned_text)
    story_key = build_story_key(normalized_title)

    return NormalizedArticle(
        title=title,
        normalized_title=normalized_title,
        original_url=(raw_article.get("url") or "").strip(),
        source=clean_text(raw_article.get("source")) or None,
        country=(raw_article.get("country") or settings.NEWS_API_COUNTRY).lower(),
        description=description or None,
        content=content or None,
        raw_text=raw_text,
        cleaned_text=cleaned_text,
        published_at=raw_article.get("published_at"),
        primary_category=primary_category,
        image_url=(raw_article.get("image_url") or "").strip() or None,
        keywords=keywords,
        story_key=story_key,
    )


def recalculate_article_features(article: db_model.Article) -> None:
    title = clean_text(article.title)
    description = clean_text(article.description)
    content = clean_text(article.content or article.cleaned_text or article.raw_text)
    raw_text = build_raw_text(title, description, content)
    cleaned_text = clean_text(raw_text)

    article.normalized_title = normalize_title(title)
    article.raw_text = raw_text
    article.cleaned_text = cleaned_text
    article.keywords = extract_keywords(cleaned_text)
    article.story_key = build_story_key(article.normalized_title)
    article.primary_category = enrich_category(
        article.primary_category or "general",
        title,
        cleaned_text,
    )


def is_duplicate_article(db: Session, article: NormalizedArticle) -> bool:
    # url catches exact duplicates; title similarity catches syndication copies
    by_url = (
        db.query(db_model.Article)
        .filter(db_model.Article.original_url == article.original_url)
        .first()
    )
    if by_url:
        return True

    by_story = (
        db.query(db_model.Article)
        .filter(db_model.Article.story_key == article.story_key)
        .order_by(desc(db_model.Article.published_at))
        .limit(10)
        .all()
    )
    for existing in by_story:
        ratio = SequenceMatcher(
            None, article.normalized_title, existing.normalized_title
        ).ratio()
        if ratio >= 0.9:
            return True

    return False


def upsert_article(db: Session, article: NormalizedArticle) -> db_model.Article:
    existing = (
        db.query(db_model.Article)
        .filter(db_model.Article.original_url == article.original_url)
        .first()
    )
    if existing:
        return existing

    db_article = db_model.Article(
        title=article.title,
        normalized_title=article.normalized_title,
        original_url=article.original_url,
        source=article.source,
        country=article.country,
        description=article.description,
        content=article.content,
        raw_text=article.raw_text,
        cleaned_text=article.cleaned_text,
        published_at=article.published_at,
        primary_category=article.primary_category,
        image_url=article.image_url,
        keywords=article.keywords,
        story_key=article.story_key,
        summary_status=db_model.SummaryStatus.PENDING,
    )
    db.add(db_article)
    db.flush()
    return db_article
