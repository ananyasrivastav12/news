export type Interest = {
  id: number;
  name: string;
  source_type: string;
};

export type FeedItem = {
  id: number;
  feed_date: string;
  rank_position: number;
  ranking_score: number;
  ranking_reason: string | null;
  article: {
    id: number;
    title: string;
    source: string | null;
    url: string;
    published_at: string | null;
    primary_category: string;
    image_url: string | null;
    keywords: string[];
    summary: {
      main_takeaway: string;
      supporting_lines: string[];
    };
  };
};

export type SavedArticle = FeedItem['article'];

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
    console.error(`[api] ${method} ${path} -> ${response.status}`, text);
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

export function createUser(
  apiBaseUrl: string,
  payload: { email: string; password: string }
) {
  return request<{ id: number; email: string }>(apiBaseUrl, '/api/users/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function login(
  apiBaseUrl: string,
  payload: { email: string; password: string }
) {
  const body = new URLSearchParams();
  body.append('username', payload.email);
  body.append('password', payload.password);

  return request<{ access_token: string; token_type: string }>(
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
  forceRefresh = false
) {
  const search = forceRefresh ? '?force_refresh=true' : '';
  return request<FeedItem[]>(apiBaseUrl, `/api/users/me/feed${search}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function fetchSavedArticles(apiBaseUrl: string, accessToken: string) {
  return request<SavedArticle[]>(apiBaseUrl, '/api/users/me/saved-articles', {
    headers: { Authorization: `Bearer ${accessToken}` },
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

export function triggerFeedGeneration(apiBaseUrl: string) {
  return request<{ message: string; task_id: string }>(
    apiBaseUrl,
    '/api/tasks/generate-feeds?force_refresh=true',
    { method: 'POST' }
  );
}
