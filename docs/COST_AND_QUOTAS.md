# Cost And Quotas

## Defaults

The beta defaults bound external work:

- `NEWS_API_PAGE_SIZE=100`
- `NEWS_DAILY_ARTICLE_TARGET=250`
- `ARTICLE_POOL_LIMIT=1000`
- `FEED_SIZE=100`
- `MAX_FEED_ITEMS=500`
- `OPENAI_DAILY_SUMMARY_LIMIT=250`

With `NEWS_API_COUNTRIES="us,in"` and seven default categories, a single ingestion pass plans 14 NewsAPI top-headline requests.

## NewsAPI Strategy

- Keep beta private and small if using the Developer plan.
- Prefer manual dashboard ingestion over automated frequent scheduling.
- Use dashboard `NewsAPI planned`, `NewsAPI page size`, and `Daily target` before running ingestion.
- Avoid repeated `Full pipeline` clicks in the same test session unless content truly needs refresh.

## OpenAI Strategy

- `OPENAI_DAILY_SUMMARY_LIMIT` caps each admin summarization run.
- If `OPENAI_API_KEY` is unset, the backend falls back to deterministic extractive summaries for local development.
- Set OpenAI project budget alerts before inviting testers.
- Watch failed summaries; repeated failures can waste operator time and may indicate bad article text or transient provider issues.

## Recommended Beta Cadence

Small private beta:

- Run ingestion once before a testing session.
- Summarize up to 250 pending articles.
- Generate feeds for all users.
- Do not run beat until the deployment has stable monitoring.

Recruiter demo:

- Generate content before the demo.
- Avoid live external API calls during the demo.
- Show the dashboard metrics and pipeline history instead of spending quota live.

## Operator Checklist

Before running `Full pipeline`:

1. Confirm remaining NewsAPI requests.
2. Confirm OpenAI budget and daily summary limit.
3. Check pending summaries.
4. Confirm you need fresh article ingestion.
5. Prefer separate `Ingest`, `Summarize`, and `Generate feeds` actions if you want tighter control.
