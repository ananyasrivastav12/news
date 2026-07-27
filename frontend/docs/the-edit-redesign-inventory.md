# The Edit Redesign Inventory

## Screen Inventory

- Login: beta sign-in only, no bottom navigation, inline validation, network error banner.
- Briefing: masthead, edition title, local date/market, edition selector, fixed briefing card, previous/next controls.
- Story detail: scrollable full story summary with original headline, hero image, source/date, key points, save and preference actions.
- Saved: dedicated tab with compact rows, filters, empty state, and remove affordance placeholder.
- Profile: account and preference sections, separated topics/regions, schedule, personalization, notifications, about, sign out.

## Component Hierarchy

- App shell: Expo Router stack plus three-tab bottom navigation.
- Design foundation: tokens, typography components, presentation adapters.
- Briefing screen: `EditionSelector`, `StoryCard`, `EmptyState`, navigation controls.
- Story card: `EditorialImage`, metadata, constrained headline, source, summary, optional consequence, `ActionButton` row.
- Detail screen: `EditorialImage`, full text, key points, action row.
- Saved screen: filter chips, saved rows, `EmptyState`.
- Profile screen: section blocks, check rows/chips, toggles, account actions.

## Design-Token File

- `frontend/design/tokens.ts` defines color, spacing, radius, borders, shadows, font names, type scale, nav sizing, and motion timing.
- No blue values are introduced. Oxblood is reserved for brand, active navigation, focus, and concise feedback.

## Type Scale

- `Masthead`: Newsreader/system serif bold, 18/22, uppercase, 1.6 letter spacing.
- `EditionTitle`: Newsreader/system serif semibold, 38/42, one line.
- `ScreenTitle`: Newsreader/system serif semibold, 34/39.
- `ArticleHeadline`: Newsreader/system serif semibold, 27/31, three lines.
- `SavedHeadline`: Newsreader/system serif semibold, 19/23, two lines.
- `Summary`: Inter/system sans regular, 17/25, five lines.
- `WhyItMatters`: Inter/system sans regular, 15/21.
- `SectionLabel`: Inter/system sans bold, 12/15, uppercase, 1.1 letter spacing.
- `Source`: Inter/system sans semibold, 13/17.
- `Metadata`: Inter/system sans regular, 13/18.
- `Button`: Inter/system sans semibold, 15/18.
- `BottomNavigation`: Inter/system sans medium, 12/15.
- `Input`: Inter/system sans regular, 16/21.

## Interaction-State Matrix

- Edition selector: available inactive, active, unavailable with clock/time, loading refresh.
- Story image: loading warm surface, loaded cover image, failed/missing designed fallback.
- Story actions: idle, pressed, selected, failed with restored state and message.
- Navigation: swipe left/next, swipe right/previous, visible previous/next buttons, disabled at bounds.
- Detail: back, open original, save, less, more.
- Saved: loaded, empty, refresh failure, row open, row remove placeholder.
- Profile preferences: selected with checkmark, unselected, saving, save failure.
- Login: untouched, focused, invalid field, authenticating, auth failure.
- App states: session restore, loading feed, no stories, caught up, offline/refresh failure.

## Responsive Layout Strategy

- Use 20 px global margins and 8-point spacing.
- Briefing card uses fixed 16:9 media and constrained text lines, so it never needs internal scrolling.
- Card body reserves compact metadata and action rows; overflow content moves to detail.
- Small iPhones reduce vertical gaps and image max height through measured screen height, not dynamic font shrinkage.
- Large iPhones keep readable measure through margins and max card body proportions.
- Dynamic type is allowed through React Native font scaling, with line limits and detail screen as the overflow path.
- Touch targets are at least 44 px. Selected states include both color and icons.
