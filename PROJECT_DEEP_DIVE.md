# Project Deep Dive

This document is the long-form technical handoff for the news flashcard app. It
is meant to explain how the project works end to end: what each major file does,
how data moves through the system, why the current design choices were made, and
what tradeoffs or future improvements are still open.

The project is a personalized mobile news reader. The backend ingests articles
from NewsAPI, normalizes and deduplicates them, summarizes them with OpenAI,
embeds summaries, ranks articles per user, and persists a dated ranked feed. The
frontend is an Expo app with a swipeable flashcard feed and a Profile screen for
account setup, interest selection, saved stories, and manual feed generation.

## Current Architecture

The project has two main applications:

- `backend/`: FastAPI + SQLAlchemy + Postgres + Redis + Celery.
- `frontend/`: Expo Router + React Native + Expo Image.

Runtime services are defined in [backend/docker-compose.yml](backend/docker-compose.yml):

- `db`: Postgres 16. Stores users, articles, summaries, flashcards,
  interactions, and learned preference state.
- `redis`: Broker and result backend for Celery.
- `web`: FastAPI server exposed on host port `8000`.
- `worker`: Celery worker that executes ingestion, summarization, embedding, and
  feed-generation tasks.
- `beat`: Celery Beat scheduler that queues the daily news pipeline.

The user-facing app talks only to the FastAPI server. It does not call NewsAPI or
OpenAI directly. That keeps API keys and expensive operations on the backend.

## Key Runtime Settings

The backend settings are declared in
[backend/app/core/config.py](backend/app/core/config.py). Settings load from
environment variables and `.env` through `pydantic-settings`.

Important values:

```env
DATABASE_URL="postgresql://newsuser:newspass@db:5432/newsdb"
NEWS_API_BASE_URL="https://newsapi.org/v2"
NEWS_API_COUNTRY="us"
NEWS_API_PAGE_SIZE="100"
NEWS_DAILY_ARTICLE_TARGET="250"
ARTICLE_POOL_LIMIT="500"
NEWS_BATCH_CATEGORIES="business,technology,health,sports,entertainment,science,general"
ARTICLE_MAX_AGE_HOURS="168"
MIN_ARTICLE_TEXT_LENGTH="60"
FEED_SIZE="12"
FEED_EXPLORATION_RATIO="0.25"
MAX_FEED_ITEMS="500"
MORNING_FEED_HOUR="7"
MORNING_FEED_MINUTE="0"
OPENAI_MODEL="gpt-5.4-mini-2026-03-17"
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
REDIS_URL="redis://redis:6379/0"
```

Do not commit real `.env` secrets. [backend/.env.example](backend/.env.example)
documents non-secret expected settings.

