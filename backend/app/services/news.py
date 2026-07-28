# newsapi client used by ingestion jobs
from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.core.config import settings


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class NewsApiService:
    def __init__(self) -> None:
        api_key = (settings.NEWS_API_KEY or "").strip()
        if not api_key:
            raise RuntimeError("NEWS_API_KEY is missing. Set it in .env / environment.")

        self.api_key = api_key
        self.base_url = settings.NEWS_API_BASE_URL.rstrip("/")
        self.page_size = min(max(settings.NEWS_API_PAGE_SIZE, 1), 100)
        self._source_cache: dict[tuple[str, str], list[str]] = {}

    async def fetch_top_headlines(
        self,
        *,
        category: str,
        country: str | None = None,
        query: str | None = None,
        page_size: int | None = None,
    ) -> list[dict[str, Any]]:
        selected_country = (country or settings.NEWS_API_COUNTRY).lower()
        params: dict[str, Any] = {
            "apiKey": self.api_key,
            "country": selected_country,
            "category": category,
            "pageSize": page_size or self.page_size,
        }
        if query:
            params["q"] = query

        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{self.base_url}/top-headlines", params=params)
            response.raise_for_status()
            payload = response.json()

        return _normalize_articles(payload, country=selected_country)

    async def fetch_top_headlines_for_country_sources(
        self,
        *,
        category: str,
        country: str,
        page_size: int | None = None,
    ) -> list[dict[str, Any]]:
        source_ids = await self.fetch_source_ids(country=country, category=category)
        if not source_ids:
            return []

        params: dict[str, Any] = {
            "apiKey": self.api_key,
            "sources": ",".join(source_ids[:20]),
            "pageSize": page_size or self.page_size,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{self.base_url}/top-headlines", params=params)
            response.raise_for_status()
            payload = response.json()

        return _normalize_articles(payload, country=country)

    async def fetch_everything(
        self,
        *,
        query: str,
        country: str,
        page_size: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "apiKey": self.api_key,
            "q": query,
            "language": "en",
            "sortBy": "publishedAt",
            "pageSize": page_size or self.page_size,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(f"{self.base_url}/everything", params=params)
            response.raise_for_status()
            payload = response.json()

        return _normalize_articles(payload, country=country)

    async def fetch_source_ids(self, *, country: str, category: str) -> list[str]:
        normalized_country = country.lower()
        normalized_category = category.lower()
        cache_key = (normalized_country, normalized_category)
        if cache_key in self._source_cache:
            return self._source_cache[cache_key]

        params: dict[str, Any] = {
            "apiKey": self.api_key,
            "country": normalized_country,
            "category": normalized_category,
            "language": "en",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.get(
                f"{self.base_url}/top-headlines/sources", params=params
            )
            response.raise_for_status()
            payload = response.json()

        source_ids = [
            source["id"] for source in payload.get("sources") or [] if source.get("id")
        ]
        self._source_cache[cache_key] = source_ids
        return source_ids


def _normalize_articles(
    payload: dict[str, Any],
    *,
    country: str,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for article in payload.get("articles") or []:
        normalized.append(
            {
                "title": article.get("title") or "",
                "source": (article.get("source") or {}).get("name"),
                "country": country.lower(),
                "url": article.get("url") or "",
                "published_at": _parse_dt(article.get("publishedAt")),
                "description": article.get("description"),
                "content": article.get("content"),
                "image_url": article.get("urlToImage"),
            }
        )
    return [article for article in normalized if article["url"]]
