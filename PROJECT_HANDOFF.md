# News Project Handoff

Last updated: 2026-06-07

## Current Shape

This repo is a personalized news flashcard app with:

- `backend/`: FastAPI, Postgres, Redis, Celery worker, Celery Beat, Alembic.
- `frontend/`: Expo SDK 54 app using Expo Router tabs.
- Branch: `backend`.
- The working tree has many uncommitted changes. Do not reset the repo unless those are intentionally preserved elsewhere.

## Key Backend Flow

Daily pipeline task:

```text
run_daily_pipeline_task
  -> fetch_news_task
  -> summarize_articles_task
  -> generate_morning_feeds_task(force_refresh=True)
```

Celery Beat now schedules only one daily job:

```text
daily-news-pipeline at 7:00 AM America/New_York
```

Important files:

- `backend/app/core/celery_app.py`: Beat schedule.
- `backend/app/tasks/news_fetching.py`: ingestion, summarization, feed generation.
- `backend/app/services/news.py`: NewsAPI client.
- `backend/app/services/summarizer.py`: OpenAI/fallback summary generation.
- `backend/app/services/recommendations.py`: ranking and feed persistence.
- `backend/app/api/endpoints/news.py`: feed, task, interaction, saved-article APIs.
- `backend/app/api/endpoints/dev.py`: local demo-feed helper still exists on backend but is no longer shown in frontend.

## Backend Environment

Relevant `.env` settings:

```env
NEWS_API_PAGE_SIZE="100"
NEWS_DAILY_ARTICLE_TARGET="250"
ARTICLE_POOL_LIMIT="500"
NEWS_BATCH_CATEGORIES="business,technology,health,sports,entertainment,science,general"
ARTICLE_MAX_AGE_HOURS="168"
MIN_ARTICLE_TEXT_LENGTH="60"
MAX_FEED_ITEMS="500"
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-4.1-mini"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
MORNING_FEED_HOUR="7"
MORNING_FEED_MINUTE="0"
```

Do not print real API keys in chat or commit `.env`.

After changing `.env`, recreate containers so Docker reloads env vars:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
docker compose up -d --force-recreate web worker beat
```

## NewsAPI Free Tier Notes

Official docs:

- Top Headlines `pageSize`: default 20, max 100 per request.
- Developer/free plan: 100 requests/day, development/testing only, 24-hour article delay, no production use.

Current strategy:

- 7 categories means about 7 NewsAPI requests/day for the daily run.
- `pageSize=100` requests up to 100 articles per category.
- `NEWS_DAILY_ARTICLE_TARGET=250` stops inserting after 250 valid new articles.
- `ARTICLE_POOL_LIMIT=500` keeps the global ordinary article pool bounded; saved articles are protected.
- `MAX_FEED_ITEMS=500` lets each user receive as many ranked cards as the current pool can support.
- This is safely below the 100 requests/day free limit, assuming only the scheduled daily run plus a few manual tests.

Why fetched and inserted counts differ:

- NewsAPI may return fewer than requested.
- The recommender uses a 7-day article freshness window (`ARTICLE_MAX_AGE_HOURS=168`) because the free/developer plan can return delayed articles and a 30-hour window left too few cards.
- Articles are deduped by URL/story key/title similarity.
- Very short/bad entries are filtered.
- Already-stored articles are skipped.

## OpenAI Summary Status

The logs showed:

```text
POST https://api.openai.com/v1/responses 401 Unauthorized
POST https://api.openai.com/v1/embeddings 401 Unauthorized
```

That means NewsAPI worked, but OpenAI auth failed. When this happens, summaries fall back to extractive snippets and look bad.

Test OpenAI without the whole pipeline:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
docker compose exec web python scripts/check_openai_key.py
```

Equivalent inline test:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
docker compose exec web python - <<'PY'
import asyncio
from app.services.summarizer import ArticleSummarizer

async def main():
    summarizer = ArticleSummarizer()
    result = await summarizer.summarize(
        title="Test headline",
        description="A city launched a new transit program after months of public feedback.",
        content="Officials said the program will expand bus frequency, reduce wait times, and collect rider feedback before a permanent rollout later this year.",
    )
    print(result["model_name"])
    print(result["main_takeaway"])