Important operational point: Docker Compose reads `.env` into containers when the
container is created. If `.env` changes, `docker compose restart` is not enough.
Use:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
docker compose up -d --force-recreate web worker beat
```

## Why The Article Pool Is Global

Articles are stored once in the `articles` table. Users do not get private copies
of article text. Per-user personalization is represented by small rows:

- `flashcards`: user-specific daily ranking/order.
- `user_article_interactions`: likes, dislikes, saves, clicks, views.
- `user_category_preferences`: learned category scores.
- `user_keyword_preferences`: learned keyword scores.
- `user_embedding_profiles`: averaged embedding vector of positively engaged
  articles.
- `user_interests`: explicit interest choices.

This is the right structure because the heavy data is article text, summaries,
and embeddings. Ranking rows are cheap. For a projected 20-user demo:

- 500 global articles.
- Up to 20 x 500 = 10,000 flashcard rows per feed date.
- Preference rows and interactions are comparatively small.

Storage is not the limiting factor at this scale. The practical performance
risks are:

- Pulling too many image-heavy cards over the network into the phone at once.
- Slow image decode/cache misses while swiping.
- Background summarization cost and latency.

## Database Model

All SQLAlchemy models live in [backend/app/db/model.py](backend/app/db/model.py).

### Enums

`SourceType`:

- `NEWS`: currently used for news interests.
- `WIKI`: reserved from earlier project shape.

`SummaryStatus`:

- `PENDING`: article exists but has not been summarized.
- `COMPLETED`: article has a summary.
- `FAILED`: summarization failed for this article.

`InteractionType`:

- `VIEW`: article was viewed.
- `SKIP`: dislike/negative feedback.
- `CLICK`: opened original article.
- `LIKE`: positive feedback.
- `SAVE`: bookmark/save action.

### User

`User` stores:

- `id`
- `email`
- `hashed_password`
- `created_at`

Relationships:

- `interests`
- `category_preferences`
- `keyword_preferences`
- `interactions`
- `flashcards`
- `embedding_profile`

Decision: email/password auth is intentionally simple for this prototype.
Security uses hashed passwords and JWT access tokens, but there is no production
OAuth/session management yet.

### Interest and UserInterest

`Interest` stores available topics such as business, technology, health, etc.
`UserInterest` is a join table with composite key `(user_id, interest_id)`.

Explicit interests are not the whole recommender. They seed and stabilize
preferences, while interactions adjust preferences over time.

### Article

`Article` is the global article table. Important fields:

- `title`
- `normalized_title`
- `original_url`
- `source`
- `description`
- `content`
- `raw_text`
- `cleaned_text`
- `published_at`
- `primary_category`
- `image_url`
- `keywords`
- `embedding`
- `story_key`
- `summary_status`
- `fetched_at`
- `processed_at`

Decision: `original_url` is unique because URL-level duplicates are common.
`story_key` is a fuzzy story identity derived from normalized title tokens. It
helps group near-duplicate headlines from different sources.

Images are not downloaded into Postgres. Only `image_url` is stored. Expo Image
handles device-side cache.

### Summary

`Summary` is one-to-one with `Article` through unique `article_id`.

Fields:

- `main_takeaway`: the one-paragraph summary shown on the card.
- `supporting_lines`: retained for schema compatibility, but currently always
  empty because the UI should not show bullets.
- `summary_text`: searchable/full summary text, currently same as takeaway.
- `model_name`: model or fallback source used.
- `created_at`

Decision: summaries are stored separately from articles so articles can exist in
`PENDING` state and be summarized/reprocessed independently.

### Flashcard

`Flashcard` is the per-user feed row. It stores:

- `user_id`
- `article_id`
- `summary_id`
- `feed_date`
- `rank_position`
- `ranking_score`
- `ranking_reason`
- `delivered_at`
- `is_viewed`

Unique constraint:

```text
uq_feed_article = (user_id, feed_date, article_id)
```

This prevents duplicate cards for the same user/date/article. Earlier pipeline
runs hit duplicate-key errors because feed generation reinserted cards without
deleting existing rows. The current implementation deletes a user/date feed
first when `force_refresh=True`.

### UserArticleInteraction

Stores engagement events:

- article opened
- article liked
- article disliked/skipped
- article saved
- view events, if added

The UI now lets reaction buttons toggle. Adding a reaction calls `POST
/api/users/me/interactions`; toggling it off calls `DELETE
/api/users/me/interactions` with `article_id` and `interaction_type`.

Decision: interactions are currently event-like rows rather than a single
canonical per-user article state. The delete endpoint removes matching events to
support UI undo. A future production version could use an aggregate
`user_article_states` table for simpler toggles and analytics.

### UserCategoryPreference

Stores learned category preference scores per user. Explicit interests seed
scores to at least `2.5`. Interactions update scores with decayed deltas.

### UserKeywordPreference

Stores learned keyword scores per user. Keywords are extracted from article
text. Interactions adjust keyword scores so the ranking system can learn more
fine-grained preferences than broad categories.

### UserEmbeddingProfile

Stores an averaged embedding vector of recently positive interactions. It is
used for semantic similarity in ranking.

Decision: this is a lightweight personalization feature that is easy to explain
in demos. It gives the project a real ML-ish component without needing a trained
custom model yet.

## Backend API Structure

FastAPI app creation is in [backend/app/main.py](backend/app/main.py).

Routers:

- [backend/app/api/endpoints/login.py](backend/app/api/endpoints/login.py)
- [backend/app/api/endpoints/users.py](backend/app/api/endpoints/users.py)
- [backend/app/api/endpoints/interests.py](backend/app/api/endpoints/interests.py)
- [backend/app/api/endpoints/news.py](backend/app/api/endpoints/news.py)
- [backend/app/api/endpoints/dev.py](backend/app/api/endpoints/dev.py)

CORS is configured from `settings.cors_origins`, currently allowing `*` unless
overridden.

### Auth Dependencies

[backend/app/api/dependencies.py](backend/app/api/dependencies.py) provides:

- `get_db()`: request-scoped SQLAlchemy session.
- `get_current_user()`: decodes JWT bearer token and loads the current user.

The token URL is `/api/login/access-token`.

### Login

[backend/app/api/endpoints/login.py](backend/app/api/endpoints/login.py)
implements:

```http
POST /api/login/access-token
```

The frontend sends `application/x-www-form-urlencoded` fields:

- `username`: email
- `password`

If valid, backend returns:

```json
{
  "access_token": "...",
  "token_type": "bearer"
}
```

### Users

[backend/app/api/endpoints/users.py](backend/app/api/endpoints/users.py)
implements:

```http
POST /api/users/
GET /api/users/me
GET /api/users/me/interests
```

`POST /api/users/` creates a user unless the email already exists. Existing email
returns a 400 with `"Email already registered"`. The frontend uses this to tell
the user to log in instead of silently advancing.

`GET /api/users/me/interests` is critical for one-time onboarding. Returning
users should not be forced to select interests again. The frontend uses this
endpoint to preselect chips and route returning users directly to Profile.

### Interests

[backend/app/api/endpoints/interests.py](backend/app/api/endpoints/interests.py)
implements:

```http
GET /api/interests/
POST /api/users/me/interests
```

`GET /api/interests/` returns available topics.

`POST /api/users/me/interests` replaces the current user's explicit interests.
After saving, it calls `sync_explicit_interests()` in
[backend/app/services/user_profile.py](backend/app/services/user_profile.py).
That function:

- Raises selected category preference scores to at least `2.5`.
- Decays unselected existing category preference scores by multiplying by `0.6`.

Decision: interest selection is a strong initial signal, not a permanent hard
filter. The system can still learn from behavior.

### News and Feed Endpoints

[backend/app/api/endpoints/news.py](backend/app/api/endpoints/news.py)
contains both task triggers and user feed endpoints.

Task endpoints:

```http
POST /api/tasks/fetch-news
POST /api/tasks/summarize-news?limit=100&force_refresh=false
POST /api/tasks/generate-feeds?force_refresh=true&summarize_first=true
POST /api/tasks/daily-pipeline
POST /api/tasks/backfill-interest-news
POST /api/tasks/reprocess-articles
POST /api/tasks/embed-articles?limit=200
```

User endpoints:

```http
GET /api/users/me/feed
GET /api/users/me/feed?force_refresh=true
GET /api/users/me/saved-articles
POST /api/users/me/interactions
DELETE /api/users/me/interactions?article_id=...&interaction_type=...
```

Important behavior:

- `GET /api/users/me/feed` calls `build_today_feed()`. If today's feed already
  exists and `force_refresh=false`, it returns existing persisted rows. If no
  feed exists or `force_refresh=true`, it ranks and persists a new feed.
- `POST /api/tasks/generate-feeds` defaults `summarize_first=true`. This was
  added because manually queueing summarization and feed generation at the same
  time caused a race: Celery could generate feeds before summarization finished.
- `POST /api/tasks/daily-pipeline` is still the preferred full refresh because
  it runs fetch, summarize, and feed generation sequentially in one task.

### Dev Endpoint

[backend/app/api/endpoints/dev.py](backend/app/api/endpoints/dev.py) contains:

- `POST /api/dev/smoke`
- `POST /api/dev/demo-feed`

The demo feed seeds local demo articles. It is useful when the real API or
OpenAI pipeline is unavailable, but it is not the intended production path.

The frontend no longer exposes the demo/debug controls as user-facing UI.

## News Ingestion

The ingestion client is [backend/app/services/news.py](backend/app/services/news.py).

`NewsApiService`:

- Reads `NEWS_API_KEY`, `NEWS_API_BASE_URL`, `NEWS_API_COUNTRY`, and
  `NEWS_API_PAGE_SIZE`.
- Clamps `page_size` between 1 and 100 because NewsAPI Top Headlines maxes out
  at 100 articles per request.
- Calls `/top-headlines`.
- Normalizes the API response into dictionaries with:
  - title
  - source
  - url
  - published_at
  - description
  - content
  - image_url

`newsapi_client.py` simply aliases `NewsApiClient` to `NewsApiService`; it exists
for compatibility with earlier naming.

### NewsAPI Free Tier Strategy

The app uses the NewsAPI Developer/free constraints conservatively:

- `NEWS_API_PAGE_SIZE=100`.
- 7 categories: business, technology, health, sports, entertainment, science,
  general.
- About 7 requests per daily pipeline run.
- `NEWS_DAILY_ARTICLE_TARGET=250` limits inserted new valid articles per run.

This stays well under 100 requests/day as long as daily scheduled runs plus
manual tests are controlled.

NewsAPI free/dev plans may return delayed articles. That is why
`ARTICLE_MAX_AGE_HOURS=168` rather than the earlier 30-hour window. With a
30-hour window, too few cards were eligible.

## Article Normalization and Deduplication

Article processing helpers are in
[backend/app/services/article_pipeline.py](backend/app/services/article_pipeline.py).

### Text Cleaning

`clean_text(value)`:

- Handles `None`.
- Removes bracketed fragments like `[+123 chars]`.
- Collapses whitespace.

`build_raw_text(title, description, content)`:

- Cleans each part.
- Joins non-empty parts with newlines.

### Title Normalization

`normalize_title(title)`:

- Lowercases.
- Removes non-alphanumeric characters.
- Collapses whitespace.

This makes duplicate detection less sensitive to punctuation and casing.

### Keyword Extraction

`extract_keywords(text, max_keywords=8)`:

- Tokenizes alphabetic-ish words of length at least 3.
- Drops common stopwords.
- Counts frequency.
- Sorts by frequency, then alphabetically.
- Returns up to 8 keywords.

Decision: this is intentionally simple and explainable. It is enough to support
basic keyword-level personalization without a heavy NLP dependency.

### Category Enrichment

`CATEGORY_KEYWORDS` maps broad categories to indicative keywords. `_category_scores`
scores title/body matches. `enrich_category()` starts from the NewsAPI category
but can override it if the content strongly matches another category.

Decision: NewsAPI categories are useful but imperfect. This local enrichment
helps avoid obviously wrong category placement without needing a classifier.

### Story Key

`build_story_key(normalized_title)`:

- Removes stopwords.
- Takes first 10 important tokens.
- Hashes them with SHA-1.
- Uses first 16 hex characters.

This groups near-identical titles without storing long normalized keys.

### Validation

`is_valid_article(raw_article)` requires:

- Non-empty title.
- Non-empty URL.
- Raw text length >= `MIN_ARTICLE_TEXT_LENGTH`.
- `published_at` within `ARTICLE_MAX_AGE_HOURS`.

### Duplicate Detection

`is_duplicate_article(db, article)`:

1. Checks exact URL match.
2. Checks existing articles with the same `story_key`.
3. Uses `SequenceMatcher` on normalized titles.
4. Treats ratio >= `0.9` as duplicate.

Decision: URL dedupe alone is not enough because the same story can appear under
different URLs or tracking query strings.

### Upsert

`upsert_article()` inserts a new `Article` with `summary_status=PENDING` unless
the URL already exists.

## Background Tasks

All Celery tasks live in
[backend/app/tasks/news_fetching.py](backend/app/tasks/news_fetching.py).

Celery configuration lives in
[backend/app/core/celery_app.py](backend/app/core/celery_app.py).

### Daily Schedule

Celery Beat queues:

```text
task: app.tasks.news_fetching.run_daily_pipeline_task
time: MORNING_FEED_HOUR:MORNING_FEED_MINUTE
timezone: America/New_York
```

The default is 7:00 AM New York time.

### `_async_ingest_news(db)`

Flow:

1. Instantiate `NewsApiService`.
2. Parse configured categories.
3. For each category:
   - Fetch top headlines.
   - Count fetched raw articles.
   - Validate article.
   - Normalize article.
   - Skip duplicates.
   - Insert valid new article.
   - Stop once `NEWS_DAILY_ARTICLE_TARGET` inserted.
4. Commit after each category.
5. Prune the article pool.
6. Return fetched/inserted/target/pruned counts.

### `_prune_article_pool(db)`

Keeps the global article table bounded:

- Reads `ARTICLE_POOL_LIMIT`, currently 500.
- Finds articles with `SAVE` interactions and protects them.
- Orders unsaved articles by:
  - newest `published_at`
  - newest `fetched_at`
  - newest ID
- Deletes unsaved articles beyond the pool limit.
- Deletes dependent flashcards, interactions, and summaries before deleting
  articles.

Decision: this keeps the project from growing forever while preserving user
saved stories. It also keeps ranking fast for the expected 20-user demo scale.

### `_async_summarize_articles(db, limit=100, force_refresh=False)`

Flow:

1. Query articles:
   - If `force_refresh=false`, only `PENDING`.
   - If true, any article.
   - Most recent first.
   - Limit defaults to 100.
2. For each article:
   - Generate summary with `ArticleSummarizer`.
   - Insert or update `Summary`.
   - Mark article `COMPLETED`.
   - Try to embed summary text with `EmbeddingService`.
   - Commit per article.
3. On exception:
   - Mark article `FAILED`.
   - Continue.

Decision: commit-per-article is not the fastest path, but it is robust for long
OpenAI jobs. A single failed article does not lose all previous work.

### `_build_user_feed(db, user, feed_date, force_refresh=False)`

Flow:

- If feed exists and not force refresh, return existing count.
- If force refresh:
  - Delete existing `Flashcard` rows for user/date.
- Rank articles for user.
- Persist flashcards.
- Commit.

Decision: deleting on force refresh avoids duplicate-key conflicts on
`uq_feed_article`.

### `generate_morning_feeds_task(...)`

Parameters:

- `feed_date_iso`
- `force_refresh`
- `summarize_first`
- `summary_limit`

Important implementation detail: it loads users with `selectinload()` for
collections. This was changed from heavy `joinedload()` because joined-loading
multiple collections can create a row explosion and previously caused the worker
to be killed with `SIGKILL`.

### `run_daily_pipeline_task()`

Sequentially runs:

1. `fetch_news_task()`
2. `summarize_articles_task()`
3. `generate_morning_feeds_task(force_refresh=True, summarize_first=False)`

This task is the safest full refresh because it prevents the race where feed
generation starts before summarization completes.

### Other Tasks

`backfill_interest_based_news_task()`:

- Fetches articles based on each user's explicit news interests.
- Useful for seeding more interest-specific data.

`reprocess_articles_task()`:

- Recalculates normalized text, keywords, story keys, and enriched categories.

`embed_articles_task(limit=200)`:

- Embeds articles that do not yet have embeddings.

## Summarization

Summarization is implemented in
[backend/app/services/summarizer.py](backend/app/services/summarizer.py).

### Prompt Goal

The prompt targets an Inshorts-style mobile summary:

- One paragraph.
- No bullets.
- No markdown.
- No labels.
- 260 to 420 characters.
- 2 to 4 short sentences.
- Ends with a complete sentence.
- Lead with the actual news.
- Avoid repeating the headline verbatim.
- Avoid filler like "this article discusses".

The response is requested as JSON schema with:

```json
{
  "main_takeaway": "string",
  "supporting_lines": []
}
```

`supporting_lines` is intentionally empty because the UI should not show bullets.

### OpenAI Call

The service calls:

```text
POST https://api.openai.com/v1/responses
```

using `OPENAI_MODEL`.

The first 6000 characters of article text are included in the prompt.

### Retry Strategy

`TRANSIENT_OPENAI_STATUSES`:

```python
{408, 409, 429, 500, 502, 503, 504}
```

OpenAI calls retry up to 4 attempts with exponential-ish backoff and jitter. This
was added because logs showed occasional `503 Service Unavailable` responses.

Non-transient errors such as bad auth/model raise immediately and fall back.

### Fallback Summary

If OpenAI is unavailable or no key exists:

- Extract sentences from title/description/content.
- Remove useless fragments like `[removed]` and "read more".
- Avoid exact headline duplication.
- Shape into one paragraph.
- Mark model as `fallback-extractive`.

Decision: fallback keeps the app working in demos, but real summaries are much
better with OpenAI.

### Paragraph Shaping

`_fit_paragraph()`:

- Collapses whitespace.
- Keeps text if under 420 chars and sentence-complete.
- Otherwise takes complete sentences until max length.
- Otherwise clips by words and appends a period.

`_split_sentences()` protects abbreviations like `D.C.`, `U.S.`, and `U.K.` so
summaries do not become fragments like "After D."

## Embeddings

Embedding logic is in [backend/app/services/embeddings.py](backend/app/services/embeddings.py).

`EmbeddingService.embed_text()`:

- Returns `None` if no API key or no text.
- Calls OpenAI embeddings with `OPENAI_EMBEDDING_MODEL`.
- Truncates input to 8000 characters.
- Returns a list of floats.

Helper functions:

- `cosine_similarity(left, right)`: returns 0 if vectors missing or dimensions
  mismatch.
- `average_embeddings(vectors)`: averages same-dimensional vectors.

Embeddings are used in two ways:

1. Article summary embeddings are stored on `Article.embedding`.
2. User positive-interaction embeddings are averaged into
   `UserEmbeddingProfile.embedding`.

## Personalization

Personalization is split between:

- Explicit interest sync:
  [backend/app/services/user_profile.py](backend/app/services/user_profile.py)
- Feed ranking:
  [backend/app/services/recommendations.py](backend/app/services/recommendations.py)

### Interaction Logging

`log_interaction()`:

1. Inserts `UserArticleInteraction`.
2. Calls `_update_preferences()`.
3. Marks flashcard `is_viewed=True` for positive/view/click/save actions.
4. Refreshes user embedding profile.
5. Flushes.

Base deltas:

```python
VIEW: 0.2
CLICK: 0.8
LIKE: 1.4
SAVE: 1.8
SKIP: -1.0
```

Dwell time adjustment:

- >= 20 seconds: `+0.8`
- <= 3 seconds: `-0.6`

Decision: this makes longer reading a positive signal and quick dismissals a
negative signal.

### Category Preference Update

Category score update:

```python
new_score = old_score * 0.85 + delta
```

The `0.85` decay keeps recent interactions more important than old ones.

### Keyword Preference Update

For up to 8 article keywords:

```python
new_score = old_score * 0.9 + delta / 2
```

Keyword updates are smaller than category updates because keywords can be noisy.

### Embedding Profile Update

The service looks at up to 50 most recent interactions and averages embeddings
for positive interaction types:

- `CLICK`
- `LIKE`
- `SAVE`

The average becomes the user's semantic profile vector.

## Ranking Algorithm

Ranking is in [backend/app/services/recommendations.py](backend/app/services/recommendations.py).

The ranking process has two stages:

1. Compute a base personalized score for candidate articles.
2. Rerank with constraints for diversity, explicit interests, source/category
   balance, and interacted-story ordering.

### Candidate Retrieval

Candidates:

- `Article.summary_status == COMPLETED`
- `Article.published_at >= now - ARTICLE_MAX_AGE_HOURS`
- Sorted newest first.
- Limited to `MAX_FEED_ITEMS`.

Current values:

- `ARTICLE_MAX_AGE_HOURS=168`
- `MAX_FEED_ITEMS=500`

### Explicit Interest Signals

`get_explicit_interest_names(user)` returns selected interests in lowercase.

If article category is explicitly selected:

```python
explicit_score = 2.5
```

If article keywords overlap tokens from explicit interests:

```python
explicit_keyword_score += 0.35 per matching keyword
```

### Learned Preference Signals

`category_scores` comes from `UserCategoryPreference`.

`keyword_scores` includes only positive keyword scores.

`negative_keywords` includes negative keyword scores.

Negative penalty is capped:

- `1.0` for explicit-interest categories.
- `2.0` otherwise.

Decision: early testing showed a few dislikes could create overly strong
negative keyword scores for generic words. The cap prevents the feed from
collapsing after a small number of swipes.

### Recency Signal

Recency score:

```python
1.75 - (recency_hours / ARTICLE_MAX_AGE_HOURS) * 1.75
```

It is clamped at minimum 0. Newer articles get a boost; older articles are still
eligible but naturally drift lower.

### Exploration Signal

If user has explicit interests and the article is outside those interests:

```python
exploration_bonus = 0.15
```

If user has no explicit interests:

```python
exploration_bonus = 0.4
```

Decision: the feed should not become a narrow filter bubble. Exploration is
small enough not to dominate explicit preferences.

### Interaction Signal

The ranking function builds sets of story keys from recent interactions:

- `interacted_story_keys`
- `positive_story_keys`
- `negative_story_keys`

Effects:

- Positive story key: `+0.8`
- Negative story key: `-1.2`
- Any prior interaction: extra `-2.25`

Additionally, reranking hard-prefers non-interacted articles while any remain.
This means refreshed feeds push already-seen/liked/disliked/saved articles down.

Decision: interacted articles should not disappear completely, because users may
go back or there may be limited available data. But they should be below unseen
cards to keep the feed fresh.

### Embedding Similarity

```python
embedding_similarity_score = cosine_similarity(user_embedding, article.embedding) * 1.5
```

If either vector is missing, similarity is 0.

### Base Score Formula

```python
score = (
    explicit_score
    + explicit_keyword_score
    + preference_score
    + keyword_score
    + recency_score
    + exploration_bonus
    + engagement_similarity
    + embedding_similarity_score
    - negative_penalty
)
```

Articles with non-positive scores can still be kept if they match explicit
category/keywords. Non-matching non-positive items are filtered out.

### Ranking Reason

Each item receives a `ranking_reason`:

- `interest-match`
- `keyword-match`
- `behavioral-similarity`
- `fresh-exploration`

These are stored for debugging/analysis, but the UI intentionally does not show
ranking scores or reasons to users.

### Diversity Reranking

`rerank_with_constraints()` starts with the base-ranked list and repeatedly
selects the best adjusted item.

Adjustments:

- Penalize repeated sources.
- Penalize repeated categories.
- Penalize three same-category items in a row.
- Boost explicit-interest stages.
- Limit early exploration based on `FEED_EXPLORATION_RATIO`.
- Penalize keyword overlap with recent selected items.
- Ensure early coverage of distinct explicit-interest categories.
- Hard-prefer non-interacted items while any remain.

`FEED_SIZE=12` is used as the "early feed" window for some diversity behavior.
`MAX_FEED_ITEMS=500` controls the maximum persisted feed length.

Decision: the first dozen cards should feel varied and personalized. Later cards
can be more exhaustive.

## Frontend Architecture

The Expo app is under `frontend/`.

Root layout:

- [frontend/app/_layout.tsx](frontend/app/_layout.tsx)

Tabs:

- [frontend/app/(tabs)/_layout.tsx](frontend/app/(tabs)/_layout.tsx)
- `Feed`: [frontend/app/(tabs)/index.tsx](frontend/app/(tabs)/index.tsx)
- `Profile`: [frontend/app/(tabs)/explore.tsx](frontend/app/(tabs)/explore.tsx)

Shared session state:

- [frontend/context/AppSessionContext.tsx](frontend/context/AppSessionContext.tsx)

Typed API client:

- [frontend/lib/api.ts](frontend/lib/api.ts)

### Session Context

`AppSessionProvider` stores:

- `apiBaseUrl`
- `accessToken`
- `userEmail`

`getDefaultApiBaseUrl()` derives the backend URL:

- Uses Expo `hostUri` when available.
- Android emulator fallback: `http://10.0.2.2:8000`.
- Otherwise `http://localhost:8000`.

