from __future__ import annotations

from math import sqrt

import httpx

from app.core.config import settings


class EmbeddingService:
    def __init__(self) -> None:
        self.api_key = (settings.OPENAI_API_KEY or "").strip()
        self.model = settings.OPENAI_EMBEDDING_MODEL

    async def embed_text(self, text: str) -> list[float] | None:
        cleaned = " ".join((text or "").split())
        if not cleaned or not self.api_key:
            return None

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {"model": self.model, "input": cleaned[:8000]}

        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://api.openai.com/v1/embeddings",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            body = response.json()

        data = body.get("data") or []
        if not data:
            return None
        embedding = data[0].get("embedding")
        if not isinstance(embedding, list):
            return None
        return [float(value) for value in embedding]


def cosine_similarity(left: list[float] | None, right: list[float] | None) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = sqrt(sum(a * a for a in left))
    right_norm = sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return numerator / (left_norm * right_norm)


def average_embeddings(vectors: list[list[float]]) -> list[float] | None:
    if not vectors:
        return None
    dimension = len(vectors[0])
    if any(len(vector) != dimension for vector in vectors):
        return None
    totals = [0.0] * dimension
    for vector in vectors:
        for index, value in enumerate(vector):
            totals[index] += value
    return [value / len(vectors) for value in totals]
