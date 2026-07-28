# turns article text into mobile-card summaries
from __future__ import annotations

import asyncio
import random
import re
from typing import Any

import httpx

from app.core.config import settings


class ArticleSummarizer:
    # retry only errors that are usually temporary
    TRANSIENT_OPENAI_STATUSES = {408, 409, 429, 500, 502, 503, 504}
    HEADLINE_MAX_WIDTH_PX = 300
    HEADLINE_FONT_SIZE_PX = 18
    HEADLINE_MAX_LINES = 3
    SUMMARY_MAX_WIDTH_PX = 300
    SUMMARY_FONT_SIZE_PX = 16
    SUMMARY_MAX_LINES = 9
    SUMMARY_MIN_WORDS = 48
    SUMMARY_MAX_WORDS = 62
    SUMMARY_MAX_CHARS = 430

    def __init__(self) -> None:
        self.api_key = (settings.OPENAI_API_KEY or "").strip()
        self.model = settings.OPENAI_MODEL

    async def summarize(
        self, *, title: str, description: str | None, content: str | None
    ) -> dict[str, Any]:
        # fallback keeps local demos working without openai
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
        validation_feedback = ""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        import json

        for attempt in range(3):
            # schema output keeps card fields predictable for the mobile app
            payload = {
                "model": self.model,
                "input": self._build_prompt(
                    title=title,
                    raw_text=raw_text,
                    validation_feedback=validation_feedback,
                ),
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "flashcard_summary",
                        "schema": {
                            "type": "object",
                            "properties": {
                                "display_headline": {"type": "string"},
                                "main_takeaway": {"type": "string"},
                                "full_summary": {"type": "string"},
                                "why_it_matters": {"type": "string"},
                                "supporting_lines": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "maxItems": 0,
                                },
                            },
                            "required": [
                                "display_headline",
                                "main_takeaway",
                                "full_summary",
                                "why_it_matters",
                                "supporting_lines",
                            ],
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

            data = json.loads(parsed)
            raw_summary = {
                "display_headline": data.get("display_headline", ""),
                "main_takeaway": data.get("main_takeaway", ""),
                "why_it_matters": data.get("why_it_matters", ""),
            }
            issues = self._display_copy_issues(raw_summary)
            shaped = self._shape_summary(
                title=title,
                display_headline=data.get("display_headline", ""),
                main_takeaway=data.get("main_takeaway", ""),
                full_summary=data.get("full_summary", ""),
                why_it_matters=data.get("why_it_matters", ""),
                supporting_lines=data.get("supporting_lines") or [],
                model_name=self.model,
            )
            if not issues:
                return shaped
            validation_feedback = (
                "\n\nYour previous response failed these checks: "
                + "; ".join(issues)
                + ". Rewrite all fields to satisfy the constraints."
            )
            if attempt == 2:
                return self._repair_summary(shaped)

        raise RuntimeError("OpenAI response validation did not complete")

    @staticmethod
    def _build_prompt(
        *, title: str, raw_text: str, validation_feedback: str = ""
    ) -> str:
        return (
            "Rewrite this news article for The Edit, a compact personalized mobile "
            "newspaper. Return concise, factual copy designed for a fixed-size mobile "
            "flashcard. Do not use bullets, markdown, labels, hype, speculation, or "
            "filler. Do not write phrases like 'this article discusses', 'the story "
            "highlights', or 'according to the article'. Do not use ellipses. Every "
            "field must end with a complete sentence.\n\n"
            "Create display_headline: A clean editorial headline for the card. "
            "Preserve the main fact. Remove SEO filler, source suffixes, redundant "
            "dates, and vague teaser language. Do not sensationalize. Target 55 to "
            "75 characters. It must fit 2 to 3 visual lines in a 300px column using "
            "Georgia 18px text with 22px line height. Hard maximum 90 characters.\n\n"
            "Create main_takeaway: One polished paragraph for the flashcard body. "
            "Use 2 to 3 complete sentences. Lead with the actual news development, "
            "then add concrete context, stakes, or the next thing to watch. Do not "
            "repeat the headline verbatim. Do not include the source name unless it "
            "is central to the story. Avoid filler and do not invent facts when the "
            "source text is thin. Target 48 to 62 words and fit 9 visual lines in a "
            "300px column using system sans 16px text with 23px line height. Hard "
            "maximum 430 characters.\n\n"
            "Create full_summary: A longer 4 to 6 sentence summary for future detail "
            "views. Keep it factual, specific, and complete.\n\n"
            "Create why_it_matters: One sentence of 12 to 22 words explaining a "
            "concrete consequence. Use an empty string if there is no meaningful "
            "consequence.\n\n"
            "Return JSON with keys display_headline, main_takeaway, full_summary, "
            "why_it_matters, and supporting_lines. supporting_lines must be an empty "
            "array.\n"
            f"{validation_feedback}\n\n"
            f"Original headline:\n{title}\n\nArticle:\n{raw_text[:6000]}"
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
        # avoid repeating the headline as the whole summary
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
            title=title,
            display_headline=title,
            main_takeaway=main_takeaway,
            full_summary=main_takeaway,
            why_it_matters="",
            supporting_lines=[],
            model_name="fallback-extractive",
        )

    def _shape_summary(
        self,
        *,
        title: str,
        display_headline: str,
        main_takeaway: str,
        full_summary: str,
        why_it_matters: str,
        supporting_lines: list[str],
        model_name: str,
    ) -> dict[str, Any]:
        # final shaping enforces mobile card limits even when model output drifts
        cleaned_headline = self._fit_headline(display_headline or title)
        main_candidate = " ".join(main_takeaway.split())
        full_candidate = " ".join((full_summary or "").split())
        if len(main_candidate.split()) < self.SUMMARY_MIN_WORDS and len(
            full_candidate.split()
        ) > len(main_candidate.split()):
            # use the fuller field when the model underfills the card body
            main_candidate = full_candidate

        cleaned_main = self._fit_paragraph(
            self._drop_truncated_sentences(main_candidate),
            max_chars=self.SUMMARY_MAX_CHARS,
            max_lines=self.SUMMARY_MAX_LINES,
        )
        cleaned_full = self._drop_truncated_sentences(
            " ".join((full_summary or cleaned_main).split())
        )
        summary_text = cleaned_full.strip() or cleaned_main
        cleaned_why = self._fit_why_it_matters(why_it_matters)
        return {
            "display_headline": cleaned_headline,
            "main_takeaway": cleaned_main,
            "supporting_lines": [],
            "summary_text": summary_text,
            "why_it_matters": cleaned_why,
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

    def _fit_headline(self, text: str) -> str:
        text = self._strip_seo_suffix(" ".join(text.split()).strip())
        text = text.replace("...", "").replace("…", "").strip(" -:")
        if (
            len(text) <= 90
            and self._estimated_line_count(
                text,
                max_width_px=self.HEADLINE_MAX_WIDTH_PX,
                font_size_px=self.HEADLINE_FONT_SIZE_PX,
                family="serif",
            )
            <= self.HEADLINE_MAX_LINES
        ):
            return text

        words = text.split()
        clipped_words: list[str] = []
        for word in words:
            candidate = " ".join([*clipped_words, word]).strip()
            if len(candidate) > 90:
                break
            if (
                self._estimated_line_count(
                    candidate,
                    max_width_px=self.HEADLINE_MAX_WIDTH_PX,
                    font_size_px=self.HEADLINE_FONT_SIZE_PX,
                    family="serif",
                )
                > self.HEADLINE_MAX_LINES
            ):
                break
            clipped_words.append(word)
        return (" ".join(clipped_words) or text[:90]).rstrip(" ,;:-")

    @staticmethod
    def _fit_paragraph(
        text: str, *, max_chars: int = 420, max_lines: int | None = None
    ) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        if (
            len(text) <= max_chars
            and re.search(r"[.!?]$", text)
            and (
                max_lines is None
                or ArticleSummarizer._estimated_line_count(
                    text,
                    max_width_px=ArticleSummarizer.SUMMARY_MAX_WIDTH_PX,
                    font_size_px=ArticleSummarizer.SUMMARY_FONT_SIZE_PX,
                    family="sans",
                )
                <= max_lines
            )
        ):
            return text

        sentences = ArticleSummarizer._split_sentences(text)
        paragraph_parts: list[str] = []
        for sentence in sentences:
            candidate = " ".join([*paragraph_parts, sentence]).strip()
            if len(candidate) > max_chars:
                break
            if (
                max_lines is not None
                and ArticleSummarizer._estimated_line_count(
                    candidate,
                    max_width_px=ArticleSummarizer.SUMMARY_MAX_WIDTH_PX,
                    font_size_px=ArticleSummarizer.SUMMARY_FONT_SIZE_PX,
                    family="sans",
                )
                > max_lines
            ):
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

    def _fit_why_it_matters(self, text: str) -> str:
        cleaned = self._drop_truncated_sentences(" ".join(text.split()))
        if not cleaned:
            return ""
        words = cleaned.split()
        if len(words) < 12 or len(words) > 22 or not re.search(r"[.!?]$", cleaned):
            return ""
        return cleaned

    def _display_copy_issues(self, summary: dict[str, Any]) -> list[str]:
        issues: list[str] = []
        headline = str(summary.get("display_headline") or "")
        main = str(summary.get("main_takeaway") or "")
        why = str(summary.get("why_it_matters") or "")
        headline_lines = self._estimated_line_count(
            headline,
            max_width_px=self.HEADLINE_MAX_WIDTH_PX,
            font_size_px=self.HEADLINE_FONT_SIZE_PX,
            family="serif",
        )
        summary_lines = self._estimated_line_count(
            main,
            max_width_px=self.SUMMARY_MAX_WIDTH_PX,
            font_size_px=self.SUMMARY_FONT_SIZE_PX,
            family="sans",
        )
        summary_words = len(main.split())
        if not headline:
            issues.append("display_headline is empty")
        if len(headline) > 90:
            issues.append("display_headline exceeds 90 characters")
        if headline_lines > self.HEADLINE_MAX_LINES:
            issues.append(f"display_headline wraps to {headline_lines} lines")
        if self._has_seo_suffix(headline):
            issues.append("display_headline includes a source or SEO suffix")
        if not re.search(r"[.!?]$", main):
            issues.append("main_takeaway does not end as a complete sentence")
        if "..." in main or "…" in main:
            issues.append("main_takeaway uses ellipses")
        if len(main) > self.SUMMARY_MAX_CHARS:
            issues.append(f"main_takeaway exceeds {self.SUMMARY_MAX_CHARS} characters")
        if summary_lines > self.SUMMARY_MAX_LINES:
            issues.append(f"main_takeaway wraps to {summary_lines} lines")
        if summary_words < self.SUMMARY_MIN_WORDS:
            issues.append(f"main_takeaway is under {self.SUMMARY_MIN_WORDS} words")
        if summary_words > self.SUMMARY_MAX_WORDS:
            issues.append(f"main_takeaway exceeds {self.SUMMARY_MAX_WORDS} words")
        if why:
            why_words = len(why.split())
            if why_words < 12 or why_words > 22 or not re.search(r"[.!?]$", why):
                issues.append(
                    "why_it_matters must be one complete 12 to 22 word sentence"
                )
        return issues

    def _repair_summary(self, summary: dict[str, Any]) -> dict[str, Any]:
        summary["display_headline"] = self._fit_headline(
            str(summary.get("display_headline") or "")
        )
        summary["main_takeaway"] = self._fit_paragraph(
            self._drop_truncated_sentences(str(summary.get("main_takeaway") or "")),
            max_chars=self.SUMMARY_MAX_CHARS,
            max_lines=self.SUMMARY_MAX_LINES,
        )
        summary["summary_text"] = self._drop_truncated_sentences(
            str(summary.get("summary_text") or summary["main_takeaway"])
        )
        summary["why_it_matters"] = self._fit_why_it_matters(
            str(summary.get("why_it_matters") or "")
        )
        summary["supporting_lines"] = []
        return summary

    @staticmethod
    def _estimated_line_count(
        text: str, *, max_width_px: int, font_size_px: int, family: str
    ) -> int:
        if not text:
            return 0
        lines = 1
        current_width = 0.0
        space_width = ArticleSummarizer._estimated_text_width(
            " ", font_size_px=font_size_px, family=family
        )
        for word in text.split():
            word_width = ArticleSummarizer._estimated_text_width(
                word, font_size_px=font_size_px, family=family
            )
            separator_width = space_width if current_width else 0.0
            if (
                current_width
                and current_width + separator_width + word_width > max_width_px
            ):
                lines += 1
                current_width = word_width
            else:
                current_width += separator_width + word_width
        return lines

    @staticmethod
    def _estimated_text_width(text: str, *, font_size_px: int, family: str) -> float:
        width = 0.0
        serif_adjustment = 1.08 if family == "serif" else 1.0
        for char in text:
            if char.isspace():
                factor = 0.28
            elif char in "ilI.,'!:;|":
                factor = 0.26
            elif char in "mwMW":
                factor = 0.9
            elif char.isupper():
                factor = 0.68
            elif char.isdigit():
                factor = 0.56
            elif char in "-/()&":
                factor = 0.38
            else:
                factor = 0.52
            width += font_size_px * factor * serif_adjustment
        return width

    @staticmethod
    def _strip_seo_suffix(text: str) -> str:
        return re.sub(r"\s+[-|]\s+[A-Za-z0-9 .,&']{2,40}$", "", text).strip()

    @staticmethod
    def _has_seo_suffix(text: str) -> bool:
        return bool(re.search(r"\s+[-|]\s+[A-Za-z0-9 .,&']{2,40}$", text))

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