Decision: earlier UI exposed backend IP input, but that was removed because users
should not see backend networking details. The app derives a sensible default.

Current limitation: session is in React state only. It is not persisted to
AsyncStorage/SecureStore, so closing/restarting the app loses login state. This
is acceptable for prototype iteration but should be improved later.

### API Client

[frontend/lib/api.ts](frontend/lib/api.ts) defines TypeScript types and request
helpers.

Important types:

- `Interest`
- `FeedItem`
- `SavedArticle`

`request<T>()`:

- Logs method/path.
- Throws detailed errors on non-2xx responses.
- Handles `204 No Content` for delete interaction.

API helpers:

- `createUser()`
- `login()`
- `fetchInterests()`
- `updateInterests()`
- `fetchMyInterests()`
- `fetchFeed()`
- `fetchSavedArticles()`
- `generateMyFeed()`
- `logInteraction()`
- `deleteInteraction()`
- `triggerFeedGeneration()`

Decision: logging requests in the frontend console helps debugging during mobile
development, especially when Expo Go does not make backend logs obvious.

## Feed Screen

Implemented in [frontend/app/(tabs)/index.tsx](frontend/app/(tabs)/index.tsx).

### High-Level Behavior

If not logged in:

- Shows setup prompt.
- Button routes to Profile.

