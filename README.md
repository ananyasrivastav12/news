# Personalized News Recommendation Platform

**FastAPI, PostgreSQL, Celery, Redis, React Native, Vector Search**

**The Edit** is a full-stack personalized news platform built with **FastAPI,
PostgreSQL, Celery, Redis, React Native, and embedding-based vector similarity**.
It turns live news into swipeable flashcard briefings, learns from reader
signals, and gives an admin a real control room for the ingestion and
summarization pipeline.

The project focuses on the hard parts behind a news product: fresh content
intake, fast mobile reading, useful personalization, and enough internal
tooling to understand whether the system is healthy.

- Daily editions are ranked from user interests, behavior, recency, keywords, and embedding similarity.
- Background workers ingest, deduplicate, summarize, embed, and prune articles without blocking the reader app.
- Swipes, likes, saves, skips, and dwell time feed back into the preference profile.
- The admin dashboard exposes pipeline runs, content coverage, beta users, and support messages.

## Product Demo

### Mobile Reader

The mobile app is designed to feel like a fast editorial product, not a generic
feed. Readers swipe through Morning, Midday, and Evening editions; images are
prefetched ahead of the current card; and every interaction updates the user's
preference profile.

<p>
  <img src="./docs/assets/mobile-briefing.png" alt="Swipeable briefing card" width="210">
  <img src="./docs/assets/mobile-feed-technology.png" alt="Technology briefing card" width="210">
  <img src="./docs/assets/mobile-feed-entertainment.png" alt="Entertainment briefing card" width="210">
  <img src="./docs/assets/mobile-profile.png" alt="Reader profile screen" width="210">
  <img src="./docs/assets/mobile-saved.png" alt="Saved stories screen" width="210">
</p>

### Admin Dashboard

The private dashboard turns the app into an operable system. It tracks article
supply, summary coverage, image coverage, market/category gaps, recent pipeline
runs, beta users, and support messages. This gives an admin a quick way to see
whether fresh content is flowing, where coverage is thin, and what needs follow-up.

![Admin dashboard home](./docs/assets/dashboard-home.png)

![Article quality and coverage dashboard](./docs/assets/dashboard-quality.png)

![Pipeline run details](./docs/assets/dashboard-pipeline-run.png)

![Article pool filters and review table](./docs/assets/dashboard-articles.png)

## Product And Engineering

The Edit has two connected parts: a mobile reader for personalized daily
briefings, and an admin dashboard for running and checking the content system.

- **Reader experience:** Users get Morning, Midday, and Evening editions with swipeable cards, images, sources, dates, summaries, likes, dislikes, and saves.
- **Personalization:** Selected regions/topics and reading behavior influence which articles appear first.
- **Content pipeline:** Celery workers ingest NewsAPI articles, validate them, remove duplicates, correct categories, extract keywords, summarize, embed, and prune the pool.
- **Ranking:** The recommender combines explicit interests, recency, keyword matches, behavior signals, embedding similarity, and diversity rules.
- **Mobile performance:** Feed images are prefetched 12 stories ahead and 4 behind with `expo-image` memory/disk caching.
- **Admin workflow:** The dashboard shows pipeline runs, article coverage, image gaps, beta users, support messages, and account controls.

## How It Works

```mermaid
flowchart LR
  A["NewsAPI"] --> B["Ingestion worker"]
  B --> C["Postgres article pool"]
  C --> D["LLM summaries"]
  C --> E["Article embeddings"]
  D --> F["Hybrid ranking"]
  E --> F
  G["User interests"] --> F
  H["Clicks, likes, saves, skips, dwell time"] --> F
  F --> I["Stable daily editions"]
  I --> J["React Native reader"]
  K["Admin dashboard"] --> B
  K --> D
  K --> C
```

1. Celery jobs fetch fresh articles by country and category.
2. Articles are cleaned, deduplicated by URL/story key, categorized, and stored.
3. Pending articles are summarized and embedded.
4. The recommender scores candidates using interest matches, country/category preferences, recency, keywords, previous behavior, and embedding similarity.
5. A reranker improves feed diversity by balancing markets, categories, sources, and duplicate-like stories.
6. Reader interactions are logged back into the preference system.

## Core Features

### Reader App

