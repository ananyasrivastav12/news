News Summarizer API

This backend now supports a batched news pipeline for a personalized morning feed:

- country/category-based NewsAPI ingestion on a schedule
- normalization, recency filtering, and deduplication before storage
- offline article summarization stored ahead of feed generation
- per-user morning feed generation with lightweight heuristic ranking
- interaction logging that updates category and keyword preference scores

Setup

1. Copy [`.env.example`](/Users/ananyasrivastava/Desktop/Projects/news/backend/.env.example) to `.env`.
2. Fill in `SECRET_KEY`, `NEWS_API_KEY`, and optionally `OPENAI_API_KEY`.
3. Start the stack:

```bash
docker compose up --build -d
```

4. Apply migrations inside the `web` container:

```bash
docker compose exec web alembic upgrade head
```

5. Seed interests if needed:

```bash
docker compose exec web python app/db/scripts/initial_data.py
```

Use the Docker commands above as the default workflow. The `.env` file uses
`DATABASE_URL=postgresql://newsuser:newspass@db:5432/newsdb`, and the hostname
`db` only resolves from containers in the Compose network. If you run Alembic
directly from your Mac terminal, `db` will not resolve. Prefer
`docker compose exec web ...` so you do not need to modify or override local
environment variables.

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

Admin dashboard

The admin dashboard is a separate web app in `../dashboard`. It talks to the
same FastAPI backend and requires an admin user whose email is listed in
`ADMIN_EMAILS`.

1. Add your login email to backend `.env`:

```bash
ADMIN_EMAILS="your@email.com"
```

2. Recreate backend containers after changing `.env`:

```bash
docker compose up -d --force-recreate web worker beat
```

3. Apply migrations and seed interests:

```bash
docker compose exec web alembic upgrade head
docker compose exec web python app/db/scripts/initial_data.py
```

4. Create an admin user if needed:

```bash
curl -X POST http://localhost:8000/api/users/ \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"TestPassword123"}'
```

5. Start the dashboard from the repo root:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news
npm --prefix dashboard install
npm --prefix dashboard run dev -- --host 127.0.0.1
```

6. Open the dashboard:

```text
http://127.0.0.1:5173/
```

Log in with the admin email and password. Start by testing the safe admin
screens:

- Overview should load metrics.
- Pipeline Runs -> `Summarize` should create a completed run record without
  requiring NewsAPI articles.
- Scheduler should let you add a schedule row.
- Article Pool and Users should load existing data.

Use `Full pipeline` or `Ingest` only when `NEWS_API_KEY` is valid because those
paths call NewsAPI.

Local producer pipeline

NewsAPI calls happen on the backend/operator side, not in the Expo app. To run
the whole producer workflow locally from your machine:

```bash
cd backend
docker compose up -d db redis
./.venv/bin/python scripts/run_local_pipeline.py --force-feeds
```

That command ensures interests exist, fetches headlines for configured countries
and categories, stores valid articles, summarizes/embeds pending articles, prunes
the shared article pool, and rebuilds personalized feeds. Users then open the
app and receive already-processed cards ranked for their profile.

Use `NEWS_API_COUNTRIES="us,in"` for United States and India ingestion. With the
default seven NewsAPI categories, this plans 14 top-headline requests per run,
which is intentionally below the free-tier daily request budget.

Feed and interaction APIs

- `GET /api/users/me/feed`
- `POST /api/users/me/interactions`

Pipeline overview

1. Celery Beat or the local producer script fetches recent NewsAPI headlines by
   country/category in batches.
2. Articles are normalized into a consistent schema and deduplicated by URL/story key/title similarity.
3. Pending articles are summarized offline and stored in the `summaries` table.
4. At the morning schedule, feeds are generated per user from precomputed summaries.
5. User interactions update category and keyword preference scores for future ranking.

Notes

- If `OPENAI_API_KEY` is unset, summarization falls back to a deterministic extractive summary so the pipeline still works for local MVP development.
- Feed generation never calls summarization in the request path.
- The ranking strategy is intentionally lightweight and interpretable so weights can be tuned in code as data comes in.
