from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.summarizer import ArticleSummarizer


async def main() -> int:
    summarizer = ArticleSummarizer()
    result = await summarizer.summarize(
        title="City launches faster bus service after pilot program",
        description=(
            "Officials said the pilot reduced average wait times and improved rider "
            "feedback across several busy routes."
        ),
        content=(
            "The transit agency plans to expand the program next month while tracking "
            "on-time performance, crowding, and rider satisfaction before a permanent rollout."
        ),
    )
    print(f"model_name={result['model_name']}")
    print(result["main_takeaway"])
    if result["model_name"] == "fallback-extractive":
        print("OpenAI check failed: backend used fallback summarization.")
        return 1
    print("OpenAI check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
