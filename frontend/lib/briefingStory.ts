// maps backend feed records into story card view models
import { FeedItem, SavedArticle } from '@/lib/api';

export type BriefingStory = {
  id: string;
  originalHeadline: string;
  displayHeadline: string;
  shortSummary: string;
  whyItMatters?: string;
  fullSummary?: string;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  section: string;
  imageUrl?: string;
  imageFocus?: {
    x: number;
    y: number;
  };
};

function sentenceSplit(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function constrainSummary(main: string, supportingLines: string[] = []) {
  const candidates = [main, ...supportingLines].filter(Boolean);
  return candidates.join(' ').replace(/\s+/g, ' ').trim();
}

function consequenceFromSummary(summary: string) {
  const sentences = sentenceSplit(summary);
  const useful = sentences.find((sentence) =>
    /\b(could|will|may|means|gives|leaves|puts|raises|reshapes|signals)\b/i.test(sentence)
  );
  if (!useful) return undefined;
  const words = useful.split(/\s+/).filter(Boolean);
  if (words.length < 12 || words.length > 24) return undefined;
  return useful;
}

export function feedItemToBriefingStory(item: FeedItem): BriefingStory {
  const article = item.article;
  const originalHeadline = article.title.trim();
  const displayHeadline = article.summary.display_headline?.trim() || originalHeadline;
  const shortSummary = constrainSummary(
    article.summary.main_takeaway,
    article.summary.supporting_lines
  );
  const fullSummary =
    article.summary.summary_text?.trim() ||
    [article.summary.main_takeaway, ...article.summary.supporting_lines]
      .filter(Boolean)
      .join('\n\n');
  const sourceUrl = article.url ?? article.original_url ?? '';

  return {
    id: String(article.id),
    originalHeadline,
    displayHeadline,
    shortSummary,
    whyItMatters: article.summary.why_it_matters?.trim() || consequenceFromSummary(shortSummary),
    fullSummary,
    sourceName: article.source || 'News source',
    sourceUrl,
    publishedAt: article.published_at || item.feed_date,
    section: article.primary_category || 'News',
    imageUrl: article.image_url || undefined,
    imageFocus: { x: 0.5, y: 0.45 },
  };
}

export function savedArticleToBriefingStory(article: SavedArticle): BriefingStory {
  const originalHeadline = article.title.trim();
  const displayHeadline = article.summary.display_headline?.trim() || originalHeadline;
  const shortSummary = constrainSummary(
    article.summary.main_takeaway,
    article.summary.supporting_lines
  );
  return {
    id: String(article.id),
    originalHeadline,
    displayHeadline,
    shortSummary,
    fullSummary:
      article.summary.summary_text?.trim() ||
      [article.summary.main_takeaway, ...article.summary.supporting_lines]
        .filter(Boolean)
        .join('\n\n'),
    whyItMatters: article.summary.why_it_matters?.trim() || consequenceFromSummary(shortSummary),
    sourceName: article.source || 'News source',
    sourceUrl: article.url ?? article.original_url ?? '',
    publishedAt: article.published_at || '',
    section: article.primary_category || 'News',
    imageUrl: article.image_url || undefined,
    imageFocus: { x: 0.5, y: 0.45 },
  };
}

export function getRelativeDate(value: string) {
  if (!value) return 'Recent';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recent';
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function getArticleDisplayDate(value: string) {
  if (!value) return 'Recent';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recent';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function getFullDate(value: string) {
  if (!value) return 'Recently published';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently published';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
