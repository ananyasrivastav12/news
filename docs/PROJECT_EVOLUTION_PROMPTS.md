# Project Evolution Prompts

Use these prompts one by one. Each prompt is meant to keep the work small, focused, and understandable before moving to implementation.

## 1. Three Daily Feed Editions

Prompt:

```text
Explain how we should evolve the current one-feed-per-day system into three daily feed editions: Morning Brief at 7 AM, Midday Catch-Up at 4 PM, and Daily Digest at 9 PM.

Focus only on product behavior and system requirements. Do not write code yet.

Cover:
- What the user should see when they open the app at different times of day.
- Whether each edition should have 100 cards.
- Whether cards can repeat across editions.
- How users should switch between the latest editions.
- How completion state should work for each edition.
- What should happen if one edition is not ready yet.
- Pros and cons of storing 300 cards per user per day.
```

## 2. Feed Edition Data Model

Prompt:

```text
Review the current flashcards/feed data model and explain what database changes are needed to support three daily feed editions.

Do not write code yet.

Cover:
- Current flashcards structure.
- Why feed_date alone is not enough anymore.
- Whether we need an edition_type field.
- How uniqueness constraints should change.
- How viewed/completed state should be stored.
- Whether each user should have their own flashcard rows.
- Why flashcards store both article_id and summary_id.
- How this design scales for beta users versus larger usage.
```

## 3. Feed Generation API Redesign

Prompt:

```text
Explain how we should redesign the feed APIs so reading a feed and generating a feed are separate.

Do not write code yet.

Cover:
- Problems with the current GET /api/users/me/feed behavior.
- Proposed GET endpoints for available feed editions and cards.
- Proposed POST endpoint for requesting feed generation.
- Whether generation should be synchronous or queued.
- How force_refresh should behave.
- What the mobile app should call on startup.
- What the dashboard should call for manual runs.
- Pros and cons of the current design versus the new split design.
```

## 4. Celery And Scheduled Pipelines

Prompt:

```text
Explain how Redis, Celery worker, and Celery Beat should be used to automatically generate Morning Brief, Midday Catch-Up, and Daily Digest.

Do not write code yet.

Cover:
- What Redis is doing today.
- What Celery worker is doing today.
- What Celery Beat is doing today.
- How to schedule three daily jobs.
- Whether schedules should be hardcoded or controlled from the dashboard.
- What each scheduled pipeline should do: fetch, summarize, embed, generate feeds.
- How pipeline_runs and logs should represent each edition.
- How failures should be surfaced in the dashboard.
```

## 5. Dashboard Scheduling UX

Prompt:

```text
Design the dashboard experience for managing the three daily news editions.

Do not write code yet.

Cover:
- What the dashboard overview should show.
- How admins should see Morning, Midday, and Digest status.
- What manual run buttons are needed.
- What schedule controls are needed.
- What pipeline run history should show.
- What article/summarization stats matter.
- What should be hidden or simplified.
- How to make the dashboard visually match the mobile app's font, color, and tone.
```

## 6. Mobile Feed Edition UX

Prompt:

```text
Design the mobile app UX for multiple daily feed editions.

Do not write code yet.

Cover:
- How the app chooses the default edition when opened.
- How users switch between Morning Brief, Midday Catch-Up, and Daily Digest.
- How first-unread card behavior should work per edition.
- How completed editions should be marked.
- What empty/loading/error states should say.
- What profile summary should show for edition progress.
- What users do not need to see.
- How to keep the swipe experience fast.
```

## 7. Interaction Tracking Audit

Prompt:

```text
Audit the current interaction tracking system and explain what should change.

Do not write code yet.

Cover:
- How view, click, like, save, and skip are currently measured.
- Whether a left swipe should count as skip, view, quick_skip, or something else.
- Whether dislike/skip should mark a card as viewed.
- Whether dwell_time_seconds is currently accurate enough.
- What additional signals would improve ranking.
- How to distinguish reading headline only, reading summary, clicking article, and quick rejection.
- How interaction logging should avoid slowing down swiping.
- Pros and cons of more detailed interaction events.
```

## 8. Recommendation Logic Review

Prompt:

```text
Explain how the current recommendation system works and where it should improve.

Do not write code yet.

Cover:
- Current scoring inputs: interests, country, categories, keywords, recency, exploration, interactions, embeddings.
- How persistent flashcards work.
- What happens when feed already exists.
- What happens when force_refresh is true.
- Whether already-read cards should move to the back or the app should open at first unread.
- How strong selected interests should be.
- How strong learned behavior should be.
- How to prevent overly repetitive feeds.
- How to keep recommendations explainable.
```

## 9. Country Personalization

Prompt:

```text
Analyze how country selection should affect the user's feed.

Do not write code yet.

Cover:
- Current ingestion from US and India.
- What happens if user selects India, US, or both.
- Whether country should be a hard filter or a ranking boost.
- How much local, global, and other-country news should appear.
- Suggested ratios for selected country versus global news.
- How this should differ for Morning Brief, Midday Catch-Up, and Daily Digest.
- What we can only learn through beta testing.
```

## 10. Embeddings And Advanced Personalization

Prompt:

```text
Explain how embeddings are currently used and how personalization could become more advanced over time.

Do not write code yet.

Cover:
- Whether article embeddings are always generated today.
- How user_embedding_profiles are created.
- Why averaging positive embeddings is simple but limited.
- Whether we should use negative embeddings.
- How keyword preferences compare to embedding similarity.
- How to personalize for entities, topics, sources, musicians, teams, companies, or political interests.
- Risks of filter bubbles for news.
- Better future approaches, from simple to advanced.
```

