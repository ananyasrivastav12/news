# In app/services/news.py

from typing import Any, Dict, List

import httpx

from app.core.config import settings

NEWS_API_BASE_URL = "https://newsapi.org/v2/top-headlines"


async def fetch_top_headlines(category: str) -> List[Dict[str, Any]]:
    """
    Fetches top news headlines for a given category from the News API.
    """
    params = {
        "apiKey": settings.NEWS_API_KEY,
        "category": category.lower(),
        "country": "us",
        "pageSize": 20,
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(NEWS_API_BASE_URL, params=params)
            response.raise_for_status()
            data = response.json()
            return data.get("articles", [])
        except httpx.HTTPStatusError as e:
            print(f"HTTP error occurred while fetching '{category}': {e}")
            return []
        except Exception as e:
            print(f"An error occurred while fetching '{category}': {e}")
            return []