- Beta email/password login with persisted sessions.
- Three daily editions: Morning Brief, Midday Catch-Up, and Daily Digest.
- Swipeable flashcard UI with headline, image, metadata, summary, like, dislike, and save actions.
- Instant-feeling image loading with `expo-image` prefetching and memory/disk cache.
- Interest setup by region and topic.
- Saved stories screen with category filters.
- Profile page with reading stats, selected interests, account actions, and admin contact.

### Backend And Pipeline

- FastAPI API with SQLAlchemy models and Alembic migrations.
- PostgreSQL article pool with summaries, embeddings, flashcards, interactions, users, and support messages.
- Celery + Redis background workers for ingestion, summarization, embeddings, and scheduled editions.
- Configurable pipeline limits. Current defaults use a 1,200 article pool and a 400 article target per run.
- Duplicate suppression by URL and story-key similarity.
- Freshness controls so stale articles only backfill when fresh supply is thin.

### Admin Dashboard

- Pipeline controls for full refreshes, ingestion-only runs, and summarization-only runs.
- Health overview for retained articles, summaries, embeddings, users, saved articles, and attention items.
- Quality dashboard for market/category coverage, missing images, pending summaries, and thin buckets.
- Article browser with filters for market, category, source, date, summary status, image status, signals, and protected articles.
- User management for beta accounts, password resets, and account deletion.
- Support inbox for authenticated reader messages.

## Tech Stack

- **Mobile:** Expo, React Native, TypeScript, Expo Router, `expo-image`.
- **Dashboard:** React, TypeScript, Vite.
- **Backend:** FastAPI, SQLAlchemy, Alembic, Pydantic.
- **Jobs:** Celery, Redis.
- **Database:** PostgreSQL.
- **AI/content:** NewsAPI, OpenAI summaries, OpenAI embeddings, deterministic fallback summaries.
- **Testing:** Pytest backend contracts, ranking tests, feed edition tests, summarizer tests, frontend TypeScript/lint checks.

## Repository Layout

```text
backend/    FastAPI API, database models, Celery tasks, ranking, summarization
frontend/   Expo mobile reader app
dashboard/  React admin dashboard
docs/       Extra technical notes and README assets
```

## Local Setup

Clone the repo and create env files:

```bash
cp backend/.env.example backend/.env
cp dashboard/.env.example dashboard/.env
cp frontend/.env.example frontend/.env
```

Fill `backend/.env` with local secrets. At minimum:

```bash
SECRET_KEY="dev-change-me"
NEWS_API_KEY="your_newsapi_key"
ADMIN_EMAILS="admin@example.com"
ADMIN_BOOTSTRAP_EMAIL="admin@example.com"
ADMIN_BOOTSTRAP_PASSWORD="ChangeMe123"
ENABLE_PUBLIC_SIGNUP="false"
```

The bootstrap admin user is created or updated when the backend starts.

## Run The Backend

```bash
cd backend
docker compose up --build -d
docker compose exec web alembic upgrade head
docker compose exec web python app/db/scripts/initial_data.py
```

Useful local API URLs:

- API health: `http://localhost:8000/health`
- API docs: `http://localhost:8000/docs`

## Run The Dashboard

Set `dashboard/.env`:

```bash
VITE_API_BASE_URL="http://localhost:8000"
```

Then start it:

```bash
npm --prefix dashboard install
npm --prefix dashboard run dev
```

Sign in with the bootstrap admin email/password. Use Control -> Beta User to
create tester accounts. Public signup is disabled by default.

## Run The Mobile App

Set `frontend/.env`:

```bash
EXPO_PUBLIC_API_BASE_URL="http://localhost:8000"
```

Then start Expo:

```bash
npm --prefix frontend install
npm --prefix frontend run start
```

For a physical-phone beta, build with `EXPO_PUBLIC_API_BASE_URL` pointing to a
deployed HTTPS backend or a stable tunnel.

## Testing

Backend:

```bash
cd backend
env PYTHONPATH=. ./.venv/bin/pytest
```

Frontend:

```bash
cd frontend
npm run lint
npx tsc --noEmit
```

Dashboard:

```bash
cd dashboard
npm run build
```

Note: Vite expects Node 20.19+ for dashboard builds.

## Notes

- This project is still under development. It currently uses NewsAPI for article discovery; the next version is intended to use a larger daily corpus from source APIs and permitted web crawling/scraping.
