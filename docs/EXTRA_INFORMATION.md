# Extra Information

This file keeps useful technical and operating notes that are too detailed for
the root README.

## Operating Model

The mobile app does not call NewsAPI or OpenAI directly. Expensive work stays on
the backend and is run by an operator from the dashboard or by Celery schedules.

Recommended beta flow:

1. Run ingestion when fresh content is needed.
2. Summarize pending articles.
3. Inspect content coverage in the dashboard.
4. Create tester accounts from Control -> Beta User.
5. Have testers read, save, like, skip, and open stories.
6. Review interaction and feed quality in the dashboard.

Public signup is disabled by default. The first admin is bootstrapped with
`ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD`; admin access is granted
only when the email is listed in `ADMIN_EMAILS`.

## Feed And Ranking Details

Feeds are persisted as `flashcards` so a reader sees a stable edition instead of
a reshuffled list on every app open. Viewed cards are preserved during refreshes,
and unread cards can be reranked when preferences change.

Ranking is intentionally interpretable:

- Explicit interests seed country and category matching.
- Country interests act like market preferences.
- Category interests are strongest inside selected markets, but global category
  matches can still appear.
- Interactions update category, keyword, and embedding preferences.
- A small exploration slice prevents feeds from becoming too narrow.
- Ranking reasons are stored so the dashboard can explain why a card appeared.

Collected signals:

- `view`: card became visible.
- `like`: explicit positive feedback.
- `skip`: explicit negative feedback.
- `save`: bookmark/save action.
- `click`: original article opened.
- `dwell_time_seconds`: approximate time on card before an action.

## Quotas And Cost Controls

Default beta settings are intentionally bounded:

- `NEWS_API_PAGE_SIZE=100`
- `NEWS_DAILY_ARTICLE_TARGET=250`
- `ARTICLE_POOL_LIMIT=1000`
- `FEED_EDITION_SIZE=100`
- `MAX_FEED_ITEMS=500`
- `OPENAI_DAILY_SUMMARY_LIMIT=250`

With `NEWS_API_COUNTRIES="us,in"` and seven categories, one ingestion pass plans
14 NewsAPI requests. For demos, generate content before the session and avoid
live external API calls unless fresh content is necessary.

If `OPENAI_API_KEY` is unset, summaries fall back to deterministic extractive
summaries so local development still works.

## Deployment Notes

Minimal beta topology:

- FastAPI backend service.
- Postgres database.
- Redis instance.
- Celery worker for ingestion, summarization, embeddings, and feed work.
- Optional Celery beat for scheduled runs.
- Vite dashboard pointed at the backend.
- Expo/EAS mobile build pointed at the deployed backend URL.

Production environment values should be stored in the host/provider secret
store, not committed. Restrict `BACKEND_CORS_ORIGINS` for deployed use, keep the
dashboard private, and set OpenAI budget alerts before inviting testers.

Useful service commands:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
celery -A app.core.celery_app.celery_app worker --loglevel=info
celery -A app.core.celery_app.celery_app beat --loglevel=info
```

## Future Improvements

- Add real product screenshots and a short demo recording.
- Replace the default Expo app icon/splash with final branding.
- Add EAS internal distribution or TestFlight setup.
- Add an admin-only export for interaction analysis.
- Tune ranking weights after collecting beta interaction data.
