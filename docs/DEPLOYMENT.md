# Deployment

## Minimal Beta Topology

- **Backend API**: FastAPI service.
- **Postgres**: managed database.
- **Redis**: managed Redis or provider add-on.
- **Celery worker**: background ingestion, summarization, embedding, and feed generation.
- **Celery beat**: optional. For controlled beta, manual dashboard runs are safer.
- **Admin dashboard**: Vite static app or private web service pointing at the backend.
- **Expo/EAS app**: internal build using the deployed API URL.

Recommended providers: Render, Railway, Fly.io, or a VPS. Render/Railway are usually fastest for a recruiter-friendly beta because they can provision web services, Postgres, Redis, workers, and environment variables from one UI.

## Production Environment Variables

Backend:

```bash
DATABASE_URL="postgresql://..."
SECRET_KEY="long-random-secret"
NEWS_API_KEY="set-in-provider-secret-store"
NEWS_API_BASE_URL="https://newsapi.org/v2"
NEWS_API_COUNTRY="us"
NEWS_API_COUNTRIES="us,in"
NEWS_API_PAGE_SIZE="100"
NEWS_DAILY_ARTICLE_TARGET="250"
ARTICLE_POOL_LIMIT="1000"
NEWS_BATCH_CATEGORIES="business,technology,health,sports,entertainment,science,general"
ARTICLE_MAX_AGE_HOURS="168"
MIN_ARTICLE_TEXT_LENGTH="60"
FEED_SIZE="100"
FEED_EXPLORATION_RATIO="0.25"
MAX_FEED_ITEMS="500"
OPENAI_API_KEY="set-in-provider-secret-store"
OPENAI_MODEL="gpt-4.1-mini"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
OPENAI_DAILY_SUMMARY_LIMIT="250"
GOOGLE_CLIENT_IDS=""
ADMIN_EMAILS="admin@example.com"
REDIS_URL="redis://..."
BACKEND_CORS_ORIGINS="https://your-dashboard.example.com,https://your-api.example.com"
```

Dashboard:

```bash
VITE_API_BASE_URL="https://your-api.example.com"
```

Expo:

```bash
EXPO_PUBLIC_API_BASE_URL="https://your-api.example.com"
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=""
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=""
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=""
```

## Service Commands

Backend web:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Celery worker:

```bash
celery -A app.core.celery_app.celery_app worker --loglevel=info
```

Celery beat, only if using scheduled runs:

```bash
celery -A app.core.celery_app.celery_app beat --loglevel=info
```

Dashboard build:

```bash
npm install
npm run build
```

## Post-Deploy Commands

Run these from the backend service shell:

```bash
alembic upgrade head
python app/db/scripts/initial_data.py
```

Create an admin user:

```bash
curl -X POST https://YOUR_API_HOST/api/users/ \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"replace-this"}'
```

Then sign into the dashboard and run:

1. `Ingest`
2. `Summarize`
3. `Generate feeds`

Use `Full pipeline` only when you are ready to spend quota.

## Health Checks And Logs

Health check:

```bash
curl https://YOUR_API_HOST/docs
```

Useful log checks:

- Backend web logs for auth/API errors.
- Worker logs for NewsAPI/OpenAI failures.
- Dashboard browser console for CORS/API URL mistakes.
- Provider database metrics for connection pressure.

## Deployment Risks

- `BACKEND_CORS_ORIGINS="*"` is convenient locally but should be restricted for production.
- Admin dashboard should not be publicly discoverable without backend admin auth.
- Keep the NewsAPI beta private unless your plan allows the use case.
- Set OpenAI budget alerts before sharing the app.
