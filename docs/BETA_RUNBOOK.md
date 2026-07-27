# Beta Runbook

## Access Flow

1. Collect beta requests with a Google Form.
2. Create email/password credentials manually through the backend API.
3. Email the tester their install link, email, temporary password, known limitations, and feedback form.
4. Tester logs in, picks interests, and uses the feed.
5. Operator reviews dashboard metrics and interaction data after each session.

Suggested Google Form fields:

- Name
- Email
- iOS or Android
- Country
- News interests
- Consent to collect usage signals for ranking improvement
- Feedback consent
- Optional category: recruiter, friend, family, other

## Manual Account Creation

```bash
curl -X POST https://YOUR_API_HOST/api/users/ \
  -H "Content-Type: application/json" \
  -d '{"email":"tester@example.com","password":"replace-this"}'
```

CSV format if you later add a script:

```csv
email,password
tester@example.com,replace-this
```

## Pre-Invite Checklist

```bash
cd /app
alembic upgrade head
python app/db/scripts/initial_data.py
```

Then:

1. Confirm `ADMIN_EMAILS` includes your operator account.
2. Create or verify the admin user.
3. Run one dashboard pipeline sequence: ingest, summarize, generate feeds.
4. Confirm pending summaries are low and completed summaries increased.
5. Log in as a test user.
6. Pick interests.
7. Confirm the selected edition shows up to 50 cards.
8. Like, skip, save, and open a story.
9. Confirm profile stats and dashboard user signals update.

## Daily Beta Workflow

1. Check NewsAPI and OpenAI usage dashboards.
2. Use dashboard overview to inspect planned requests and summary limits.
3. Run `Ingest` only when fresh content is needed.
4. Run `Summarize` for pending articles.
5. Run `Generate feeds`.
6. Spot-check a test account in the Expo app.
7. Ask testers to use the app.
8. Review interaction counts and feedback.

## Tester Message Template

Subject: News Summarizer beta access

Hi,

You are invited to test the News Summarizer beta.

- Install link: `ADD_LINK`
- Email: `tester@example.com`
- Password: `ADD_PASSWORD`
- What to do: log in, choose interests, read the cards, and use like, save, skip, and open actions naturally.
- Known limits: content refreshes are operator-run during beta, Google login may be disabled, and some topics may have sparse coverage.
- Privacy note: views, clicks, likes, skips, saves, dwell time, and selected interests are logged to improve ranking.
- Feedback form: `ADD_LINK`

Thanks.
