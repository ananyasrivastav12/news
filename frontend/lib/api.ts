// typed api client for the mobile app
export type Interest = {
  id: number;
  name: string;
  source_type: string;
};

export type FeedItem = {
  id: number;
  feed_date: string;
  edition_type: FeedEditionType;
  market_timezone: string;
  rank_position: number;
  ranking_score: number;
  ranking_reason: string | null;
  is_viewed: boolean;
  article: {
    id: number;
    title: string;
    source: string | null;
    country: string;
    url?: string;
    original_url?: string;
    published_at: string | null;
    primary_category: string;
    image_url: string | null;
    keywords: string[];
    summary: {
      display_headline?: string | null;
      main_takeaway: string;
      supporting_lines: string[];
      summary_text?: string | null;
      why_it_matters?: string | null;
    };
  };
};

export type FeedEditionType = 'morning_brief' | 'midday_catch_up' | 'daily_digest';

export type FeedEdition = {
  feed_date: string;
  edition_type: FeedEditionType;
  title: string;
  market_timezone: string;
  expected_publish_at: string;
  is_ready: boolean;
  total: number;
  unread: number;
  completed: boolean;
};

export type FeedEditionsResponse = {
  selected_feed_date: string | null;
  selected_edition_type: FeedEditionType | null;
  market_timezone: string;
  editions: FeedEdition[];
};

export type SavedArticle = FeedItem['article'];

export type ProfileSummary = {
  interests: string[];
  signal_counts: {
    viewed: number;
    liked: number;
    disliked: number;
    saved: number;
    clicked: number;
  };
  today_feed: {
    total: number;
    unread: number;
    explicit_interest_matches: number;
  };
};

export type SupportMessage = {
  id: number;
  subject: string | null;
  message: string;
  status: string;
  created_at: string | null;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  email?: string;
};

async function request<T>(
  apiBaseUrl: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = options.method ?? 'GET';
  console.log(`[api] ${method} ${path}`);
  const response = await fetch(`${apiBaseUrl}${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    const log = response.status === 401 ? console.log : console.error;
    log(`[api] ${method} ${path} -> ${response.status}`, text);
    let message = text || `Request failed with ${response.status}`;
    try {
      const payload = JSON.parse(text) as { detail?: string };
      message = payload.detail || message;
    } catch {
      // Keep the raw backend payload when it is not JSON.
    }
    throw new Error(message);
  }
  console.log(`[api] ${method} ${path} -> ${response.status}`);
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function login(
  apiBaseUrl: string,
  payload: { email: string; password: string }
) {
  const body = new URLSearchParams();
  body.append('username', payload.email);
  body.append('password', payload.password);

  return request<TokenResponse>(
    apiBaseUrl,
    '/api/login/access-token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }
  );
}

export function fetchInterests(apiBaseUrl: string) {
  return request<Interest[]>(apiBaseUrl, '/api/interests/');
}

export function updateInterests(
  apiBaseUrl: string,
  accessToken: string,
  interestIds: number[]
) {
  return request<Interest[]>(apiBaseUrl, '/api/users/me/interests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(interestIds),
  });
}

export function fetchMyInterests(apiBaseUrl: string, accessToken: string) {
  return request<Interest[]>(apiBaseUrl, '/api/users/me/interests', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function fetchFeed(
  apiBaseUrl: string,
  accessToken: string,
  forceRefresh = false,
  options: {
    feedDate?: string | null;
    editionType?: FeedEditionType | null;
    marketTimezone?: string;
  } = {}
) {
  const search = new URLSearchParams();
  if (forceRefresh) search.set('force_refresh', 'true');
  if (options.feedDate) search.set('feed_date', options.feedDate);
  if (options.editionType) search.set('edition_type', options.editionType);
  if (options.marketTimezone) search.set('market_timezone', options.marketTimezone);
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return request<FeedItem[]>(apiBaseUrl, `/api/users/me/feed${suffix}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function fetchFeedEditions(
  apiBaseUrl: string,
  accessToken: string,
  marketTimezone: string
) {
  const search = new URLSearchParams({ market_timezone: marketTimezone });
  return request<FeedEditionsResponse>(
    apiBaseUrl,
    `/api/users/me/feed-editions?${search.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
}

export function fetchSavedArticles(apiBaseUrl: string, accessToken: string) {
  return request<SavedArticle[]>(apiBaseUrl, '/api/users/me/saved-articles', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function fetchProfileSummary(apiBaseUrl: string, accessToken: string) {
  return request<ProfileSummary>(apiBaseUrl, '/api/users/me/profile-summary', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function createSupportMessage(
  apiBaseUrl: string,
  accessToken: string,
  payload: { subject?: string; message: string }
) {
  return request<SupportMessage>(apiBaseUrl, '/api/users/me/support-messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export function changePassword(
  apiBaseUrl: string,
  accessToken: string,
  payload: { current_password: string; new_password: string }
) {
  return request<void>(apiBaseUrl, '/api/users/me/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export function deleteMyAccount(
  apiBaseUrl: string,
  accessToken: string,
  payload: { password: string }
) {
  return request<void>(apiBaseUrl, '/api/users/me', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export async function generateMyFeed(apiBaseUrl: string, accessToken: string) {
  const items = await fetchFeed(apiBaseUrl, accessToken, true);
  return { message: `Generated ${items.length} feed items.`, items };
}

export function logInteraction(
  apiBaseUrl: string,
  accessToken: string,
  payload: {
    article_id: number;
    interaction_type: 'view' | 'skip' | 'click' | 'like' | 'save';
    dwell_time_seconds?: number;
  }
) {
  return request(apiBaseUrl, '/api/users/me/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
}

export function deleteInteraction(
  apiBaseUrl: string,
  accessToken: string,
  payload: {
    article_id: number;
    interaction_type: 'view' | 'skip' | 'click' | 'like' | 'save';
  }
) {
  const search = new URLSearchParams({
    article_id: String(payload.article_id),
    interaction_type: payload.interaction_type,
  });
  return request<void>(
    apiBaseUrl,
    `/api/users/me/interactions?${search.toString()}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
}
