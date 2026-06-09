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

        normalized: list[dict[str, Any]] = []
        for article in payload.get("articles") or []:
            normalized.append(
                {
                    "title": article.get("title") or "",
                    "source": (article.get("source") or {}).get("name"),
                    "country": selected_country,
                    "url": article.get("url") or "",
                    "published_at": _parse_dt(article.get("publishedAt")),
                    "description": article.get("description"),
                    "content": article.get("content"),
                    "image_url": article.get("urlToImage"),
                }
            )
        return [article for article in normalized if article["url"]]
