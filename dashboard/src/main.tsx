import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type Overview = {
  total_articles: number;
  fresh_articles: number;
  completed_summaries: number;
  failed_summaries: number;
  feed_items_generated: number;
  users_with_feeds: number;
  total_users: number;
  viewed_count: number;
  liked_count: number;
  disliked_count: number;
  saved_count: number;
  newsapi_requests_planned: number;
  newsapi_daily_target: number;
  openai_summary_calls_planned: number;
  openai_embedding_calls_planned: number;
  last_successful_run_at: string | null;
  next_scheduled_run_at: string | null;
};

type PipelineRun = {
  id: number;
  run_type: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  fetched_count: number;
  inserted_count: number;
  summarized_count: number;
  summary_failed_count: number;
  feed_items_count: number;
  error_message: string | null;
};

type Article = {
  id: number;
  title: string;
  source: string | null;
  country: string;
  primary_category: string;
  published_at: string | null;
  fetched_at: string | null;
  summary_status: string;
  image_present: boolean;
  interaction_count: number;
  is_protected: boolean;
};

type AdminUser = {
  id: number;
  email: string;
  interests: string[];
  feed_count: number;
  viewed_count: number;
  liked_count: number;
  disliked_count: number;
  saved_count: number;
  last_active: string | null;
  last_feed_generated: string | null;
};

type FeedItem = {
  rank_position: number;
  article_id: number;
  title: string;
  country: string;
  category: string;
  ranking_reason: string | null;
  is_viewed: boolean;
  score: number;
  liked: boolean;
  saved: boolean;
  disliked: boolean;
};

type Schedule = {
  id: number;
  name: string;
  enabled: boolean;
  schedule_type: string;
  hour: number;
  minute: number;
  countries: string[];
  categories: string[];
  article_target: number | null;
  summary_limit: number | null;
  force_feeds: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
};

type Tab = "overview" | "runs" | "articles" | "users" | "scheduler";