If logged in:

- Loads feed with `fetchFeed(apiBaseUrl, accessToken, false)`.
- Shows a single stationary flashcard.
- User swipes:
  - left = next
  - right = previous
- At end, shows "You're all caught up".

Decision: left swipe advances like turning a page. Earlier direction felt
misleading, so it was changed.

### State

Important state:

- `feed`: array of `FeedItem`.
- `loading`: spinner state.
- `currentIndex`: current card index.
- `activeReactions`: local reaction toggle state per article ID.
- `cardOpenedAt`: timestamp used for dwell time.
- `swipe`: `Animated.ValueXY` controlling card translation.

### Feed Loading

`loadFeed(forceRefresh=false)`:

- Clears feed if no access token.
- Calls backend.
- Sets feed and resets `currentIndex`.
- Clears active reaction state.
- Resets dwell timer.

Reload button calls `loadFeed(true)`, which forces the backend to rebuild the
user's feed.

### Image Caching

The app uses `expo-image` instead of plain React Native `Image`.

Constants:

```ts
IMAGE_PREFETCH_BEHIND = 8
IMAGE_PREFETCH_AHEAD = 18
```

`warmImageUrls` computes a sliding cache window:

- 8 cards behind current card.
- 18 cards ahead of current card.

The screen warms this cache in two ways:

