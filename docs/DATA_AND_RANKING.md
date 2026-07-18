# Data And Ranking

## Collected Signals

The beta app records:

- `view`: card became visible.
- `like`: tester explicitly liked a story.
- `skip`: tester skipped or disliked a story.
- `save`: tester saved/bookmarked a story.
- `click`: tester opened the article URL.
- `dwell_time_seconds`: approximate time spent on a card before an action.
- selected interests through `user_interests`.

The backend also stores article metadata such as source, country, primary category, keywords, publish time, and summary fields.

## Current Ranking Use

Ranking is intentionally interpretable:

- selected interests influence category/country matching.
- interactions update category and keyword preference scores.
- feed generation uses the summarized article pool and writes ranked flashcards.
- `FEED_EXPLORATION_RATIO` leaves room for exploration rather than only exploiting known preferences.

## Near-Term Analysis

Export or query:

- click-through rate by category/source/country.
- save and like rates by rank position.
- skip rate by category/source.
- dwell time distribution by category.
- interest coverage: selected interests vs delivered feed categories.
- cold-start quality for users with no interactions.

Useful metrics:

- `CTR = clicks / views`
- `Save rate = saves / views`
- `Positive rate = (likes + saves + clicks) / views`
- `Negative rate = skips / views`
- `Mean dwell time` by article/category/source

## Future Ranking Work

Heuristic tuning:

- adjust category, keyword, recency, country, and exploration weights.
- compare before/after engagement metrics over similar beta sessions.

Learning-to-rank:

- build training rows from user, article, rank, features, and observed outcome.
- use clicks/saves/likes as positive labels and skips/short dwell as weak negatives.
- evaluate offline with held-out sessions and ranking metrics like NDCG or MAP.

Contextual bandits:

- use only after enough traffic exists.
- define reward carefully, for example save/click/like with penalties for skip.
- keep exploration bounded in beta so the user experience remains useful.

Offline evaluation:

- snapshot candidate pools and interactions.
- replay alternative ranking weights against historical signals.
- watch for position bias because higher-ranked cards are more likely to be seen.

## Lightweight Export Ideas

Do not overbuild early. A simple admin-only SQL export or read-only notebook is enough:

```sql
select
  u.email,
  a.id as article_id,
  a.source,
  a.country,
  a.primary_category,
  i.interaction_type,
  i.dwell_time_seconds,
  i.created_at
from user_article_interactions i
join users u on u.id = i.user_id
join articles a on a.id = i.article_id
order by i.created_at desc;
```

Later, add a dedicated analytics export endpoint only if manual SQL becomes a blocker.