## 11. Saved Articles Model

Prompt:

```text
Evaluate whether saved articles should remain as SAVE interactions or move into a dedicated saved_articles table.

Do not write code yet.

Cover:
- Current SAVE interaction approach.
- Problems with retrieving saved articles from interactions.
- Difference between behavioral history and current bookmark state.
- Whether to keep SAVE as an interaction even if saved_articles is added.
- Suggested saved_articles table fields.
- Migration strategy from current interactions to a cleaner model.
- Pros and cons of changing this now versus later.
```

## 12. Auth And Login UX

Prompt:

```text
Review the current auth/login flow and propose improvements for beta.

Do not write code yet.

Cover:
- Current OAuth2PasswordRequestForm behavior where username means email.
- Whether beta users should log in with email or username.
- How to reduce frontend/backend naming confusion.
- How login errors should be displayed in the app.
- Current token expiration behavior.
- Whether persistent login or "stay signed in" is needed.
- Simple beta-safe options versus production-grade refresh tokens.
- Security tradeoffs.
```

## 13. Profile Summary Redesign

Prompt:

```text
Redesign the user profile summary API and screen from the user's perspective.

Do not write code yet.

Cover:
- What profile-summary currently mixes together.
- What users actually care about.
- What should move into admin-only views.
- What edition progress should show.
- How saved articles should appear.
- How interest management should appear.
- Whether raw interaction counts are useful to users.
- Whether the profile summary endpoint should be split or cached later.
```

## 14. Redis And Caching Strategy

Prompt:

```text
Explain whether Redis should be used for more than Celery in this project.

Do not write code yet.

Cover:
- What Redis currently does.
- Why feed JSON, articles, images, and API responses are not currently cached in Redis.
- Why Postgres materialized flashcards already act like a durable feed cache.
- When Redis caching would become useful.
- What data would be safe to cache.
- What data should not be cached in Redis.
- Whether Redis should be used for rate limiting, feed-generation locks, task progress, or admin metrics.
```

## 15. Image Loading And Caching

Prompt:

```text
Explain the current image loading and caching behavior in the mobile app and what should be improved for beta.

Do not write code yet.

Cover:
- Backend only stores image_url.
- Expo Image loads images on the device.
- How memory-disk prefetch works.
- How many cards ahead/behind are prefetched.
- Whether this works in a deployed beta app.
- Risks with remote NewsAPI image URLs.
- Whether images should eventually be proxied or cached through our own backend/CDN.
- Fallback behavior for missing or broken images.
```

## 16. Article Quality Filtering

Prompt:

```text
Explore whether we should score article quality during ingestion before personalization.

Do not write code yet.

Cover:
- What quality checks exist today.
- How to identify low-quality articles like clickbait or shallow listicles.
- Whether quality scoring should happen before summarization.
- Whether quality should affect all users or just ranking.
- Possible signals: source reliability, title style, content length, duplicate story count, summary usefulness.
- Risks of over-filtering.
- Simple beta-safe approach versus advanced article quality model.
```

## 17. Implementation Plan For Three Editions

Prompt:

```text
Create a step-by-step implementation plan for adding Morning Brief, Midday Catch-Up, and Daily Digest.

Do not write code yet.

Break the work into small PR-sized tasks:
- database migration
- backend model/schema updates
- recommendation/feed generation updates
- Celery schedule updates
- API updates
- dashboard updates
- mobile app updates
- tests
- rollout/backfill plan

For each task, explain files likely touched, risk level, and how to verify it.
```

## 18. First Code Task: Database Only

Prompt:

```text
Implement only the database/model layer needed for three daily feed editions.

Scope:
- Add feed edition support to the backend models and Alembic migration.
- Do not change API behavior yet.
- Do not change frontend or dashboard.

Before coding, summarize the exact schema change and constraints.
After coding, run relevant backend tests or migration checks.
```

## 19. Second Code Task: Backend Feed APIs

Prompt:

```text
Implement the backend API changes for edition-aware feeds.

Scope:
- Add read endpoints for available editions and edition-specific feed cards.
- Add or prepare a POST feed-generation endpoint.
- Keep backward compatibility if practical.
- Do not update mobile UI yet.

Before coding, explain the endpoint contract.
After coding, add/update tests for response shapes and behavior.
```

## 20. Third Code Task: Mobile Edition UI

Prompt:

```text
Implement the mobile UI changes for Morning Brief, Midday Catch-Up, and Daily Digest.

Scope:
- Add edition switcher.
- Default to newest available edition.
- Preserve first-unread behavior per edition.
- Show completion status.
- Keep swiping smooth and avoid extra fetches per card.

Before coding, summarize the screen behavior.
After coding, run frontend checks and manually verify key states.
```

## 21. Fourth Code Task: Dashboard Edition Scheduling

Prompt:

```text
Implement dashboard support for three daily feed editions.

Scope:
- Show edition statuses.
- Add schedule controls for 7 AM, 4 PM, and 9 PM.
- Add manual run buttons per edition.
- Align styling closer to the mobile app.

Before coding, summarize dashboard UX changes.
After coding, run dashboard checks and verify API calls.
```

## 22. Fifth Code Task: Interaction Improvements

Prompt:

```text
Improve interaction tracking for better personalization.

Scope:
- Ensure skip/dislike counts as viewed.
- Decide and implement left-swipe signal behavior.
- Improve dwell time measurement if needed.
- Avoid blocking swipe UI.
- Update preference logic only where clearly justified.

Before coding, summarize the event model.
After coding, test interaction API behavior and mobile interaction flow.
```
