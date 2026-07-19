import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type Overview = {
  total_articles: number;
  fresh_articles: number;
  pending_summaries: number;
  completed_summaries: number;
  failed_summaries: number;
  feed_items_generated: number;
  users_with_feeds: number;
  total_users: number;
  current_feed_size: number;
  article_pool_limit: number;
  max_feed_items: number;
  viewed_count: number;
  liked_count: number;
  disliked_count: number;
  saved_count: number;
  newsapi_requests_planned: number;
  newsapi_page_size: number;
  newsapi_daily_target: number;
  openai_summary_calls_planned: number;
  openai_daily_summary_limit: number;
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
  metadata_json: Record<string, unknown>;
  logs: { id: number; level: string; message: string; created_at: string | null }[];
};

type PipelineRunQueued = {
  id: number;
  status: string;
  message: string;
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

type DistributionCounts = {
  total_count: number;
  fresh_count: number;
  completed_count: number;
  pending_count: number;
  failed_count: number;
  image_count: number;
};

type CountryDistribution = DistributionCounts & {
  country: string;
};

type CategoryDistribution = DistributionCounts & {
  category: string;
};

type CountryCategoryDistribution = DistributionCounts & {
  country: string;
  category: string;
};

type ArticleDistribution = {
  generated_at: string;
  fresh_cutoff: string;
  filters: Record<string, unknown>;
  totals: DistributionCounts;
  by_country: CountryDistribution[];
  by_category: CategoryDistribution[];
  by_country_category: CountryCategoryDistribution[];
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
  feed_date: string;
  edition_type: string;
  market_timezone: string;
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

type AdminUserCreated = {
  id: number;
  email: string;
  interests: string[];
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

type Tab = "home" | "control" | "quality" | "users";

const NAV_ITEMS: { id: Tab; label: string; description: string }[] = [
  {
    id: "home",
    label: "Home",
    description: "Readiness and system health",
  },
  {
    id: "control",
    label: "Control",
    description: "Run jobs, users, and schedules",
  },
  {
    id: "quality",
    label: "Quality",
    description: "Article pool diagnostics",
  },
  {
    id: "users",
    label: "Users",
    description: "Beta users and feed inspection",
  },
];

const NEWS_CATEGORIES = [
  "business",
  "technology",
  "health",
  "sports",
  "entertainment",
  "science",
  "general",
];

function App() {
  const [token, setToken] = useState(localStorage.getItem("adminToken") ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<Tab>("home");
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
          <p>Feed operations</p>
        </div>
        <nav>
          {NAV_ITEMS.map(
            (item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
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
        {tab === "home" ? <HomePage api={api} /> : null}
        {tab === "control" ? <ControlPage api={api} /> : null}
        {tab === "quality" ? <QualityPage api={api} /> : null}
        {tab === "users" ? <UsersPage api={api} /> : null}
      </main>
    </div>
  );
}

function HomePage({ api }: { api: Api }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRunningPipeline, setIsRunningPipeline] = useState(false);
  const [actionStatus, setActionStatus] = useState("");

  useEffect(() => {
    setLoading(true);
    api
      .get<Overview>("/api/admin/overview")
      .then(setOverview)
      .catch(() => setOverview(null))
      .finally(() => setLoading(false));
  }, [api]);

  async function runFullPipeline() {
    const confirmed = window.confirm(
      "Run the full pipeline now? This may spend NewsAPI and OpenAI quota."
    );
    if (!confirmed) return;
    setIsRunningPipeline(true);
    setActionStatus("");
    try {
      const queued = await api.post<PipelineRunQueued>("/api/admin/pipeline-runs/full");
      setActionStatus(`Full pipeline queued as run #${queued.id}. Check Pipeline Runs for progress.`);
      setOverview(await api.get<Overview>("/api/admin/overview"));
    } finally {
      setIsRunningPipeline(false);
    }
  }

  if (loading) return <PageTitle title="Home" subtitle="Loading..." />;
  if (!overview) return <EmptyState message="Overview could not be loaded." />;

  return (
    <section>
      <PageTitle title="Home" subtitle="Readiness, freshness, and system health." />
      <div className="home-hero">
        <div>
          <span className="eyebrow">Current State</span>
          <h3>{overview.failed_summaries > 0 ? "Needs review" : "System ready"}</h3>
          <p>
            {overview.fresh_articles.toLocaleString()} fresh articles,{" "}
            {overview.completed_summaries.toLocaleString()} completed summaries, and{" "}
            {overview.total_users.toLocaleString()} beta users.
          </p>
        </div>
        <ActionButton
          busy={isRunningPipeline}
          busyLabel="Queueing..."
          onClick={runFullPipeline}
        >
          Run full pipeline
        </ActionButton>
      </div>
      {actionStatus ? <InlineState message={actionStatus} tone="success" /> : null}
      <div className="metric-grid">
        <Metric label="Total articles" value={overview.total_articles} />
        <Metric label="Fresh articles" value={overview.fresh_articles} />
        <Metric label="Pending summaries" value={overview.pending_summaries} />
        <Metric label="Completed summaries" value={overview.completed_summaries} />
        <Metric label="Failed summaries" value={overview.failed_summaries} tone="bad" />
        <Metric label="Feed items" value={overview.feed_items_generated} />
        <Metric label="Users with feeds" value={overview.users_with_feeds} />
        <Metric label="Target feed size" value={overview.current_feed_size} />
        <Metric label="Article pool limit" value={overview.article_pool_limit} />
        <Metric label="Max feed rows/user" value={overview.max_feed_items} />
        <Metric label="NewsAPI planned" value={overview.newsapi_requests_planned} />
        <Metric label="NewsAPI page size" value={overview.newsapi_page_size} />
        <Metric label="Daily target" value={overview.newsapi_daily_target} />
        <Metric label="Summary calls planned" value={overview.openai_summary_calls_planned} />
        <Metric label="OpenAI summary limit" value={overview.openai_daily_summary_limit} />
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

function ControlPage({ api }: { api: Api }) {
  return (
    <section>
      <PageTitle title="Control" subtitle="Run jobs, add beta users, and manage schedules." />
      <div className="control-layout">
        <PipelineRunsSection api={api} />
        <div className="control-side">
          <UserCreatePanel api={api} />
          <SchedulerPanel api={api} />
        </div>
      </div>
    </section>
  );
}

function UserCreatePanel({ api }: { api: Api }) {
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [createStatus, setCreateStatus] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setIsCreatingUser(true);
    setCreateStatus("");
    try {
      const created = await api.post<AdminUserCreated>("/api/admin/users", {
        email: newUserEmail.trim(),
        password: newUserPassword,
      });
      setCreateStatus(`Created ${created.email}. They can now log into the app.`);
      setNewUserEmail("");
      setNewUserPassword("");
    } finally {
      setIsCreatingUser(false);
    }
  }

  return (
    <section className="workspace-card">
      <SectionHeader
        title="Beta Access"
        subtitle="Create a login. Users choose their own interests in the app."
      />
      <form className="panel-form stacked-form" onSubmit={createUser}>
        <label>
          Beta email
          <input
            type="email"
            value={newUserEmail}
            onChange={(event) => setNewUserEmail(event.target.value)}
            placeholder="reader@example.com"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength={8}
            value={newUserPassword}
            onChange={(event) => setNewUserPassword(event.target.value)}
            placeholder="At least 8 characters"
            required
          />
        </label>
        <ActionButton type="submit" busy={isCreatingUser} busyLabel="Creating...">
          Create beta user
        </ActionButton>
      </form>
      {createStatus ? <InlineState message={createStatus} tone="success" /> : null}
    </section>
  );
}

function PipelineRunsSection({ api }: { api: Api }) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");

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

  async function run(path: string, label: string, body?: unknown) {
    if (
      label === "Full pipeline" &&
      !window.confirm("Run the full pipeline now? This may spend NewsAPI and OpenAI quota.")
    ) {
      return;
    }
    setPendingAction(label);
    setActionStatus("");
    try {
      const queued = await api.post<PipelineRunQueued>(path, body);
      setActionStatus(`${label} queued as run #${queued.id}.`);
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="workspace-card">
      <SectionHeader
        title="Article Pipeline"
        subtitle="Refresh the shared article pool. Feeds are still ranked lazily per user."
      />
      <div className="toolbar">
        <ActionButton
          busy={pendingAction === "Full pipeline"}
          disabled={pendingAction !== null}
          onClick={() => run("/api/admin/pipeline-runs/full", "Full pipeline")}
        >
          Refresh article pool
        </ActionButton>
        <ActionButton
          busy={pendingAction === "Ingest"}
          disabled={pendingAction !== null}
          onClick={() => run("/api/admin/pipeline-runs/ingest", "Ingest")}
        >
          Ingest
        </ActionButton>
        <ActionButton
          busy={pendingAction === "Summarize"}
          disabled={pendingAction !== null}
          onClick={() => run("/api/admin/pipeline-runs/summarize", "Summarize")}
        >
          Summarize
        </ActionButton>
      </div>
      {actionStatus ? <InlineState message={actionStatus} tone="success" /> : null}
      {loading ? <InlineState message="Loading runs..." /> : null}
      <RunLegend />
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
            <th>Options</th>
            <th>Finished</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <React.Fragment key={run.id}>
              <tr>
                <td>{run.id}</td>
                <td>{run.run_type}</td>
                <td><Badge value={run.status} /></td>
                <td>{run.duration_seconds ? `${run.duration_seconds.toFixed(1)}s` : "-"}</td>
                <td>{run.fetched_count}</td>
                <td>{run.inserted_count}</td>
                <td>{run.summarized_count}</td>
                <td>{run.summary_failed_count}</td>
                <td>{run.feed_items_count}</td>
                <td>{describeRunOptions(run.metadata_json)}</td>
                <td>{formatDate(run.finished_at)}</td>
              </tr>
              <RunDetails run={run} />
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RunDetails({ run }: { run: PipelineRun }) {
  const ingestion = objectValue(run.metadata_json.ingestion);
  const distribution = articleDistributionValue(run.metadata_json.article_distribution);
  if (!ingestion && !distribution) {
    return null;
  }
  return (
    <tr className="run-details-row">
      <td colSpan={11}>
        <div className="run-details">
          {ingestion ? (
            <div>
              <h4>Inserted This Run</h4>
              <RunBreakdown metadata={ingestion} />
            </div>
          ) : null}
          {distribution ? (
            <div>
              <h4>Pool After Run</h4>
              <CompactDistribution distribution={distribution} />
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function RunBreakdown({ metadata }: { metadata: Record<string, unknown> }) {
  const byCountry = objectValue(metadata.by_country);
  const byCategory = objectValue(metadata.by_category);
  const byCountryCategory = objectValue(metadata.by_country_category);
  return (
    <div className="run-breakdown">
      <div>
        <strong>Markets</strong>
        <p>{describeFetchInsertBreakdown(byCountry)}</p>
      </div>
      <div>
        <strong>Categories</strong>
        <p>{describeFetchInsertBreakdown(byCategory)}</p>
      </div>
      <div>
        <strong>Intersections</strong>
        <p>{describeNestedFetchInsertBreakdown(byCountryCategory)}</p>
      </div>
    </div>
  );
}

function CompactDistribution({
  distribution,
}: {
  distribution: ArticleDistribution;
}) {
  return (
    <div className="compact-distribution">
      {distribution.by_country.map((item) => (
        <span key={item.country}>
          {countryLabel(item.country)} {item.completed_count}/{item.total_count} ready
        </span>
      ))}
      {distribution.by_country_category
        .filter((item) => item.total_count > 0)
        .slice(0, 10)
        .map((item) => (
          <span key={`${item.country}-${item.category}`}>
            {countryLabel(item.country)} {titleCase(item.category)}{" "}
            {item.completed_count}/{item.total_count}
          </span>
        ))}
    </div>
  );
}

function QualityPage({ api }: { api: Api }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [distribution, setDistribution] = useState<ArticleDistribution | null>(null);
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);

  async function refresh() {
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (category) params.set("category", category);
    if (status) params.set("summary_status", status);
    const distributionParams = new URLSearchParams();
    if (status) distributionParams.set("summary_status", status);
    setLoading(true);
    setIsApplyingFilters(true);
    try {
      const [nextArticles, nextDistribution] = await Promise.all([
        api.get<Article[]>(`/api/admin/articles?${params}`),
        api.get<ArticleDistribution>(
          `/api/admin/article-distribution?${distributionParams}`,
        ),
      ]);
      setArticles(nextArticles);
      setDistribution(nextDistribution);
    } catch {
      setArticles([]);
      setDistribution(null);
    } finally {
      setLoading(false);
      setIsApplyingFilters(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  return (
    <section>
      <PageTitle title="Quality" subtitle="Article pool diagnostics and feed input coverage." />
      <div className="toolbar">
        <select value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="">All countries</option>
          <option value="us">US</option>
          <option value="in">India</option>
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">All categories</option>
          {NEWS_CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {titleCase(item)}
            </option>
          ))}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All summaries</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <ActionButton busy={isApplyingFilters} busyLabel="Applying..." onClick={refresh}>
          Apply filters
        </ActionButton>
      </div>
      {loading ? <InlineState message="Loading articles..." /> : null}
      {distribution ? <ArticleDistributionPanel distribution={distribution} /> : null}
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
          {!loading && articles.length === 0 ? (
            <tr>
              <td colSpan={9} className="empty-table-cell">
                No articles match these filters.
              </td>
            </tr>
          ) : null}
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

function ArticleDistributionPanel({
  distribution,
}: {
  distribution: ArticleDistribution;
}) {
  const countries = distribution.by_country.map((item) => item.country).sort();
  const categories = Array.from(
    new Set([
      ...NEWS_CATEGORIES,
      ...distribution.by_category.map((item) => item.category),
    ]),
  );

  return (
    <div className="quality-panel">
      <div className="quality-header">
        <div>
          <h3>Feed Quality Observability</h3>
          <p>
            Pool snapshot by market, category, and market-category intersection.
          </p>
        </div>
        <span>Fresh since {formatDate(distribution.fresh_cutoff)}</span>
      </div>
      <div className="quality-summary">
        <Metric label="Pool articles" value={distribution.totals.total_count} />
        <Metric label="Fresh" value={distribution.totals.fresh_count} />
        <Metric label="Completed" value={distribution.totals.completed_count} />
        <Metric label="Pending" value={distribution.totals.pending_count} />
        <Metric label="Failed" value={distribution.totals.failed_count} tone="bad" />
        <Metric label="Images" value={distribution.totals.image_count} />
      </div>
      <div className="quality-grid">
        <DistributionList
          title="Markets"
          items={distribution.by_country.map((item) => ({
            key: item.country,
            label: countryLabel(item.country),
            counts: item,
          }))}
        />
        <DistributionList
          title="Categories"
          items={distribution.by_category.map((item) => ({
            key: item.category,
            label: titleCase(item.category),
            counts: item,
          }))}
        />
      </div>
      <div className="matrix-wrap">
        <table className="matrix-table">
          <thead>
            <tr>
              <th>Market</th>
              {categories.map((category) => (
                <th key={category}>{titleCase(category)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {countries.map((country) => (
              <tr key={country}>
                <th>{countryLabel(country)}</th>
                {categories.map((category) => {
                  const bucket = distribution.by_country_category.find(
                    (item) => item.country === country && item.category === category,
                  );
                  return (
                    <td
                      key={`${country}-${category}`}
                      className={bucket?.completed_count ? "" : "low-count-cell"}
                    >
                      {bucket ? (
                        <>
                          <strong>{bucket.total_count}</strong>
                          <span>{bucket.completed_count} ready</span>
                        </>
                      ) : (
                        <span>0 ready</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DistributionList({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; counts: DistributionCounts }[];
}) {
  return (
    <div className="distribution-list">
      <h4>{title}</h4>
      {items.length === 0 ? <p>No articles.</p> : null}
      {items.map((item) => (
        <div key={item.key} className="distribution-row">
          <div>
            <strong>{item.label}</strong>
            <span>
              {item.counts.completed_count} ready · {item.counts.pending_count} pending
            </span>
          </div>
          <div className="distribution-counts">
            <strong>{item.counts.total_count}</strong>
            <span>{percent(item.counts.completed_count, item.counts.total_count)} ready</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function UsersPage({ api }: { api: Api }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFeedLoading, setSelectedFeedLoading] = useState(false);
  const [isRebuildingFeed, setIsRebuildingFeed] = useState(false);
  const [rebuildEditionType, setRebuildEditionType] = useState("morning_brief");
  const [rebuildTimezone, setRebuildTimezone] = useState("America/New_York");
  const feedComposition = useMemo(() => summarizeFeedComposition(feed), [feed]);

  async function refreshUsers() {
    setLoading(true);
    try {
      setUsers(await api.get<AdminUser[]>("/api/admin/users"));
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshUsers();
  }, [api]);

  async function inspect(userId: number) {
    setSelectedUserId(userId);
    setSelectedFeedLoading(true);
    try {
      setFeed(await api.get<FeedItem[]>(`/api/admin/users/${userId}/feed`));
    } finally {
      setSelectedFeedLoading(false);
    }
  }

  async function rebuild() {
    if (!selectedUserId) return;
    setIsRebuildingFeed(true);
    try {
      const params = new URLSearchParams({
        edition_type: rebuildEditionType,
        market_timezone: rebuildTimezone,
      });
      await api.post(`/api/admin/users/${selectedUserId}/rebuild-feed?${params}`);
      await inspect(selectedUserId);
      await refreshUsers();
    } finally {
      setIsRebuildingFeed(false);
    }
  }

  return (
    <section>
      <PageTitle title="Users" subtitle="Beta user list and per-user feed inspection." />
      {loading ? <InlineState message="Loading users..." /> : null}
      <div className="user-workspace">
        <div className="table-panel">
          <table className="users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Interests</th>
                <th>Feed rows</th>
                <th>Signals</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className={selectedUserId === user.id ? "selected-row" : ""}
                  onClick={() => inspect(user.id)}
                >
                  <td>{user.email}</td>
                  <td>{user.interests.join(", ") || "Not selected yet"}</td>
                  <td>{user.feed_count}</td>
                  <td>{user.viewed_count}/{user.liked_count}/{user.saved_count}</td>
                  <td>{formatDate(user.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="inspector panel">
          <div className="toolbar compact">
            <strong>
              {selectedUserId
                ? `Feed Inspector: ${users.find((user) => user.id === selectedUserId)?.email ?? ""}`
                : "Feed Inspector"}
            </strong>
            <select value={rebuildEditionType} onChange={(event) => setRebuildEditionType(event.target.value)}>
              <option value="morning_brief">Morning</option>
              <option value="midday_catch_up">Midday</option>
              <option value="daily_digest">Digest</option>
            </select>
            <select value={rebuildTimezone} onChange={(event) => setRebuildTimezone(event.target.value)}>
              <option value="America/New_York">NYC</option>
              <option value="Asia/Kolkata">India</option>
            </select>
            <ActionButton
              busy={isRebuildingFeed}
              busyLabel="Rebuilding..."
              disabled={!selectedUserId}
              onClick={rebuild}
            >
              Rebuild feed
            </ActionButton>
          </div>
          {selectedFeedLoading ? <InlineState message="Loading selected feed..." /> : null}
          {feed.length > 0 ? (
            <div className="feed-composition">
              <DistributionList
                title="Feed Markets"
                items={feedComposition.countries.map((item) => ({
                  key: item.key,
                  label: countryLabel(item.key),
                  counts: compositionCounts(item.count),
                }))}
              />
              <DistributionList
                title="Feed Categories"
                items={feedComposition.categories.map((item) => ({
                  key: item.key,
                  label: titleCase(item.key),
                  counts: compositionCounts(item.count),
                }))}
              />
              <DistributionList
                title="Ranking Reasons"
                items={feedComposition.reasons.map((item) => ({
                  key: item.key,
                  label: titleCase(item.key.replaceAll("_", " ")),
                  counts: compositionCounts(item.count),
                }))}
              />
            </div>
          ) : null}
          <table className="feed-table">
            <thead>
              <tr>
                <th>Edition</th>
                <th>Rank</th>
                <th>Title</th>
                <th>Reason</th>
                <th>Score</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {feed.map((item) => (
                <tr key={`${item.feed_date}-${item.edition_type}-${item.rank_position}-${item.article_id}`}>
                  <td>{editionLabel(item.edition_type)} · {item.market_timezone}</td>
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

function SchedulerPanel({ api }: { api: Api }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [name, setName] = useState("Morning full pipeline");
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isAddingSchedule, setIsAddingSchedule] = useState(false);

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
    setIsAddingSchedule(true);
    try {
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
    } finally {
      setIsAddingSchedule(false);
    }
  }

  return (
    <section className="workspace-card">
      <SectionHeader
        title="Scheduler"
        subtitle="Backend schedule configuration for recurring jobs."
      />
      <form className="toolbar schedule-form" onSubmit={createSchedule}>
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
        <ActionButton type="submit" busy={isAddingSchedule} busyLabel="Adding...">
          Add schedule
        </ActionButton>
      </form>
      {loading ? <InlineState message="Loading schedules..." /> : null}
      <table className="compact-table">
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

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="section-header">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

function RunLegend() {
  return (
    <div className="legend-grid">
      <InlineState message="Fetched: raw articles returned by NewsAPI." />
      <InlineState message="Inserted: new articles after validation and dedupe." />
      <InlineState message="Summaries: articles summarized in this run." />
      <InlineState message="Feeds are ranked per user when the mobile app loads." />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

function InlineState({ message, tone }: { message: string; tone?: "success" }) {
  return <div className={`inline-state ${tone ?? ""}`}>{message}</div>;
}

function ActionButton({
  busy,
  busyLabel = "Working...",
  children,
  disabled,
  type = "button",
  onClick,
}: {
  busy?: boolean;
  busyLabel?: string;
  children: React.ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      className={busy ? "is-busy" : ""}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
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

function summarizeFeedComposition(feed: FeedItem[]) {
  return {
    countries: countBy(feed, (item) => item.country),
    categories: countBy(feed, (item) => item.category),
    reasons: countBy(feed, (item) => item.ranking_reason ?? "unknown"),
  };
}

function countBy<T>(items: T[], keyForItem: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyForItem(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function compositionCounts(count: number): DistributionCounts {
  return {
    total_count: count,
    fresh_count: 0,
    completed_count: count,
    pending_count: 0,
    failed_count: 0,
    image_count: 0,
  };
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

function editionLabel(value: string) {
  if (value === "morning_brief") return "Morning";
  if (value === "midday_catch_up") return "Midday";
  if (value === "daily_digest") return "Digest";
  if (value === "all") return "All editions";
  return value;
}

function describeRunOptions(metadata: Record<string, unknown>) {
  const options = metadata.options;
  const optionMap =
    options && typeof options === "object" ? (options as Record<string, unknown>) : {};
  const pieces = [
    optionMap.edition_type ? editionLabel(String(optionMap.edition_type)) : null,
    optionMap.market_timezone ? String(optionMap.market_timezone) : null,
    optionMap.feed_date ? String(optionMap.feed_date) : null,
    optionMap.run_ingestion_first ? "fetch first" : null,
    optionMap.summarize_first ? "summarize first" : null,
  ].filter(Boolean);
  const ingestion = metadata.ingestion;
  if (ingestion && typeof ingestion === "object") {
    const byCountry = (ingestion as Record<string, unknown>).by_country;
    if (byCountry && typeof byCountry === "object") {
      pieces.push(describeCountryBreakdown(byCountry as Record<string, unknown>));
    }
  }
  return pieces.length ? pieces.join(" · ") : "-";
}

function describeCountryBreakdown(byCountry: Record<string, unknown>) {
  return Object.entries(byCountry)
    .map(([country, value]) => {
      if (!value || typeof value !== "object") return null;
      const counts = value as Record<string, unknown>;
      return `${country.toUpperCase()}: ${counts.fetched ?? 0} fetched, ${
        counts.inserted ?? 0
      } inserted`;
    })
    .filter(Boolean)
    .join(" · ");
}

function describeFetchInsertBreakdown(metadata: Record<string, unknown> | null) {
  if (!metadata) return "-";
  const pieces = Object.entries(metadata)
    .map(([key, value]) => {
      if (!value || typeof value !== "object") return null;
      const counts = value as Record<string, unknown>;
      return `${titleCase(key)} ${counts.fetched ?? 0}/${counts.inserted ?? 0}`;
    })
    .filter(Boolean);
  return pieces.length ? pieces.join(" · ") : "-";
}

function describeNestedFetchInsertBreakdown(metadata: Record<string, unknown> | null) {
  if (!metadata) return "-";
  const pieces = Object.entries(metadata).flatMap(([country, categories]) => {
    if (!categories || typeof categories !== "object") return [];
    return Object.entries(categories as Record<string, unknown>)
      .map(([category, value]) => {
        if (!value || typeof value !== "object") return null;
        const counts = value as Record<string, unknown>;
        const fetched = Number(counts.fetched ?? 0);
        const inserted = Number(counts.inserted ?? 0);
        if (fetched === 0 && inserted === 0) return null;
        return `${countryLabel(country)} ${titleCase(category)} ${fetched}/${inserted}`;
      })
      .filter(Boolean);
  });
  return pieces.length ? pieces.join(" · ") : "-";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function articleDistributionValue(value: unknown): ArticleDistribution | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ArticleDistribution>;
  if (!candidate.totals || !candidate.by_country || !candidate.by_country_category) {
    return null;
  }
  return candidate as ArticleDistribution;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function titleCase(value: string) {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function countryLabel(value: string) {
  if (value.toLowerCase() === "us") return "US";
  if (value.toLowerCase() === "in") return "India";
  return value.toUpperCase();
}

function percent(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

createRoot(document.getElementById("root")!).render(<App />);
