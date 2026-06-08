News Summarizer API

This backend now supports a batched news pipeline for a personalized morning feed:

- category-based NewsAPI ingestion on a schedule
- normalization, recency filtering, and deduplication before storage
- offline article summarization stored ahead of feed generation
- per-user morning feed generation with lightweight heuristic ranking
- interaction logging that updates category and keyword preference scores

Setup

1. Copy [`.env.example`](/Users/ananyasrivastava/Desktop/Projects/news/backend/.env.example) to `.env`.
2. Fill in `SECRET_KEY`, `NEWS_API_KEY`, and optionally `OPENAI_API_KEY`.
3. Start the stack:

```bash
docker-compose up --build -d
```

4. Apply migrations:

```bash
docker-compose exec web alembic upgrade head
```

5. Seed interests if needed:

```bash
docker-compose exec web python app/db/scripts/initial_data.py
```

Services

- `web`: FastAPI API
- `worker`: Celery worker for ingestion, summarization, and feed jobs
- `beat`: Celery Beat scheduler for daily ingestion/summarization/feed generation
- `db`: Postgres
- `redis`: Celery broker/backend

Manual task triggers

- `POST /api/tasks/fetch-news`
- `POST /api/tasks/summarize-news`
- `POST /api/tasks/generate-feeds`
- `POST /api/tasks/daily-pipeline`
- `POST /api/tasks/backfill-interest-news`

Feed and interaction APIs

- `GET /api/users/me/feed`
- `POST /api/users/me/interactions`

Pipeline overview

1. Celery Beat fetches recent NewsAPI headlines by category in batches.
2. Articles are normalized into a consistent schema and deduplicated by URL/story key/title similarity.
3. Pending articles are summarized offline and stored in the `summaries` table.
4. At the morning schedule, feeds are generated per user from precomputed summaries.
5. User interactions update category and keyword preference scores for future ranking.

Notes

- If `OPENAI_API_KEY` is unset, summarization falls back to a deterministic extractive summary so the pipeline still works for local MVP development.
- Feed generation never calls summarization in the request path.
- The ranking strategy is intentionally lightweight and interpretable so weights can be tuned in code as data comes in.