1. `Image.prefetch(warmImageUrls, 'memory-disk')`.
2. A hidden `preloadShelf` renders each nearby image at `1x1` with
   `cachePolicy="memory-disk"`.

The visible card image uses:

```tsx
cachePolicy="memory-disk"
priority="high"
recyclingKey={String(currentItem.article.id)}
transition={0}
```

Decision: users need to swipe quickly. Prefetching only the next two cards was
not enough; going backward still lagged. The current window warms both forward
and backward paths without rendering the entire feed.

Remaining performance tradeoff: fetching a very large feed still transfers many
article payloads at once. If lag persists, the next design should page feed
metadata from the backend while keeping image prefetch local.

### Swipe Mechanics

`PanResponder`:

- Starts when horizontal movement exceeds 12px and dominates vertical movement.
- Maps `gesture.dx` into `swipe.x`.
- On release:
  - `dx < -90`: fling left and advance.
  - `dx > 90`: fling right and go back.
  - otherwise spring back.

`flingCard(direction)`:

- Prevents moving right when already at index 0.
- Animates offscreen:
  - left: `x=-420`
  - right: `x=420`
- Updates `currentIndex` after animation.
- Calls `resetSwipe()`.

### Removed Swipe Badges

Earlier versions displayed `NEXT`/`PREV` badges over images. These were removed
because they appeared as weird blue/orange overlays and distracted from the news
card.

