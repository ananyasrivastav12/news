# Project Handoff

## Current Product

This is a personalized news flashcard app with a local admin dashboard.

The backend ingests articles from US and India sources, summarizes them, stores the article pool in Postgres, and ranks user feeds from stored articles. Users log in, choose interests, read swipeable cards, and create interaction signals through views, skips, likes, saves, and article opens.

The current feed model supports three 50-card daily editions:

- Morning Brief
- Midday Catch-Up
- Daily Digest

Editions are local-time aware for NYC and India. The app should open to the newest ready edition, while still letting users view previous loaded editions.

## Important Behavior Decisions

- Each edition targets 50 cards.
- Cards should not repeat across editions when avoidable.
- Updates to a story are acceptable; duplicate cards are not.
- Country interests act like market preferences. Category interests should apply inside selected markets first.
- Feeds are ranked per user when the app loads or when the user refreshes after interest changes.
- Already viewed cards stay viewed. Regeneration should preserve seen state and rerank remaining unseen cards.
- Persistent flashcards are stored so a user sees a stable edition, not a constantly reshuffled feed.

## Dashboard Work Completed

The admin dashboard has been redesigned into clearer pages:

- Home: readiness, freshness, market health, latest pipeline state.
- Control: manual pipeline actions, beta user creation, schedules, recent runs.
- Quality: article pool coverage by market/category/date.
- Articles: searchable/filterable article inventory, including missing images and user-signal filters.
- Users: beta user list and selected-user feed inspector.

The dashboard now separates article quality observability from raw article browsing and user feed inspection.

## Backend/Admin Work Completed

- Added admin observability endpoints for article distribution and article inventory summaries.
- Added date/timezone-aware dashboard filters.
- Added article filters for country, category, summary status, source, image presence, user signals, saved/protected state, and row limit.
- Added user feed inspector summaries by selected edition/timezone.
- Improved dashboard display of pipeline run details and market/category intersections.

## Beta Plan

Use the local machine as the beta backend host:

1. Keep Postgres, Redis, backend API, Celery worker, and Celery Beat running locally.
2. Expose only the backend API with a stable HTTPS tunnel, such as Cloudflare Tunnel or reserved ngrok.
3. Keep the admin dashboard private on localhost.
4. Build the mobile app with `EXPO_PUBLIC_API_BASE_URL` pointing to the tunnel URL.
5. Create beta users from the dashboard.
6. Send testers app install access plus email/password credentials.
7. Use the dashboard to monitor article quality, runs, users, and feed output.

The machine must be awake and online at scheduled pipeline times. If it sleeps, 7 AM / 4 PM / 9 PM jobs will not run.

## Mobile Distribution Direction

Do not expect testers to use Expo Go if the goal is a polished beta. Use Expo EAS internal distribution or TestFlight:

- Android: EAS internal distribution can produce an APK install link.
- iOS: TestFlight is cleaner for non-technical testers, but requires an Apple Developer account. EAS ad hoc internal distribution also works, but device registration is more annoying.

Before sending:

- Rename the app from `frontend` to the actual product name.
- Replace the app icon with a newspaper-style icon.
- Set bundle identifiers/package names.
- Build with the tunnel backend URL.
- Test install on one real phone over cellular.

## Edition Timing Question

Keep the product names the same in both markets: Morning Brief, Midday Catch-Up, Daily Digest.

The schedule should be market-local:

- NYC Morning Brief: 7:00 AM America/New_York
- India Morning Brief: 7:00 AM Asia/Kolkata
- NYC Midday Catch-Up: 4:00 PM America/New_York
- India Midday Catch-Up: 4:00 PM Asia/Kolkata
- NYC Daily Digest: 9:00 PM America/New_York
- India Daily Digest: 9:00 PM Asia/Kolkata

Do not use one global UTC time for both countries. That would make one market receive oddly timed editions.

## Things To Do Next

1. Upgrade local Node to the Vite-supported version.
2. Add or verify EAS config for internal/preview builds.
3. Create a real app name, icon, splash screen, and bundle/package IDs.
4. Add a stable tunnel and document the exact backend URL workflow.
5. Confirm CORS allows the tunnel/mobile app and does not expose the dashboard publicly.
6. Add a small README section for beta setup and dashboard screenshots.
7. Test one end-to-end beta account on a physical phone.
8. Recheck the scheduler model for market-local NYC and India runs.
9. Add clearer failure surfaces if pipeline jobs fail mid-run.
10. Later: export interaction data for ML/RL experiments.

## Useful Prompts For Next Conversation

```text
Read docs/HANDOFF.md and inspect the repo. Do not code yet. Summarize the current state, any uncommitted changes, and the next safest implementation step.
```

```text
Set up Expo EAS internal distribution for this app. Before coding, explain the exact app naming, icon, bundle ID, env var, and build-profile changes.
```

```text
Implement market-local scheduled editions for NYC and India. Before coding, explain whether this should be represented as six schedule entries or three edition definitions with per-market timezones.
```

```text
Prepare the repo for GitHub presentation: README, screenshots, beta runbook, and known limitations. Do not expose secrets.
```

```text
Review the ranking and interaction data for ML/RL readiness. Explain what signals we have, what labels we can derive, and what export format we should add first.
```
