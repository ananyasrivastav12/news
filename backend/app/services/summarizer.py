from __future__ import annotations

import asyncio
import random
import re
from typing import Any

import httpx

from app.core.config import settings


class ArticleSummarizer:
    TRANSIENT_OPENAI_STATUSES = {408, 409, 429, 500, 502, 503, 504}

    def __init__(self) -> None:
        self.api_key = (settings.OPENAI_API_KEY or "").strip()
        self.model = settings.OPENAI_MODEL

    async def summarize(
        self, *, title: str, description: str | None, content: str | None
    ) -> dict[str, Any]:
        raw_text = "\n".join(
            part for part in [title, description, content] if part
        ).strip()
        if not raw_text:
            return self._fallback_summary(title=title, text="")

        if self.api_key:
            try:
                return await self._summarize_with_openai(title=title, raw_text=raw_text)
            except Exception:
                return self._fallback_summary(title=title, text=raw_text)

        return self._fallback_summary(title=title, text=raw_text)

    async def _summarize_with_openai(
        self, *, title: str, raw_text: str
    ) -> dict[str, Any]:
        prompt = (
            "Summarize this news article for a mobile flashcard feed in the style of Inshorts. "
            "Write one polished, factual paragraph with no bullets, no markdown, and no labels. "
            "The paragraph must be 260 to 420 characters and must end with a complete sentence. "
            "Use 2 to 4 short sentences. Lead with the actual news, include the most important "
            "context, and avoid vague phrases like 'this article discusses' or 'the story highlights'. "
            "Do not repeat the headline verbatim, do not include the source name unless it is central "
            "to the story, and do not end mid-thought. Do not use ellipses. "
            "Return JSON with keys main_takeaway and supporting_lines. "
            "main_takeaway must be the full paragraph. "
            "supporting_lines must be an empty array.\n\n"
            f"Headline:\n{title}\n\nArticle:\n{raw_text[:6000]}"
        )
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": self.model,
            "input": prompt,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "flashcard_summary",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "main_takeaway": {"type": "string"},
                            "supporting_lines": {
                                "type": "array",
                                "items": {"type": "string"},
                                "maxItems": 0,
                            },
                        },
                        "required": ["main_takeaway", "supporting_lines"],
                        "additionalProperties": False,
                    },
                }
            },
        }

        body = await self._post_openai_json(
            url="https://api.openai.com/v1/responses",
            headers=headers,
            payload=payload,
        )

        parsed = body.get("output", [{}])[0].get("content", [{}])[0].get("text")
        if not isinstance(parsed, str):
            raise ValueError("OpenAI response did not include parsed text")

        import json

        data = json.loads(parsed)
        return self._shape_summary(
            data.get("main_takeaway", ""),
            data.get("supporting_lines") or [],
            model_name=self.model,
        )

    async def _post_openai_json(
        self, *, url: str, headers: dict[str, str], payload: dict[str, Any]
    ) -> dict[str, Any]:
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=45) as client:
            for attempt in range(4):
                try:
                    response = await client.post(url, headers=headers, json=payload)
                    response.raise_for_status()
                    return response.json()
                except httpx.HTTPStatusError as exc:
                    status_code = exc.response.status_code
                    if status_code not in self.TRANSIENT_OPENAI_STATUSES:
                        raise
                    last_error = exc
                except (httpx.TimeoutException, httpx.TransportError) as exc:
                    last_error = exc

                if attempt < 3:
                    delay = (0.75 * (2**attempt)) + random.uniform(0, 0.25)
                    await asyncio.sleep(delay)

        if last_error is not None:
            raise last_error
        raise RuntimeError("OpenAI request failed without an error")

    def _fallback_summary(self, *, title: str, text: str) -> dict[str, Any]:
        title_key = self._normalize_for_compare(title)
        sentences = self._split_sentences(text)
        useful_sentences = []
        for sentence in sentences:
            lowered = sentence.lower()
            if "[removed]" in lowered or "read more" in lowered:
                continue
            sentence_key = self._normalize_for_compare(sentence)
            if sentence_key == title_key or sentence_key in title_key:
                continue
            useful_sentences.append(sentence)

        main_takeaway = " ".join(useful_sentences[:3]).strip() or title
        return self._shape_summary(
            main_takeaway=main_takeaway,
            supporting_lines=[],
            model_name="fallback-extractive",
        )

    def _shape_summary(
        self, main_takeaway: str, supporting_lines: list[str], *, model_name: str
    ) -> dict[str, Any]:
        cleaned_main = self._fit_paragraph(
            self._drop_truncated_sentences(" ".join(main_takeaway.split()))
        )
        summary_text = cleaned_main.strip()
        return {
            "main_takeaway": cleaned_main,
            "supporting_lines": [],
            "summary_text": summary_text,
            "model_name": model_name,
        }

    @staticmethod
    def _drop_truncated_sentences(text: str) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return text

        complete_sentences = [
            sentence
            for sentence in ArticleSummarizer._split_sentences(text)
            if "..." not in sentence and "…" not in sentence
        ]
        if complete_sentences:
            return " ".join(complete_sentences)
        return text.replace("...", ".").replace("…", ".")

    @staticmethod
    def _fit_paragraph(text: str, *, max_chars: int = 420) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) <= max_chars and re.search(r"[.!?]$", text):
            return text

        sentences = ArticleSummarizer._split_sentences(text)
        paragraph_parts: list[str] = []
        for sentence in sentences:
            candidate = " ".join([*paragraph_parts, sentence]).strip()
            if len(candidate) > max_chars:
                break
            paragraph_parts.append(sentence)

        if paragraph_parts:
            paragraph = " ".join(paragraph_parts).strip()
            if re.search(r"[.!?]$", paragraph):
                return paragraph

        words = text.split()
        clipped_words: list[str] = []
        for word in words:
            candidate = " ".join([*clipped_words, word]).strip()
            if len(candidate) > max_chars - 1:
                break
            clipped_words.append(word)
        clipped = " ".join(clipped_words).rstrip(" ,;:-")
        return f"{clipped}." if clipped else text[:max_chars].rstrip(" ,;:-") + "."

    @staticmethod
    def _split_sentences(text: str) -> list[str]:
        protected = text
        replacements = {
            "D.C.": "D<dot>C<dot>",
            "U.S.": "U<dot>S<dot>",
            "U.K.": "U<dot>K<dot>",
            "Mr.": "Mr<dot>",
            "Mrs.": "Mrs<dot>",
            "Ms.": "Ms<dot>",
            "Dr.": "Dr<dot>",
            "Prof.": "Prof<dot>",
            "Inc.": "Inc<dot>",
            "Ltd.": "Ltd<dot>",
        }
        for original, replacement in replacements.items():
            protected = protected.replace(original, replacement)
        sentences = [
            sentence.replace("<dot>", ".").strip()
            for sentence in re.split(r"(?<=[.!?])\s+", protected)
            if sentence.strip()
        ]
        return sentences

    @staticmethod
    def _normalize_for_compare(text: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()