function App() {
  const [token, setToken] = useState(localStorage.getItem("adminToken") ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);

  const api = useMemo(() => createApi(token, setError), [token]);

  function saveToken(value: string) {
    localStorage.setItem("adminToken", value);
    setToken(value);
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setError("");
    setStatus("");
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Enter your admin email and password.");
      return;
    }
    setIsSigningIn(true);
    try {
      const body = new URLSearchParams({ username: trimmedEmail, password });
      const response = await fetch(`${API_BASE}/api/login/access-token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, "Login failed."));
      }
      const payload = await response.json();
      const nextToken = payload.access_token;
      await fetchJson<Overview>("/api/admin/overview", nextToken);
      saveToken(nextToken);
      setStatus("Signed in.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not reach the backend. Confirm FastAPI is running.",
      );
    } finally {
      setIsSigningIn(false);
    }
  }

  if (!token) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={login}>
          <h1>News Admin</h1>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={isSigningIn}>
            {isSigningIn ? "Signing in..." : "Sign in"}
          </button>
          {status ? <p className="status success">{status}</p> : null}
          {error ? <p className="error">{error}</p> : null}
          <p className="helper-text">Backend: {API_BASE}</p>
        </form>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <h1>News Admin</h1>
          <p>Pipeline operations</p>
        </div>
        <nav>
          {(["overview", "runs", "articles", "users", "scheduler"] as Tab[]).map(
            (item) => (
              <button
                key={item}
                className={tab === item ? "active" : ""}
                onClick={() => setTab(item)}
              >
                {labelForTab(item)}
              </button>
            ),
          )}
        </nav>
        <button
          className="secondary"
          onClick={() => {
            localStorage.removeItem("adminToken");
            setToken("");
          }}
        >
          Sign out
        </button>
      </aside>
      <main className="workspace">
        {error ? <div className="banner">{error}</div> : null}
        {tab === "overview" ? <OverviewPage api={api} /> : null}
        {tab === "runs" ? <RunsPage api={api} /> : null}
        {tab === "articles" ? <ArticlesPage api={api} /> : null}
        {tab === "users" ? <UsersPage api={api} /> : null}
        {tab === "scheduler" ? <SchedulerPage api={api} /> : null}
      </main>
    </div>
  );
}

function OverviewPage({ api }: { api: Api }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<Overview>("/api/admin/overview")
      .then(setOverview)
      .catch(() => setOverview(null))
      .finally(() => setLoading(false));
  }, [api]);

  async function runFullPipeline() {
    await api.post("/api/admin/pipeline-runs/full");
    setOverview(await api.get<Overview>("/api/admin/overview"));
  }

  if (loading) return <PageTitle title="Overview" subtitle="Loading..." />;
  if (!overview) return <EmptyState message="Overview could not be loaded." />;

  return (
    <section>
      <PageTitle title="Overview" subtitle="Freshness, capacity, and engagement." />
      <div className="toolbar">
        <button onClick={runFullPipeline}>Run full pipeline now</button>
      </div>
      <div className="metric-grid">
        <Metric label="Total articles" value={overview.total_articles} />
        <Metric label="Fresh articles" value={overview.fresh_articles} />
        <Metric label="Completed summaries" value={overview.completed_summaries} />
        <Metric label="Failed summaries" value={overview.failed_summaries} tone="bad" />
        <Metric label="Feed items" value={overview.feed_items_generated} />
        <Metric label="Users with feeds" value={overview.users_with_feeds} />
        <Metric label="NewsAPI planned" value={overview.newsapi_requests_planned} />
        <Metric label="Daily target" value={overview.newsapi_daily_target} />
        <Metric label="Summary calls planned" value={overview.openai_summary_calls_planned} />
        <Metric label="Embedding calls planned" value={overview.openai_embedding_calls_planned} />
        <Metric label="Views" value={overview.viewed_count} />
        <Metric label="Saved" value={overview.saved_count} />
      </div>
      <div className="status-strip">
        <span>Last success: {formatDate(overview.last_successful_run_at)}</span>
        <span>Next scheduled: {formatDate(overview.next_scheduled_run_at)}</span>
      </div>
    </section>
  );
}

function RunsPage({ api }: { api: Api }) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      setRuns(await api.get<PipelineRun[]>("/api/admin/pipeline-runs"));
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  useEffect(() => {
    if (!runs.some((run) => run.status === "queued" || run.status === "running")) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [api, runs]);

  async function run(path: string) {
    await api.post(path);
    await refresh();
  }

  return (
    <section>
      <PageTitle title="Pipeline Runs" subtitle="Run history, counts, and failures." />
      <div className="toolbar">
        <button onClick={() => run("/api/admin/pipeline-runs/full")}>Full pipeline</button>
        <button onClick={() => run("/api/admin/pipeline-runs/ingest")}>Ingest</button>
        <button onClick={() => run("/api/admin/pipeline-runs/summarize")}>Summarize</button>
        <button onClick={() => run("/api/admin/pipeline-runs/generate-feeds")}>
          Generate feeds
        </button>
      </div>
      {loading ? <InlineState message="Loading runs..." /> : null}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Type</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Fetched</th>
            <th>Inserted</th>
            <th>Summaries</th>
            <th>Failures</th>
            <th>Feeds</th>
            <th>Finished</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{run.id}</td>
              <td>{run.run_type}</td>
              <td><Badge value={run.status} /></td>
              <td>{run.duration_seconds ? `${run.duration_seconds.toFixed(1)}s` : "-"}</td>
              <td>{run.fetched_count}</td>
              <td>{run.inserted_count}</td>
              <td>{run.summarized_count}</td>
              <td>{run.summary_failed_count}</td>
              <td>{run.feed_items_count}</td>
              <td>{formatDate(run.finished_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ArticlesPage({ api }: { api: Api }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (status) params.set("summary_status", status);
    setLoading(true);
    try {
      setArticles(await api.get<Article[]>(`/api/admin/articles?${params}`));
    } catch {
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  return (
    <section>
      <PageTitle title="Article Pool" subtitle="Stored articles and summary state." />
      <div className="toolbar">
        <select value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="">All countries</option>
          <option value="us">US</option>
          <option value="in">India</option>
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All summaries</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <button onClick={refresh}>Apply filters</button>
      </div>
      {loading ? <InlineState message="Loading articles..." /> : null}
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Source</th>
            <th>Country</th>
            <th>Category</th>
            <th>Published</th>
            <th>Summary</th>
            <th>Image</th>
            <th>Signals</th>
            <th>Protected</th>
          </tr>
        </thead>
        <tbody>
          {articles.map((article) => (
            <tr key={article.id}>
              <td className="title-cell">{article.title}</td>
              <td>{article.source ?? "-"}</td>
              <td>{article.country.toUpperCase()}</td>
              <td>{article.primary_category}</td>
              <td>{formatDate(article.published_at)}</td>
              <td><Badge value={article.summary_status} /></td>
              <td>{article.image_present ? "Yes" : "No"}</td>
              <td>{article.interaction_count}</td>
              <td>{article.is_protected ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function UsersPage({ api }: { api: Api }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<AdminUser[]>("/api/admin/users")
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [api]);

  async function inspect(userId: number) {
    setSelectedUserId(userId);
    setFeed(await api.get<FeedItem[]>(`/api/admin/users/${userId}/feed`));
  }

  async function rebuild() {
    if (!selectedUserId) return;
    await api.post(`/api/admin/users/${selectedUserId}/rebuild-feed`);
    await inspect(selectedUserId);
  }

  return (
    <section>
      <PageTitle title="Users" subtitle="Feeds, interests, and engagement." />
      {loading ? <InlineState message="Loading users..." /> : null}
      <div className="split">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Interests</th>
              <th>Feed</th>
              <th>Signals</th>
              <th>Last active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} onClick={() => inspect(user.id)}>
                <td>{user.email}</td>
                <td>{user.interests.join(", ") || "-"}</td>
                <td>{user.feed_count}</td>
                <td>{user.viewed_count}/{user.liked_count}/{user.saved_count}</td>
                <td>{formatDate(user.last_active)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="inspector">
          <div className="toolbar compact">
            <strong>User Feed Inspector</strong>
            <button disabled={!selectedUserId} onClick={rebuild}>Rebuild feed</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Title</th>
                <th>Reason</th>
                <th>Score</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((item) => (
                <tr key={`${item.rank_position}-${item.article_id}`}>
                  <td>{item.rank_position}</td>
                  <td className="title-cell">{item.title}</td>
                  <td>{item.ranking_reason ?? "-"}</td>
                  <td>{item.score.toFixed(2)}</td>
                  <td>{item.is_viewed ? "viewed" : "unviewed"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SchedulerPage({ api }: { api: Api }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [name, setName] = useState("Morning full pipeline");
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      setSchedules(await api.get<Schedule[]>("/api/admin/schedules"));
    } catch {
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  async function createSchedule(event: FormEvent) {
    event.preventDefault();
    await api.post("/api/admin/schedules", {
      name,
      enabled: true,
      schedule_type: "full_pipeline",
      hour,
      minute,
      countries: ["us", "in"],
      categories: [],
      summary_limit: 100,
      force_feeds: true,
    });
    await refresh();
  }

  return (
    <section>
      <PageTitle title="Scheduler" subtitle="Backend schedule configuration." />
      <form className="toolbar" onSubmit={createSchedule}>
        <input value={name} onChange={(event) => setName(event.target.value)} />
        <input
          type="number"
          min="0"
          max="23"
          value={hour}
          onChange={(event) => setHour(Number(event.target.value))}
        />
        <input
          type="number"
          min="0"
          max="59"
          value={minute}
          onChange={(event) => setMinute(Number(event.target.value))}
        />
        <button type="submit">Add schedule</button>
      </form>
      {loading ? <InlineState message="Loading schedules..." /> : null}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Enabled</th>
            <th>Type</th>
            <th>Time</th>
            <th>Countries</th>
            <th>Summary limit</th>
            <th>Next run</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((schedule) => (
            <tr key={schedule.id}>
              <td>{schedule.name}</td>
              <td>{schedule.enabled ? "Yes" : "No"}</td>
              <td>{schedule.schedule_type}</td>
              <td>{pad(schedule.hour)}:{pad(schedule.minute)}</td>
              <td>{schedule.countries.join(", ") || "-"}</td>
              <td>{schedule.summary_limit ?? "-"}</td>
              <td>{formatDate(schedule.next_run_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-title">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </header>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

function InlineState({ message }: { message: string }) {
  return <div className="inline-state">{message}</div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`badge ${value.toLowerCase()}`}>{value.toLowerCase()}</span>;
}

type Api = ReturnType<typeof createApi>;

function createApi(token: string, setError: (value: string) => void) {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    setError("");
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(await responseMessage(response, `Request failed: ${response.status}`));
      }
      if (response.status === 204) return undefined as T;
      return response.json();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not reach the backend. Confirm FastAPI is running.";
      setError(message);
      throw error;
    }
  }
  return {
    get: <T,>(path: string) => request<T>(path),
    post: <T,>(path: string, body?: unknown) =>
      request<T>(path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
  };
}

async function fetchJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(await responseMessage(response, `Request failed: ${response.status}`));
  }
  return response.json();
}

async function responseMessage(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return fallback;
  try {
    const payload = JSON.parse(text) as { detail?: string };
    return payload.detail || fallback;
  } catch {
    return text;
  }
}

function labelForTab(tab: Tab) {
  return {
    overview: "Overview",
    runs: "Pipeline Runs",
    articles: "Article Pool",
    users: "Users",
    scheduler: "Scheduler",
  }[tab];
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

createRoot(document.getElementById("root")!).render(<App />);