Current hint:

```text
Swipe left for next. Swipe right to go back.
```

### Reactions

Reaction buttons:

- 👍 = like
- 👎 = skip/dislike
- 🔖 = save

`toggleReaction(type)`:

1. Optimistically toggles local UI state.
2. If already active, calls `deleteInteraction()`.
3. If inactive, calls `logInteraction()`.
4. If backend fails, rolls local state back and alerts.

Active reaction styles:

- Like: green tint.
- Dislike: red tint.
- Save: orange tint.
- Slight scale increase.

Decision: immediate visual feedback is essential; users should know the tap
registered. The backend undo endpoint makes the toggle real, not just local.

### Opening Articles

Tapping headline:

- Logs a `CLICK` interaction.
- Opens original article URL with `Linking.openURL`.

The headline is the link; the card does not show a separate "Open" button.

## Profile Screen

Implemented in [frontend/app/(tabs)/explore.tsx](frontend/app/(tabs)/explore.tsx).

The file still uses the route name `explore` from the Expo starter template, but
the tab title is `Profile`.

### Steps

`Step` type:

- `account`
- `interests`
- `ready`

Behavior:

- If no `accessToken`, start at `account`.
- If there is an access token, start at `ready`.
- After login/create, call `fetchMyInterests()`.
- If saved interests exist:
  - set selected chips.
  - go to `ready`.
- If no saved interests:
  - go to `interests`.

Decision: interest selection should be one-time onboarding. Returning users
should not be forced to reselect interests every login.

### Account Creation and Login

`handleCreateUser()`:

- Requires email.
- Calls `createUser()`.
- On success, logs in automatically.
- If backend says "already registered", shows a message telling user to log in
  instead.

`handleLogin()`:

- Requires email.
- Calls `loginAndContinue()`.

`loginAndContinue()`:

- Calls backend login.
- Stores access token.
- Shows "loading your profile" status.

### Interest Management

`loadInterests()` fetches all available interests.

`toggleInterest(id)` toggles selected chip state.

`handleSaveInterests()`:

- Requires login.
- Requires at least one selected topic.
- Calls `updateInterests()`.
- Backend syncs explicit interest preferences.
- Moves to `ready`.

The Profile screen still allows interest changes after setup.

### Feed Generation

`handleGenerateFeed()`:

- Calls `generateMyFeed()`, which calls `GET /api/users/me/feed?force_refresh=true`.
- If returned items exist, route to Feed.
- If no items, tells user to run backend news pipeline.

Decision: Profile has a manual Generate Feed button for debugging and demos.
The daily Celery pipeline is still the intended recurring production path.

### Saved Articles

`loadSavedArticles()` calls `GET /api/users/me/saved-articles`.

Saved cards show:

- Title.
- Source or category.
- Pressing opens original URL.

Decision: saved articles belong in Profile, not on the feed card itself.

## Frontend Visual Direction

The UI shifted away from beige/cream into a modern newspaper-like palette:

- White card surfaces.
- Black/dark text.
- Blue primary accent `#1268ff`.
- Orange category accent `#f05a28`.
- Green success accent.

Design choices:

- No backend URL field in user UI.
- No debug logs in user UI.
- No ranking score/reason on cards.
- No time shown on cards; only article publication date.
- Headline remains bold and clickable.
- Summary is regular weight and smaller to fit more text.
- Cards are stationary except for swipe transition.

## Data Flow End To End

### Daily Pipeline

Recommended full backend refresh:

```bash
curl -X POST http://localhost:8000/api/tasks/daily-pipeline
docker compose logs -f worker
```

Detailed sequence:

1. `run_daily_pipeline_task()` starts.
2. `fetch_news_task()` calls `_async_ingest_news()`.
3. NewsAPI top headlines fetched by category.
4. Articles validated, normalized, deduped, inserted as `PENDING`.
5. Article pool pruned to `ARTICLE_POOL_LIMIT`, preserving saved articles.
6. `summarize_articles_task()` processes up to 100 pending/recent articles.
7. Each article summary is generated and embedded.
8. `generate_morning_feeds_task(force_refresh=True)` rebuilds feeds for all
   users.
9. Feed rows are stored in `flashcards`.

### User Opens App

1. Expo app starts.
2. `AppSessionProvider` derives backend URL.
3. If user has access token in memory, Feed loads.
4. Feed calls `GET /api/users/me/feed`.
5. Backend returns today's persisted `Flashcard` rows ordered by
   `rank_position`.
6. Frontend renders first card and warms nearby image cache.

### User Likes/Saves/Dislikes

1. User taps emoji.
2. UI toggles immediately.
3. Frontend calls `POST /api/users/me/interactions`.
4. Backend inserts interaction.
5. Backend updates category/keyword preferences.
6. Backend refreshes user embedding profile if positive interaction.
7. Future refreshed feeds use updated preferences.

If user taps same emoji again:

1. UI toggles off.
2. Frontend calls `DELETE /api/users/me/interactions`.
3. Backend deletes matching interaction rows.

Current limitation: deleting an interaction does not reverse already-updated
category/keyword preference scores. It removes the event for future interaction
sets, but the aggregate preference tables are not recalculated. For a prototype,
this is acceptable; for correctness, add a recalculation job or aggregate state
table later.

## Migrations

Alembic lives in `backend/alembic/`.

Known migration files:

- `b0b824e01c62_initial.py`
- `9c4f6d2b1a8e_embeddings_and_profiles.py`
- `7a2b8c0d1e4f_recommendation_pipeline.py`

[backend/alembic/env.py](backend/alembic/env.py) adjusts `sys.path` so Alembic
can import `app.db.model.Base`.

The `# noqa: E402` import marker exists because Alembic environment files often
need runtime path setup before importing application models.

## Tests and Quality Hooks

Backend focused contract tests:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
./.venv/bin/python -m pytest tests/test_frontend_contract.py -q
```

Compile check:

```bash
./.venv/bin/python -m compileall -q app scripts
```

Frontend:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/frontend
npm run lint
npx tsc --noEmit
```

Pre-commit:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news
pre-commit run --config backend/.pre-commit-config.yaml --all-files
```

The pre-commit config is in
[backend/.pre-commit-config.yaml](backend/.pre-commit-config.yaml). It runs:

- trailing whitespace
- end-of-file fixer
- yaml check
- large file check
- Black
- isort
- flake8
- mypy

Important note: the hook is configured from the repository git hook with:

```text
--config=backend/.pre-commit-config.yaml
```

So changes to root-level config files would not affect the current hook unless
the hook itself is reinstalled.

## Common Commands

Start backend:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
docker compose up -d
```

Tail worker logs:

```bash
docker compose logs -f worker
```

Recreate backend after `.env` changes:

```bash
docker compose up -d --force-recreate web worker beat
```

Run daily pipeline:

```bash
curl -X POST http://localhost:8000/api/tasks/daily-pipeline
```

Generate feeds from already-summarized articles:

```bash
curl -X POST 'http://localhost:8000/api/tasks/generate-feeds?force_refresh=true&summarize_first=false'
```

Summarize pending articles:

```bash
curl -X POST 'http://localhost:8000/api/tasks/summarize-news?limit=100'
```

Check OpenAI key:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/backend
docker compose exec web python scripts/check_openai_key.py
```

Run frontend:

```bash
cd /Users/ananyasrivastava/Desktop/Projects/news/frontend
nvm use 20.19.4
npx expo start -c
```

Expo SDK 54 expects a modern Node version. Use Node 20.19.x; Node 18 caused
tooling issues.

## Current Runtime State Observed Recently

After recreating containers with `MAX_FEED_ITEMS=500` and regenerating feeds,
the live backend reported:

```text
MAX_FEED_ITEMS 500
ARTICLE_POOL_LIMIT 500
```

Database counts observed:

```text
ananya@gmail.com                  124 feed items
business.tech@example.com         147 feed items
entertainment.science@example.com 147 feed items
sports.health@example.com         147 feed items