asyncio.run(main())
PY
```

Expected:

- If OpenAI works, `model_name` should be the configured OpenAI model, e.g. `gpt-4.1-mini`.
- If it prints `fallback-extractive`, OpenAI failed and the backend fell back.

## Summary Prompt Direction

Current summary style goal:

- Inshorts-style mobile paragraph.
- One paragraph only.
- No bullets, markdown, or labels.
- 260-420 characters.
- 2-4 short sentences.
- Must end with a complete sentence.
- Avoid repeating the headline/source.

Backend code enforces sentence-boundary cleanup and handles abbreviations like `D.C.`, `U.S.`, and `U.K.` to avoid broken summaries.

To regenerate stored summaries after fixing OpenAI:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
curl -X POST "http://localhost:8000/api/tasks/summarize-news?limit=100&force_refresh=true"
docker compose logs -f worker
curl -X POST "http://localhost:8000/api/tasks/generate-feeds?force_refresh=true"
```

## Frontend UX State

Important files:

- `frontend/app/(tabs)/index.tsx`: Feed flashcard UI.
- `frontend/app/(tabs)/explore.tsx`: Profile/account/interests/saved articles.
- `frontend/app/(tabs)/_layout.tsx`: tabs.
- `frontend/lib/api.ts`: typed API client and request logging.

Current feed behavior:

- Swipe left = next article, like turning to the next page.
- Swipe right = previous article.
- At the end, user sees `You’re all caught up`.
- Like/dislike/save are small toggleable emoji buttons beside category/date: `👍 👎 🔖`.
- The feed screen prefetches images for the next two cards to reduce swipe lag.
- Category and article date remain above headline.
- Headline is clickable and opens original article.
- Summary is regular-weight, smaller text, one paragraph.

Current Profile behavior:

- Tab is called `Profile`.
- Before setup, user creates/logs in, chooses interests once, then generates feed.
- Returning users load their existing interests and land directly on Profile.
- Existing account on create prompts user to log in instead of silently advancing.
- Saved articles section shows backend-saved bookmarked stories.
- Debug log and backend URL input are removed from user-facing UI.

If Expo shows stale UI:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/frontend
npx expo start -c
```

Then fully close/reopen Expo Go and scan the new QR.

## Validation Commands

Backend:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
./.venv/bin/python -m pytest -q
./.venv/bin/python -m compileall -q app
```

Frontend:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/frontend
npm run lint
npx tsc --noEmit
```

## Known Issues / Watchouts

- If OpenAI key is wrong, summarization and embeddings show `401 Unauthorized` and fallback summaries are poor.
- Celery workers must be restarted after task signature changes.
- Celery Beat has a persistent `celerybeat-schedule` file. If schedules act stale, delete `backend/celerybeat-schedule` and restart `beat`.
- NewsAPI Developer plan is for development/testing only, not production.
- The database is persistent via Docker volume. It is not cleared unless the volume is removed.
- `.env` is secret and should not be committed.

## Future: Better Summaries, Fine-Tuning, DPO

Do not start with DPO. The practical roadmap:

1. Store articles and summaries daily.
2. Add `summary_feedback` table:
   - `article_id`
   - generated summary
   - user/editor rating
   - edited summary
   - flags: too_long, too_short, awkward, missing_context, repeated_headline, wrong_focus
   - model/prompt version
3. Add a small internal review UI in Profile/Admin.
4. Build an eval set after about a week of stored articles.
5. Run prompt A/B tests first.
6. Fine-tune only when there are enough high-quality edited summaries.
7. DPO later, once there are preference pairs:
   - chosen summary
   - rejected summary
   - same source article

Good show-off features before DPO:

- Summary quality dashboard.
- Prompt version tracking.
- Human-edited summary dataset.
- Automatic summary evaluator for length, source repetition, headline repetition, sentence completeness.
- Personalization metrics from likes/saves/skips.
- Embedding-based article diversity and duplicate clustering.

## Useful Commands

Start backend:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
docker compose up --build
```

Run migrations and seed interests:

```bash
docker compose exec web alembic upgrade head
docker compose exec web python app/db/scripts/initial_data.py
```

Run pipeline manually:

```bash
curl -X POST http://localhost:8000/api/tasks/daily-pipeline
docker compose logs -f worker web
```

Start frontend:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/frontend
nvm use 20.19.4
npm install
npx expo start -c
```