articles: 373
completed summaries: 237
```

The user's feed card count is not a hard cap. It is the number of currently
eligible summarized articles after ranking and filtering for that profile.

## Known Tradeoffs and Future Improvements

### Persist Mobile Session

Current session state is memory-only. Add SecureStore/AsyncStorage for:

- access token
- user email
- possibly API base URL

### Better Reaction Undo Semantics

Deleting interaction rows does not currently reverse preference deltas already
applied to `user_category_preferences` and `user_keyword_preferences`.

Better future design:

- Store canonical per-user article state.
- Recompute preferences periodically from interaction history.
- Or update preference scores with inverse deltas on delete.

### Feed Pagination

The frontend currently fetches the full feed array. With 500 max cards, this is
acceptable for a prototype but not ideal.

Future design:

- Backend endpoint supports `limit` and `offset` or cursor.
- Frontend fetches 30-50 card chunks.
- Image prefetch remains local around the current card.

### Faster Swiping

Current improvements:

- Expo Image memory/disk caching.
- 18-ahead and 8-behind prefetch window.
- Hidden 1x1 preload shelf.
- Disabled image fade transition.

If lag remains:

- Render previous/current/next cards simultaneously and animate between
  pre-mounted components.
- Avoid unmounting/remounting the entire card body on every index change.
- Use `react-native-reanimated`/gesture-handler for UI-thread gesture animation.
- Page feed data and prefetch images at the feed-data layer.

### Summary Quality Dataset

The current OpenAI prompt produces better one-paragraph summaries. For a more
impressive ML story:

1. Store generated summaries, source article text, model name, prompt version.
2. Add user/editor rating fields.
3. Add edited "ideal summary" field.
4. After collecting enough examples, build an evaluation set.
5. Try prompt A/B testing first.
6. Later, use supervised fine-tuning on edited summaries.
7. Consider DPO only after collecting preference pairs.

DPO is not the right first step because the project does not yet have reliable
preference pairs. Edited gold summaries are more useful initially.

### Production Concerns

Not production-ready yet:

- NewsAPI Developer/free plan is for development/testing, not production.
- No refresh tokens.
- No secure mobile token persistence.
- No rate limiting.
- No user deletion/export.
- No admin UI.
- No observability beyond logs.
- No background job dashboard.
- No structured error reporting.

## Why The Major Decisions Were Made

### Why FastAPI

FastAPI gives typed request/response schemas, easy dependency injection for DB
sessions/auth, and good async support for API calls.

### Why Celery

News ingestion and OpenAI summarization are slow and unreliable enough that they
should not happen in a foreground request. Celery lets the API queue tasks and
the worker execute them in the background.

### Why Store Flashcards

Persisting ranked feeds makes the app deterministic for a given day. Users can
reload without the order changing constantly. It also makes debugging ranking
much easier because the exact rank order is stored.

### Why Force Refresh Deletes Existing Feed Rows

The `uq_feed_article` constraint prevents duplicate cards. Deleting before
force-refresh is simple, safe, and avoids duplicate-key errors.

### Why Global Article Pool Limit

The app needs enough articles for a large feed, but not unbounded growth. 500
ordinary articles is a good prototype limit for 20 users. Saved articles are
protected because user saves are meaningful state.

### Why One-Paragraph Summaries

The app is a flashcard feed. Bullet summaries looked cluttered and consumed too
much space. One paragraph matches the target Inshorts-style reading experience.

### Why Hide Ranking Metadata

Ranking score/reason is useful for developers but not for users. Showing
"interest match" or scores made the card feel like a debug surface rather than a
news product.

### Why Swipe Left For Next

The user wanted the gesture to feel like moving through a book. Swiping left now
advances to the next article; swiping right goes back.

### Why Cache Both Ahead and Behind

Users swipe forward quickly, but they also go backward. Only prefetching next
cards made backward navigation lag. The current cache window warms both
directions.

## File Map

Backend core:

- [backend/app/main.py](backend/app/main.py): FastAPI app and routers.
- [backend/app/core/config.py](backend/app/core/config.py): environment
  settings.
- [backend/app/core/celery_app.py](backend/app/core/celery_app.py): Celery app
  and daily schedule.
- [backend/app/core/security.py](backend/app/core/security.py): password hashing
  and JWT helpers.

Backend DB:

- [backend/app/db/model.py](backend/app/db/model.py): SQLAlchemy schema.
- [backend/app/db/session.py](backend/app/db/session.py): DB engine/session.
- [backend/alembic/](backend/alembic): migrations.
- [backend/app/db/scripts/initial_data.py](backend/app/db/scripts/initial_data.py):
  seed interests and demo users.

Backend API:

- [backend/app/api/dependencies.py](backend/app/api/dependencies.py): DB/auth
  dependencies.
- [backend/app/api/endpoints/login.py](backend/app/api/endpoints/login.py):
  access-token login.
- [backend/app/api/endpoints/users.py](backend/app/api/endpoints/users.py):
  user creation/current user/current interests.
- [backend/app/api/endpoints/interests.py](backend/app/api/endpoints/interests.py):
  interests list and update.
- [backend/app/api/endpoints/news.py](backend/app/api/endpoints/news.py): tasks,
  feed, saved articles, interactions.
- [backend/app/api/endpoints/dev.py](backend/app/api/endpoints/dev.py): smoke
  and demo feed helpers.

Backend services:

- [backend/app/services/news.py](backend/app/services/news.py): NewsAPI client.
- [backend/app/services/article_pipeline.py](backend/app/services/article_pipeline.py):
  validation, normalization, dedupe, keyword/category enrichment.
- [backend/app/services/summarizer.py](backend/app/services/summarizer.py):
  OpenAI and fallback summaries.
- [backend/app/services/embeddings.py](backend/app/services/embeddings.py):
  OpenAI embeddings and vector helpers.
- [backend/app/services/user_profile.py](backend/app/services/user_profile.py):
  interaction logging and preference updates.
- [backend/app/services/recommendations.py](backend/app/services/recommendations.py):
  ranking and feed persistence.

Backend tasks:

- [backend/app/tasks/news_fetching.py](backend/app/tasks/news_fetching.py):
  ingestion, summarization, embedding, feed generation, pruning.
- [backend/app/tasks/__init__.py](backend/app/tasks/__init__.py): task exports
  for Celery imports.

Frontend:

- [frontend/app/_layout.tsx](frontend/app/_layout.tsx): root stack and session
  provider.
- [frontend/app/(tabs)/_layout.tsx](frontend/app/(tabs)/_layout.tsx): Feed and
  Profile tabs.
- [frontend/app/(tabs)/index.tsx](frontend/app/(tabs)/index.tsx): swipeable feed.
- [frontend/app/(tabs)/explore.tsx](frontend/app/(tabs)/explore.tsx): Profile,
  login, interests, saved articles.
- [frontend/context/AppSessionContext.tsx](frontend/context/AppSessionContext.tsx):
  session state and API base URL.
- [frontend/lib/api.ts](frontend/lib/api.ts): typed backend client.

Docs and scripts:

- [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md): short handoff.
- [PROJECT_DEEP_DIVE.md](PROJECT_DEEP_DIVE.md): this detailed guide.
- [backend/scripts/check_openai_key.py](backend/scripts/check_openai_key.py):
  quick OpenAI smoke test.
- [backend/tests/test_frontend_contract.py](backend/tests/test_frontend_contract.py):
  backend contract tests for frontend flows.
