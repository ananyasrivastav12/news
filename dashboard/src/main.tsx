import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

type Overview = {
  total_articles: number;
  fresh_articles: number;
  fresh_completed_articles: number;
  fresh_cutoff_at: string;
  pending_summaries: number;
  completed_summaries: number;
  failed_summaries: number;
  feed_items_generated: number;
  embedded_articles: number;
  fresh_embedded_articles: number;
  users_with_feeds: number;
  users_with_interests: number;
  total_users: number;
  protected_articles: number;
  current_feed_size: number;
  article_pool_limit: number;
  max_feed_items: number;
  viewed_count: number;
  liked_count: number;
  disliked_count: number;
  saved_count: number;
  today_viewed_count: number;
  today_liked_count: number;
  today_disliked_count: number;
  today_saved_count: number;
  active_users_today: number;
  active_users_recent: number;
  newsapi_requests_planned: number;
  newsapi_page_size: number;
  newsapi_daily_target: number;
  openai_summary_calls_planned: number;
  openai_daily_summary_limit: number;
  openai_embedding_calls_planned: number;
  last_successful_run_at: string | null;
  latest_content_pipeline_at: string | null;
  latest_article_fetched_at: string | null;
  latest_article_processed_at: string | null;
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
  embedded_count: number;
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
  viewed_count: number;
  liked_count: number;
  disliked_count: number;
  saved_count: number;
  is_protected: boolean;
};

type ArticleSearchSummary = {
  total_count: number;
  completed_count: number;
  missing_image_count: number;
  with_signal_count: number;
  viewed_count: number;
  liked_count: number;
  disliked_count: number;
  saved_count: number;
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
  has_embedding_profile: boolean;
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
  article_has_embedding: boolean;
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

type Tab = "home" | "control" | "quality" | "articles" | "users";
type DateScope = "fresh" | "today" | "fetched_today" | "all" | "custom";
type Tone = "neutral" | "good" | "warn" | "bad";
type IconName = "home" | "control" | "quality" | "articles" | "users" | "signout";

const NAV_ITEMS: { id: Tab; label: string; icon: IconName }[] = [
  {
    id: "home",
    label: "Home",
    icon: "home",
  },
  {
    id: "control",
    label: "Control",
    icon: "control",
  },
  {
    id: "quality",
    label: "Quality",
    icon: "quality",
  },
  {
    id: "articles",
    label: "Articles",
    icon: "articles",
  },
  {
    id: "users",
    label: "Users",
    icon: "users",
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
        <div className="sidebar-brand">
          <div className="brand-mark">N</div>
          <div>
            <h1>News Admin</h1>
          </div>
        </div>
        <nav>
          {NAV_ITEMS.map(
            (item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
              >
                <span className="nav-icon">
                  <IconSymbol name={item.icon} />
                </span>
                <span className="nav-copy">
                  <strong>{item.label}</strong>
                </span>
              </button>
            ),
          )}
        </nav>
        <button
          className="sidebar-signout"
          onClick={() => {
            localStorage.removeItem("adminToken");
            setToken("");
          }}
          aria-label="Sign out"
          title="Sign out"
        >
          <IconSymbol name="signout" />
        </button>
      </aside>
      <main className="workspace">
        {error ? <div className="banner">{error}</div> : null}
        {tab === "home" ? <HomePage api={api} /> : null}
        {tab === "control" ? <ControlPage api={api} /> : null}
        {tab === "quality" ? <QualityPage api={api} /> : null}
        {tab === "articles" ? <ArticlesPage api={api} /> : null}
        {tab === "users" ? <UsersPage api={api} /> : null}
      </main>
    </div>
  );
}

function HomePage({ api }: { api: Api }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [distribution, setDistribution] = useState<ArticleDistribution | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<Overview>("/api/admin/overview"),
      api.get<PipelineRun[]>("/api/admin/pipeline-runs?limit=5"),
      api.get<ArticleDistribution>("/api/admin/article-distribution"),
    ])
      .then(([nextOverview, nextRuns, nextDistribution]) => {
        setOverview(nextOverview);
        setRuns(nextRuns);
        setDistribution(nextDistribution);
      })
      .catch(() => {
        setOverview(null);
        setRuns([]);
        setDistribution(null);
      })
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) return <PageTitle title="Home" />;
  if (!overview) return <EmptyState message="Overview could not be loaded." />;

  const latestRun = runs[0] ?? null;
  const warnings = buildHomeWarnings(overview, latestRun, distribution);
  const missingEmbeddings = overview.openai_embedding_calls_planned;
  const healthTone =
    latestRun?.status === "failed"
    ? "bad"
    : overview.completed_summaries === 0 || overview.pending_summaries > 0
      ? "warn"
      : "good";
  const healthLabel =
    healthTone === "bad"
      ? "Needs attention"
      : healthTone === "warn"
        ? "Needs summaries"
        : "Ready";
  const usersMissingInterests = Math.max(
    0,
    overview.total_users - overview.users_with_interests,
  );
  const todaySignals =
    overview.today_viewed_count +
    overview.today_liked_count +
    overview.today_disliked_count +
    overview.today_saved_count;
  const coverageItems = buildCoverageSummary(distribution);

  return (
    <section className="home-page">
      <PageTitle title="Home" />
      <div className={`home-hero ${healthTone}`}>
        <div>
          <span className="eyebrow">App Health</span>
          <h3>{healthLabel}</h3>
          <p>
            {overview.total_articles.toLocaleString()} retained articles,{" "}
            {overview.completed_summaries.toLocaleString()} summarized,{" "}
            {missingEmbeddings.toLocaleString()} missing embeddings.
          </p>
        </div>
      </div>
      <div className="dashboard-sections">
        <ChartPanel title="Content" className="compact-kpi-panel content-panel">
          <div className="metric-grid priority-metrics content-metrics">
            <MetricTile
              label="Current pool"
              value={overview.total_articles}
              tone={overview.total_articles > 0 ? "good" : "bad"}
            />
            <MetricTile label="Pool limit" value={overview.article_pool_limit} />
            <MetricTile
              label="Summarized"
              value={overview.completed_summaries}
              tone={overview.completed_summaries > 0 ? "good" : "bad"}
            />
            <MetricTile
              label="Pending"
              value={overview.pending_summaries}
              tone={overview.pending_summaries > 0 ? "warn" : "neutral"}
            />
            <MetricTile
              label="Missing embeddings"
              value={missingEmbeddings}
              tone={missingEmbeddings > 0 ? "warn" : "good"}
            />
            <MetricTile
              label="Protected saved"
              value={overview.protected_articles}
              tone={overview.protected_articles > 0 ? "neutral" : "good"}
            />
            <MetricTile
              label="Last pipeline"
              valueText={formatDateShort(overview.latest_content_pipeline_at)}
              className="date-metric"
              tone={overview.latest_content_pipeline_at ? "good" : "warn"}
            />
          </div>
        </ChartPanel>

        <ChartPanel title="Coverage">
          <div className="minimal-status-grid">
            {coverageItems.map((item) => (
              <StatusCard
                key={item.label}
                label={item.label}
                value={item.value}
                tone={item.tone}
              />
            ))}
          </div>
        </ChartPanel>

        <ChartPanel title="Users">
          <div className="metric-grid user-health-metrics">
            <MetricTile label="Total users" value={overview.total_users} />
            <MetricTile
              label="Active today"
              value={overview.active_users_today}
              tone={overview.active_users_today > 0 ? "good" : "neutral"}
            />
            <MetricTile
              label="Active 7d"
              value={overview.active_users_recent}
              tone={overview.active_users_recent > 0 ? "good" : "neutral"}
            />
            <MetricTile
              label="No interests"
              value={usersMissingInterests}
              tone={usersMissingInterests > 0 ? "warn" : "good"}
            />
            <MetricTile
              label="Today signals"
              value={todaySignals}
              tone={todaySignals > 0 ? "good" : "neutral"}
            />
          </div>
        </ChartPanel>

        <ChartPanel title="Attention">
          <div className="minimal-status-grid">
            {warnings.map((warning) => (
              <StatusCard
                key={warning.label}
                label={warning.label}
                value={warning.value}
                tone={warning.tone}
              />
            ))}
          </div>
        </ChartPanel>
      </div>
    </section>
  );
}

function ControlPage({ api }: { api: Api }) {
  return (
    <section className="control-page">
      <PageTitle title="Control" />
      <div className="control-console">
        <PipelineRunsSection api={api}>
          <div className="control-management-grid single">
            <UserCreatePanel api={api} />
          </div>
        </PipelineRunsSection>
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
    <ActionPanel title="Beta User">
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
    </ActionPanel>
  );
}

function PipelineRunsSection({
  api,
  children,
}: {
  api: Api;
  children: React.ReactNode;
}) {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [expandedRunIds, setExpandedRunIds] = useState<Set<number>>(new Set());
  const [showAllRuns, setShowAllRuns] = useState(false);

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
    if (label === "Content pipeline" && !window.confirm("Run the content pipeline now?")) {
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

  function toggleRunDetails(runId: number) {
    setExpandedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }

  const visibleRuns = showAllRuns ? runs : runs.slice(0, 5);

  return (
    <div className="pipeline-control-stack">
      <section className="action-panel pipeline-command-center">
        <SectionHeader title="Pipeline" />
        <div className="pipeline-actions">
          <PipelineActionCard
            title="Content pipeline"
            description="Fetch + summarize"
            tone="primary"
            busy={pendingAction === "Content pipeline"}
            disabled={pendingAction !== null}
            buttonLabel="Run"
            buttonClassName="quiet-action-button"
            onClick={() => run("/api/admin/pipeline-runs/full", "Content pipeline")}
          />
          <PipelineActionCard
            title="Ingest articles"
            description="Fetch only"
            tone="good"
            busy={pendingAction === "Ingest"}
            disabled={pendingAction !== null}
            buttonLabel="Run"
            buttonClassName="quiet-action-button"
            onClick={() => run("/api/admin/pipeline-runs/ingest", "Ingest")}
          />
          <PipelineActionCard
            title="Summarize pending"
            description="Summaries only"
            tone="warn"
            busy={pendingAction === "Summarize"}
            disabled={pendingAction !== null}
            buttonLabel="Run"
            buttonClassName="quiet-action-button"
            onClick={() => run("/api/admin/pipeline-runs/summarize", "Summarize")}
          />
        </div>
      </section>
      {actionStatus ? <InlineState message={actionStatus} tone="success" /> : null}
      {children}
      {loading ? <InlineState message="Loading runs..." /> : null}
      <ChartPanel title="Recent Runs">
        <CompactTable className="runs-table" minWidth={1120}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Source</th>
              <th>Type</th>
              <th>Status</th>
              <th>Finished</th>
              <th>Fetched</th>
              <th>Inserted</th>
              <th>Pruned</th>
              <th>Summaries</th>
              <th>Embedded</th>
              <th>Failures</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {!loading && runs.length === 0 ? (
              <tr>
                <td colSpan={12} className="empty-table-cell">
                  No pipeline runs yet.
                </td>
              </tr>
            ) : null}
            {visibleRuns.map((run) => {
              const hasDetails = Boolean(
                objectValue(run.metadata_json.ingestion) ||
                  objectValue(run.metadata_json.summarization) ||
                  objectValue(run.metadata_json.feeds) ||
                  objectValue(run.metadata_json.embeddings) ||
                  articleDistributionValue(run.metadata_json.article_distribution),
              );
              return (
                <React.Fragment key={run.id}>
                  <tr>
                    <td>{run.id}</td>
                    <td>{runSourceLabel(run)}</td>
                    <td>{run.run_type}</td>
                    <td><Badge value={run.status} /></td>
                    <td>{formatDate(run.finished_at)}</td>
                    <td>{run.fetched_count}</td>
                    <td>{run.inserted_count}</td>
                    <td>{formatOptionalNumber(runPrunedCount(run))}</td>
                    <td>{run.summarized_count}</td>
                    <td>{run.embedded_count}</td>
                    <td>{run.summary_failed_count}</td>
                    <td>
                      <button
                        className="table-action"
                        disabled={!hasDetails}
                        onClick={() => toggleRunDetails(run.id)}
                      >
                        {expandedRunIds.has(run.id) ? "Hide" : "Details"}
                      </button>
                    </td>
                  </tr>
                  {expandedRunIds.has(run.id) ? <RunDetails run={run} /> : null}
                </React.Fragment>
              );
            })}
          </tbody>
        </CompactTable>
        {runs.length > 5 ? (
          <button
            className="secondary table-footer-action"
            onClick={() => setShowAllRuns((value) => !value)}
          >
            {showAllRuns ? "Show latest 5" : `Show all ${runs.length}`}
          </button>
        ) : null}
      </ChartPanel>
    </div>
  );
}

function PipelineActionCard({
  title,
  description,
  tone,
  busy,
  disabled,
  buttonLabel,
  buttonClassName,
  onClick,
}: {
  title: string;
  description: string;
  tone: "primary" | "good" | "warn";
  busy: boolean;
  disabled: boolean;
  buttonLabel: string;
  buttonClassName?: string;
  onClick: () => void;
}) {
  return (
    <div className={`pipeline-action-card ${tone}`}>
      <div>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <ActionButton
        busy={busy}
        className={buttonClassName}
        disabled={disabled}
        onClick={onClick}
      >
        {buttonLabel}
      </ActionButton>
    </div>
  );
}

function RunDetails({ run }: { run: PipelineRun }) {
  const ingestion = objectValue(run.metadata_json.ingestion);
  const summarization = objectValue(run.metadata_json.summarization);
  const feeds = objectValue(run.metadata_json.feeds);
  const embeddings = objectValue(run.metadata_json.embeddings);
  const distribution = articleDistributionValue(run.metadata_json.article_distribution);
  if (!ingestion && !summarization && !feeds && !embeddings && !distribution) {
    return null;
  }
  return (
    <tr className="run-details-row">
      <td colSpan={12}>
        <div className="run-details">
          {ingestion ? (
            <div className="run-detail-block">
              <h4>Ingestion</h4>
              <RunBreakdown metadata={ingestion} />
            </div>
          ) : null}
          {summarization ? (
            <div className="run-detail-block">
              <h4>Summarization</h4>
              <RunSummarizationSummary metadata={summarization} />
            </div>
          ) : null}
          {feeds ? (
            <div className="run-detail-block">
              <h4>Feed Output</h4>
              <RunFeedSummary metadata={feeds} />
            </div>
          ) : null}
          {embeddings ? (
            <div className="run-detail-block">
              <h4>Embeddings</h4>
              <RunEmbeddingSummary metadata={embeddings} />
            </div>
          ) : null}
          {distribution ? (
            <div className="run-detail-block">
              <h4>Pool After Run</h4>
              <CompactDistribution distribution={distribution} />
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function RunSummarizationSummary({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <div className="compact-distribution">
      <span>{Number(metadata.processed ?? 0).toLocaleString()} summarized</span>
      <span>{Number(metadata.embedded ?? 0).toLocaleString()} embedded</span>
      <span>{Number(metadata.failed ?? 0).toLocaleString()} failed</span>
    </div>
  );
}

function RunEmbeddingSummary({ metadata }: { metadata: Record<string, unknown> }) {
  return (
    <div className="compact-distribution">
      <span>{Number(metadata.embedded ?? 0).toLocaleString()} articles embedded</span>
    </div>
  );
}

function RunFeedSummary({ metadata }: { metadata: Record<string, unknown> }) {
  if (metadata.skipped) {
    return <p>{String(metadata.reason ?? "Feed generation skipped.")}</p>;
  }
  const byEdition = objectValue(metadata.by_edition);
  return (
    <div className="compact-distribution">
      <span>{Number(metadata.feed_items ?? 0).toLocaleString()} cards</span>
      <span>{Number(metadata.users ?? 0).toLocaleString()} users</span>
      <span>{editionLabel(String(metadata.edition_type ?? "-"))}</span>
      <span>{timezoneLabel(String(metadata.market_timezone ?? "-"))}</span>
      {metadata.feed_date ? <span>{String(metadata.feed_date)}</span> : null}
      {byEdition
        ? Object.entries(byEdition).map(([edition, count]) => (
          <span key={edition}>
            {editionLabel(edition)} {Number(count ?? 0).toLocaleString()}
          </span>
        ))
        : null}
    </div>
  );
}

function RunBreakdown({ metadata }: { metadata: Record<string, unknown> }) {
  const byCountry = objectValue(metadata.by_country);
  const byCategory = objectValue(metadata.by_category);
  const byCountryCategory = objectValue(metadata.by_country_category);
  const fetched = Number(metadata.fetched ?? 0);
  const inserted = Number(metadata.inserted ?? 0);
  const pruned = Number(metadata.pruned ?? 0);
  const target = Number(metadata.target ?? 0);
  return (
    <div className="run-detail-stack">
      <div className="compact-distribution">
        <span>{fetched.toLocaleString()} fetched</span>
        <span>{inserted.toLocaleString()} inserted</span>
        <span>{pruned.toLocaleString()} pruned</span>
        {target > 0 ? <span>{target.toLocaleString()} target</span> : null}
      </div>
      <div className="run-breakdown">
        <div className="run-breakdown-item">
          <strong>Markets</strong>
          <BreakdownChips items={describeFetchInsertBreakdown(byCountry, countryLabel)} />
        </div>
        <div className="run-breakdown-item">
          <strong>Categories</strong>
          <BreakdownChips items={describeFetchInsertBreakdown(byCategory, titleCase)} />
        </div>
        <div className="run-breakdown-item wide">
          <strong>Intersections</strong>
          <BreakdownChips items={describeNestedFetchInsertBreakdown(byCountryCategory)} />
        </div>
      </div>
    </div>
  );
}

function BreakdownChips({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p>-</p>;
  }
  return (
    <div className="breakdown-chips">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
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
          {countryLabel(item.country)}: {item.completed_count.toLocaleString()} ready of{" "}
          {item.total_count.toLocaleString()}
        </span>
      ))}
      {distribution.by_country_category
        .filter((item) => item.total_count > 0)
        .slice(0, 10)
        .map((item) => (
          <span key={`${item.country}-${item.category}`}>
            {countryLabel(item.country)} {titleCase(item.category)}{" "}
            {item.completed_count.toLocaleString()} ready of{" "}
            {item.total_count.toLocaleString()}
          </span>
        ))}
    </div>
  );
}

function QualityPage({ api }: { api: Api }) {
  const [distribution, setDistribution] = useState<ArticleDistribution | null>(null);
  const [status, setStatus] = useState("");
  const [dateScope, setDateScope] = useState<DateScope>("fresh");
  const [dateFrom, setDateFrom] = useState(todayDateInput("America/New_York"));
  const [dateTo, setDateTo] = useState(todayDateInput("America/New_York"));
  const [marketTimezone, setMarketTimezone] = useState("America/New_York");
  const [loading, setLoading] = useState(true);
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);

  async function refresh() {
    const distributionParams = new URLSearchParams();
    if (status) distributionParams.set("summary_status", status);
    distributionParams.set("market_timezone", marketTimezone);
    appendDateScope(distributionParams, dateScope, dateFrom, dateTo, marketTimezone);
    setLoading(true);
    setIsApplyingFilters(true);
    try {
      const nextDistribution = await api.get<ArticleDistribution>(
        `/api/admin/article-distribution?${distributionParams}`,
      );
      setDistribution(nextDistribution);
    } catch {
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
    <section className="quality-page">
      <PageTitle title="Quality" />
      <div className="toolbar quality-filter-bar">
        <select
          value={dateScope}
          onChange={(event) => setDateScope(event.target.value as DateScope)}
        >
          <option value="fresh">Published last 7d</option>
          <option value="today">Published today</option>
          <option value="fetched_today">Fetched today</option>
          <option value="all">Current pool</option>
          <option value="custom">Published range</option>
        </select>
        {dateScope === "custom" ? (
          <>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
            <input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </>
        ) : null}
        <select
          value={marketTimezone}
          onChange={(event) => setMarketTimezone(event.target.value)}
        >
          <option value="America/New_York">NYC day</option>
          <option value="Asia/Kolkata">India day</option>
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
    </section>
  );
}

function ArticlesPage({ api }: { api: Api }) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [articleSummary, setArticleSummary] = useState<ArticleSearchSummary | null>(null);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [imageFilter, setImageFilter] = useState("");
  const [signalsFilter, setSignalsFilter] = useState("");
  const [protectedFilter, setProtectedFilter] = useState("");
  const [dateScope, setDateScope] = useState<DateScope>("fresh");
  const [dateFrom, setDateFrom] = useState(todayDateInput("America/New_York"));
  const [dateTo, setDateTo] = useState(todayDateInput("America/New_York"));
  const [marketTimezone, setMarketTimezone] = useState("America/New_York");
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);

  async function refresh(nextOffset = offset) {
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (category) params.set("category", category);
    if (status) params.set("summary_status", status);
    if (imageFilter) params.set("has_image", imageFilter);
    if (signalsFilter === "any") params.set("has_signals", "true");
    if (signalsFilter === "none") params.set("has_signals", "false");
    if (["view", "like", "skip", "save"].includes(signalsFilter)) {
      params.set("interaction_type", signalsFilter);
    }
    if (protectedFilter) params.set("is_protected", protectedFilter);
    params.set("market_timezone", marketTimezone);
    appendDateScope(params, dateScope, dateFrom, dateTo, marketTimezone);
    const sourceParams = new URLSearchParams(params);
    if (source) params.set("source", source);
    const tableParams = new URLSearchParams(params);
    tableParams.set("limit", String(limit));
    tableParams.set("offset", String(nextOffset));
    setLoading(true);
    setIsApplyingFilters(true);
    try {
      const [nextArticles, nextSummary, nextSources] = await Promise.all([
        api.get<Article[]>(`/api/admin/articles?${tableParams}`),
        api.get<ArticleSearchSummary>(`/api/admin/articles/summary?${params}`),
        api.get<string[]>(`/api/admin/articles/sources?${sourceParams}`),
      ]);
      setArticles(nextArticles);
      setArticleSummary(nextSummary);
      setSourceOptions(nextSources);
      setOffset(nextOffset);
    } catch {
      setArticles([]);
      setArticleSummary(null);
      setSourceOptions([]);
    } finally {
      setLoading(false);
      setIsApplyingFilters(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [api]);

  const totalMatches = articleSummary?.total_count ?? 0;
  const pageStart = totalMatches === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + articles.length, totalMatches);
  const canPageBack = offset > 0 && !loading;
  const canPageForward = offset + limit < totalMatches && !loading;
  const visibleSourceOptions =
    source && !sourceOptions.includes(source) ? [source, ...sourceOptions] : sourceOptions;

  return (
    <section className="articles-page">
      <PageTitle title="Articles" />
      <ChartPanel title="Current Pool" className="article-pool-panel">
        <div className="article-filter-grid compact-filter-grid">
          <label className="field-date">
            Date
            <select
              value={dateScope}
              onChange={(event) => setDateScope(event.target.value as DateScope)}
            >
              <option value="fresh">Published last 7d</option>
              <option value="today">Published today</option>
              <option value="fetched_today">Fetched today</option>
              <option value="all">Current pool</option>
              <option value="custom">Published range</option>
            </select>
          </label>
          {dateScope === "custom" ? (
            <>
              <label className="field-date-from">
                From
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </label>
              <label className="field-date-to">
                To
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label className="field-zone">
            Day zone
            <select
              value={marketTimezone}
              onChange={(event) => setMarketTimezone(event.target.value)}
            >
              <option value="America/New_York">NYC</option>
              <option value="Asia/Kolkata">India</option>
            </select>
          </label>
          <label className="field-market">
            Market
            <select value={country} onChange={(event) => setCountry(event.target.value)}>
              <option value="">All</option>
              <option value="us">US</option>
              <option value="in">India</option>
            </select>
          </label>
          <label className="field-category">
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All</option>
              {NEWS_CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {titleCase(item)}
                </option>
              ))}
            </select>
          </label>
          <label className="field-summary">
            Summary
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="field-source">
            Source
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="">All</option>
              {visibleSourceOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="field-image">
            Image
            <select
              value={imageFilter}
              onChange={(event) => setImageFilter(event.target.value)}
            >
              <option value="">All</option>
              <option value="true">Has image</option>
              <option value="false">Missing image</option>
            </select>
          </label>
          <label className="field-signals">
            User signals
            <select
              value={signalsFilter}
              onChange={(event) => setSignalsFilter(event.target.value)}
            >
              <option value="">All</option>
              <option value="any">Any signal</option>
              <option value="none">No signals</option>
              <option value="view">Viewed</option>
              <option value="like">Liked</option>
              <option value="skip">Disliked</option>
              <option value="save">Saved</option>
            </select>
          </label>
          <label className="field-protected">
            Protected
            <select
              value={protectedFilter}
              onChange={(event) => setProtectedFilter(event.target.value)}
            >
              <option value="">All</option>
              <option value="true">Protected by save</option>
              <option value="false">Not protected</option>
            </select>
          </label>
          <label className="field-rows">
            Rows
            <select
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setOffset(0);
              }}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </label>
          <div className="filter-action-cell">
            <ActionButton
              busy={isApplyingFilters}
              busyLabel="Applying..."
              onClick={() => refresh(0)}
            >
              Apply
            </ActionButton>
          </div>
        </div>
        <div className="article-inventory-summary compact-kpis">
          <MetricTile label="Matched retained" value={articleSummary?.total_count ?? 0} />
          <MetricTile label="Shown" value={articles.length} />
          <MetricTile label="Ready" value={articleSummary?.completed_count ?? 0} />
          <MetricTile label="Viewed" value={articleSummary?.viewed_count ?? 0} />
          <MetricTile label="Liked" value={articleSummary?.liked_count ?? 0} />
          <MetricTile label="Disliked" value={articleSummary?.disliked_count ?? 0} />
          <MetricTile label="Saved" value={articleSummary?.saved_count ?? 0} />
          <MetricTile
            label="Missing images"
            value={articleSummary?.missing_image_count ?? 0}
            tone={
              articleSummary && articleSummary.missing_image_count > 0
                ? "warn"
                : "neutral"
            }
          />
        </div>
      </ChartPanel>
      {loading ? <InlineState message="Loading articles..." /> : null}
      <ChartPanel title="Article List">
        <CompactTable className="article-table" minWidth={1040}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Source</th>
              <th>Market</th>
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
                <td>{countryLabel(article.country)}</td>
                <td>{titleCase(article.primary_category)}</td>
                <td>{formatDate(article.published_at)}</td>
                <td><Badge value={article.summary_status} /></td>
                <td>{article.image_present ? "Yes" : "No"}</td>
                <td>{articleSignalSummary(article)}</td>
                <td>{article.is_protected ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </CompactTable>
        <div className="pagination-bar">
          <span>
            {pageStart.toLocaleString()}-{pageEnd.toLocaleString()} of{" "}
            {totalMatches.toLocaleString()}
          </span>
          <div>
            <button
              type="button"
              className="table-action"
              disabled={!canPageBack}
              onClick={() => refresh(Math.max(0, offset - limit))}
            >
              Prev
            </button>
            <button
              type="button"
              className="table-action"
              disabled={!canPageForward}
              onClick={() => refresh(offset + limit)}
            >
              Next
            </button>
          </div>
        </div>
      </ChartPanel>
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
  const diagnostics = buildQualityDiagnostics(distribution);

  return (
    <ChartPanel
      title="Filtered Current Pool"
      meta={distributionMeta(distribution)}
    >
      <div className="quality-summary">
        <MetricTile label="Retained" value={distribution.totals.total_count} />
        <MetricTile label="Published last 7d" value={distribution.totals.fresh_count} />
        <MetricTile label="Summarized" value={distribution.totals.completed_count} />
        <MetricTile label="Pending" value={distribution.totals.pending_count} />
        <MetricTile
          label="Failed"
          value={distribution.totals.failed_count}
          tone={distribution.totals.failed_count > 0 ? "bad" : "neutral"}
        />
        <MetricTile label="Images" value={distribution.totals.image_count} />
      </div>
      <div className="quality-diagnostics">
        {diagnostics.map((item) => (
          <StatusCard
            key={item.label}
            label={item.label}
            value={item.value}
            tone={item.tone}
          />
        ))}
      </div>
      <div className="coverage-grid">
        <DistributionCompactGrid
          title="Markets"
          items={distribution.by_country.map((item) => ({
            key: item.country,
            label: countryLabel(item.country),
            counts: item,
          }))}
        />
        <DistributionCompactGrid
          title="Categories"
          items={distribution.by_category.map((item) => ({
            key: item.category,
            label: titleCase(item.category),
            counts: item,
          }))}
        />
      </div>
      <div className="matrix-wrap">
        <CompactTable className="matrix-table" minWidth={900}>
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
        </CompactTable>
      </div>
    </ChartPanel>
  );
}

function DistributionCompactGrid({
  title,
  items,
  valueLabel = "ready",
}: {
  title: string;
  items: { key: string; label: string; counts: DistributionCounts }[];
  valueLabel?: string;
}) {
  return (
    <div className="distribution-compact-grid">
      <h4>{title}</h4>
      <div>
        {items.length === 0 ? <p>No articles.</p> : null}
        {items.map((item) => (
          <StatusCard
            key={item.key}
            label={item.label}
            value={`${item.counts.completed_count} ${valueLabel}`}
            tone={item.counts.completed_count > 0 ? "good" : "warn"}
          />
        ))}
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
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const selectedFeed = useMemo(
    () =>
      feed
        .filter(
          (item) =>
            item.edition_type === rebuildEditionType &&
            item.market_timezone === rebuildTimezone,
        )
        .sort((left, right) => left.rank_position - right.rank_position),
    [feed, rebuildEditionType, rebuildTimezone],
  );
  const feedComposition = useMemo(
    () => summarizeFeedComposition(selectedFeed),
    [selectedFeed],
  );
  const feedStats = useMemo(() => summarizeSelectedFeed(selectedFeed), [selectedFeed]);
  const embeddingStats = useMemo(() => summarizeFeedEmbeddings(selectedFeed), [selectedFeed]);
  const userStats = useMemo(() => summarizeUsers(users), [users]);

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
    <section className="users-page">
      <PageTitle title="Users" />
      {loading ? <InlineState message="Loading users..." /> : null}
      <div className="user-workspace">
        <div className="user-summary-grid">
          <MetricTile label="Beta users" value={users.length} />
          <MetricTile label="With interests" value={userStats.withInterests} />
          <MetricTile label="Ever active" value={userStats.active} />
          <MetricTile label="All-time saves" value={userStats.saved} />
        </div>
        <ChartPanel title="Beta Users">
          <CompactTable className="users-table" minWidth={760}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Interests</th>
                <th>Views/Likes/Saves</th>
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
                  <td>{user.viewed_count}/{user.liked_count}/{user.saved_count}</td>
                  <td>{formatDate(user.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </CompactTable>
        </ChartPanel>
        <ChartPanel title="User Feed Inspector">
          <div className="inspector">
            <div className="inspector-toolbar">
              <strong>{selectedUser?.email ?? "Select a user"}</strong>
              <div className="inspector-controls">
                <select
                  value={rebuildEditionType}
                  onChange={(event) => setRebuildEditionType(event.target.value)}
                >
                  <option value="morning_brief">Morning</option>
                  <option value="midday_catch_up">Midday</option>
                  <option value="daily_digest">Digest</option>
                </select>
                <select
                  value={rebuildTimezone}
                  onChange={(event) => setRebuildTimezone(event.target.value)}
                >
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
            </div>
            {selectedFeedLoading ? (
              <InlineState message="Loading selected feed..." />
            ) : null}
            {selectedUser ? (
              <>
                <div className="inspector-context">
                  <div>
                    <span>Showing</span>
                    <strong>
                      {editionLabel(rebuildEditionType)} /{" "}
                      {timezoneLabel(rebuildTimezone)} only
                    </strong>
                  </div>
                  <div>
                    <span>Loaded editions</span>
                    <strong>{feed.length} cards total</strong>
                  </div>
                  <div>
                    <span>Semantic profile</span>
                    <strong>
                      {selectedUser.has_embedding_profile ? "User embedding ready" : "No user embedding"}
                    </strong>
                  </div>
                </div>
                <div className="feed-inspector-summary">
                  <MetricTile label="Selected cards" value={selectedFeed.length} />
                  <MetricTile label="Unviewed" value={feedStats.unviewed} />
                  <MetricTile label="Viewed" value={feedStats.viewed} />
                  <MetricTile label="Saved" value={feedStats.saved} />
                  <MetricTile
                    label="Duplicate titles"
                    value={feedStats.duplicateTitles}
                    tone={feedStats.duplicateTitles > 0 ? "warn" : "good"}
                  />
                  <MetricTile
                    label="User embedding"
                    valueText={selectedUser.has_embedding_profile ? "Ready" : "Missing"}
                    tone={selectedUser.has_embedding_profile ? "good" : "warn"}
                  />
                  <MetricTile
                    label="Article embeddings"
                    valueText={`${embeddingStats.ready}/${embeddingStats.total}`}
                    tone={
                      embeddingStats.ready === embeddingStats.total ? "good" : "warn"
                    }
                  />
                </div>
              </>
            ) : null}
            {selectedFeed.length > 0 ? (
              <div className="feed-composition">
                <DistributionCompactGrid
                  title="Markets"
                  valueLabel="cards"
                  items={feedComposition.countries.map((item) => ({
                    key: item.key,
                    label: countryLabel(item.key),
                    counts: compositionCounts(item.count),
                  }))}
                />
                <DistributionCompactGrid
                  title="Categories"
                  valueLabel="cards"
                  items={feedComposition.categories.map((item) => ({
                    key: item.key,
                    label: titleCase(item.key),
                    counts: compositionCounts(item.count),
                  }))}
                />
                <DistributionCompactGrid
                  title="Reasons"
                  valueLabel="cards"
                  items={feedComposition.reasons.map((item) => ({
                    key: item.key,
                    label: rankingReasonLabel(item.key),
                    counts: compositionCounts(item.count),
                  }))}
                />
              </div>
            ) : null}
            <CompactTable className="feed-table" minWidth={1120}>
              <thead>
                <tr>
                  <th>Stored rank</th>
                  <th>Market</th>
                  <th>Category</th>
                  <th>Title</th>
                  <th>Embedding</th>
                  <th>Reason</th>
                  <th>Score</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {selectedUser && !selectedFeedLoading && selectedFeed.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-table-cell">
                      No cards for this edition and timezone.
                    </td>
                  </tr>
                ) : null}
                {!selectedUser ? (
                  <tr>
                    <td colSpan={8} className="empty-table-cell">
                      Select a beta user to inspect their feed.
                    </td>
                  </tr>
                ) : null}
                {selectedFeed.map((item) => (
                  <tr
                    key={`${item.feed_date}-${item.edition_type}-${item.rank_position}-${item.article_id}`}
                  >
                    <td>{item.rank_position}</td>
                    <td>{countryLabel(item.country)}</td>
                    <td>{titleCase(item.category)}</td>
                    <td className="title-cell">{item.title}</td>
                    <td>{item.article_has_embedding ? "Ready" : "Missing"}</td>
                    <td>{rankingReasonLabel(item.ranking_reason)}</td>
                    <td>{item.score.toFixed(2)}</td>
                    <td>{feedStateLabel(item)}</td>
                  </tr>
                ))}
              </tbody>
            </CompactTable>
          </div>
        </ChartPanel>
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
  const [isScheduleFormOpen, setIsScheduleFormOpen] = useState(false);

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
      setIsScheduleFormOpen(false);
    } finally {
      setIsAddingSchedule(false);
    }
  }

  const readiness = buildEditionReadiness(schedules);

  return (
    <ActionPanel
      title="Schedules"
      subtitle=""
    >
      <div className="schedule-list">
        {loading ? <InlineState message="Loading schedules..." /> : null}
        <div className="schedule-edition-list">
          {readiness.map((edition) => (
            <ScheduleStatusRow
              key={edition.label}
              label={edition.label}
              value={edition.value}
              tone={edition.tone}
            />
          ))}
        </div>
      </div>
      {!isScheduleFormOpen ? (
        <button
          className="secondary inline-add-button"
          onClick={() => setIsScheduleFormOpen(true)}
        >
          Add schedule
        </button>
      ) : (
        <form className="schedule-create-form" onSubmit={createSchedule}>
          <label>
            Schedule name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="time-fields">
            <label>
              Hour
              <input
                type="number"
                min="0"
                max="23"
                value={hour}
                onChange={(event) => setHour(Number(event.target.value))}
              />
            </label>
            <label>
              Minute
              <input
                type="number"
                min="0"
                max="59"
                value={minute}
                onChange={(event) => setMinute(Number(event.target.value))}
              />
            </label>
          </div>
          <ActionButton type="submit" busy={isAddingSchedule} busyLabel="Adding...">
            Save
          </ActionButton>
          <button
            type="button"
            className="secondary"
            onClick={() => setIsScheduleFormOpen(false)}
          >
            Cancel
          </button>
        </form>
      )}
    </ActionPanel>
  );
}

function ScheduleStatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone: Tone;
}) {
  return (
    <div className={`schedule-status-row ${tone}`}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="page-title">
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="section-header">
      <div>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </header>
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
  className = "",
  disabled,
  type = "button",
  onClick,
}: {
  busy?: boolean;
  busyLabel?: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      className={`${className} ${busy ? "is-busy" : ""}`.trim()}
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

function MetricTile({
  label,
  value,
  valueText,
  suffix,
  className = "",
  tone = "neutral",
}: {
  label: string;
  value?: number;
  valueText?: string;
  suffix?: string;
  className?: string;
  tone?: Tone;
}) {
  return (
    <div className={`metric-tile ${tone} ${className}`.trim()}>
      <span>{label}</span>
      <strong>
        {valueText ?? value?.toLocaleString() ?? "-"}
        {suffix ? <small>{suffix}</small> : null}
      </strong>
    </div>
  );
}

function StatusCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`status-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ChartPanel({
  title,
  subtitle,
  meta,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`chart-panel ${className}`.trim()}>
      <div className="chart-panel-header">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {meta ? <span>{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function CompactTable({
  children,
  className = "",
  minWidth,
}: {
  children: React.ReactNode;
  className?: string;
  minWidth?: number;
}) {
  return (
    <div className="compact-table-wrap">
      <table
        className={`compact-table ${className}`.trim()}
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

function ActionPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="action-panel">
      <SectionHeader title={title} subtitle={subtitle} />
      {children}
    </section>
  );
}

function IconSymbol({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: (
      <>
        <path d="M3.5 10.6 12 4l8.5 6.6" />
        <path d="M5.5 9.5V20h13V9.5" />
        <path d="M9.5 20v-6h5v6" />
      </>
    ),
    control: (
      <>
        <path d="M4 7h10" />
        <path d="M18 7h2" />
        <path d="M4 17h2" />
        <path d="M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
    quality: (
      <>
        <path d="M4 18V9" />
        <path d="M10 18V5" />
        <path d="M16 18v-7" />
        <path d="M22 20H2" />
      </>
    ),
    articles: (
      <>
        <path d="M6 4h12v16H6z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
        <path d="M9 16h4" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19c.8-3.2 2.7-5 5.5-5s4.7 1.8 5.5 5" />
        <path d="M15 11.5a3 3 0 1 0 0-5.9" />
        <path d="M17 14c1.9.5 3.1 2.2 3.5 5" />
      </>
    ),
    signout: (
      <>
        <path d="M10 6H6v12h4" />
        <path d="M13 8l4 4-4 4" />
        <path d="M17 12H9" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      {paths[name]}
    </svg>
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

function summarizeSelectedFeed(feed: FeedItem[]) {
  const titleCounts = countBy(feed, (item) => item.title.trim().toLowerCase());
  return {
    viewed: feed.filter((item) => item.is_viewed).length,
    unviewed: feed.filter((item) => !item.is_viewed).length,
    saved: feed.filter((item) => item.saved).length,
    duplicateTitles: titleCounts.filter((item) => item.count > 1).length,
  };
}

function summarizeFeedEmbeddings(feed: FeedItem[]) {
  return {
    ready: feed.filter((item) => item.article_has_embedding).length,
    total: feed.length,
  };
}

function summarizeUsers(users: AdminUser[]) {
  return {
    withInterests: users.filter((user) => user.interests.length > 0).length,
    active: users.filter((user) => Boolean(user.last_active)).length,
    saved: users.reduce((total, user) => total + user.saved_count, 0),
  };
}

function buildQualityDiagnostics(distribution: ArticleDistribution) {
  const total = distribution.totals.total_count;
  const completed = distribution.totals.completed_count;
  const imageCount = distribution.totals.image_count;
  if (total === 0) {
    return [
      {
        label: "Article supply",
        value: "No articles match these filters",
        tone: "warn" as Tone,
      },
    ];
  }
  const diagnostics: { label: string; value: React.ReactNode; tone: Tone }[] = [
    {
      label: "Ready summaries",
      value: `${completed.toLocaleString()} of ${total.toLocaleString()} ready`,
      tone: completed === total ? "good" : completed > 0 ? "warn" : "bad",
    },
    {
      label: "Image coverage",
      value: `${percent(imageCount, total)} with images`,
      tone: total > 0 && imageCount / total < 0.8 ? "warn" : "good",
    },
  ];

  const zeroBuckets = importantCoverageBuckets(distribution).filter(
    (item) => item.completed_count === 0,
  );
  diagnostics.push({
    label: "Coverage gaps",
    value:
      zeroBuckets.length === 0
        ? "No priority gaps"
        : (
          <LineList
            items={zeroBuckets
              .slice(0, 3)
              .map(
                (item) => `${countryLabel(item.country)} ${titleCase(item.category)}`,
              )}
          />
        ),
    tone: zeroBuckets.length === 0 ? "good" : "warn",
  });

  const thinBuckets = importantCoverageBuckets(distribution).filter(
    (item) => item.completed_count > 0 && item.completed_count < 20,
  );
  diagnostics.push({
    label: "Thin buckets (<20)",
    value:
      thinBuckets.length === 0
        ? "All buckets have depth"
        : (
          <LineList
            items={thinBuckets
              .slice(0, 3)
              .map(
                (item) =>
                  `${countryLabel(item.country)} ${titleCase(item.category)} (${item.completed_count})`,
              )}
          />
        ),
    tone: thinBuckets.length === 0 ? "good" : "warn",
  });

  return diagnostics;
}

function distributionScopeLabel(distribution: ArticleDistribution) {
  const filters = distribution.filters;
  if (filters.fresh_only) return "Published last 7d";
  if (filters.date_field === "fetched") return "Fetched date filter";
  if (filters.date_field === "published" && filters.date_from) {
    return "Published date filter";
  }
  return "Current retained pool";
}

function distributionMeta(distribution: ArticleDistribution) {
  const label = distributionScopeLabel(distribution);
  return distribution.filters.fresh_only
    ? `${label} · Since ${formatDate(distribution.fresh_cutoff)}`
    : label;
}

function LineList({ items }: { items: string[] }) {
  return (
    <span className="line-list">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </span>
  );
}

function importantCoverageBuckets(distribution: ArticleDistribution) {
  const countries = distribution.by_country.map((item) => item.country);
  const categories = NEWS_CATEGORIES;
  return countries.flatMap((country) =>
    categories.map((category) => {
      const bucket = distribution.by_country_category.find(
        (item) => item.country === country && item.category === category,
      );
      return (
        bucket ?? {
          country,
          category,
          total_count: 0,
          fresh_count: 0,
          completed_count: 0,
          pending_count: 0,
          failed_count: 0,
          image_count: 0,
        }
      );
    }),
  );
}

function rankingReasonLabel(value: string | null) {
  if (!value) return "-";
  return titleCase(value.replaceAll("_", " ").replaceAll("-", " "));
}

function feedStateLabel(item: FeedItem) {
  const states = [item.is_viewed ? "viewed" : "unviewed"];
  if (item.liked) states.push("liked");
  if (item.disliked) states.push("disliked");
  if (item.saved) states.push("saved");
  return states.join(" · ");
}

function articleSignalSummary(article: Article) {
  const pieces = [
    article.viewed_count > 0 ? `${article.viewed_count} viewed` : null,
    article.liked_count > 0 ? `${article.liked_count} liked` : null,
    article.disliked_count > 0 ? `${article.disliked_count} disliked` : null,
    article.saved_count > 0 ? `${article.saved_count} saved` : null,
  ].filter(Boolean);
  return pieces.length ? pieces.join(" · ") : "-";
}

function appendDateScope(
  params: URLSearchParams,
  scope: DateScope,
  dateFrom: string,
  dateTo: string,
  marketTimezone: string,
) {
  if (scope === "fresh") {
    params.set("fresh_only", "true");
    return;
  }
  if (scope === "all") return;
  if (scope === "today") {
    const today = todayDateInput(marketTimezone);
    params.set("date_field", "published");
    params.set("date_from", today);
    params.set("date_to", today);
    return;
  }
  if (scope === "fetched_today") {
    const today = todayDateInput(marketTimezone);
    params.set("date_field", "fetched");
    params.set("date_from", today);
    params.set("date_to", today);
    return;
  }
  params.set("date_field", "published");
  if (dateFrom) params.set("date_from", dateFrom);
  if (dateTo) params.set("date_to", dateTo);
}

function todayDateInput(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

function buildHomeWarnings(
  overview: Overview,
  latestRun: PipelineRun | null,
  distribution: ArticleDistribution | null,
) {
  const warnings: { label: string; value: string; tone: Tone }[] = [];
  if (latestRun?.status === "failed") {
    warnings.push({
      label: "Pipeline failure",
      value: `Run #${latestRun.id} failed. Check Control for details.`,
      tone: "bad",
    });
  }
  if (overview.failed_summaries > 0) {
    warnings.push({
      label: "Summary failures",
      value: `${overview.failed_summaries.toLocaleString()} summaries failed.`,
      tone: "bad",
    });
  }
  if (overview.pending_summaries > 0) {
    warnings.push({
      label: "Pending summaries",
      value: `${overview.pending_summaries.toLocaleString()} articles are waiting for summaries.`,
      tone: "warn",
    });
  }
  if (overview.completed_summaries < overview.newsapi_daily_target) {
    warnings.push({
      label: "Current pool",
      value: `${overview.completed_summaries.toLocaleString()} summarized articles versus ${overview.newsapi_daily_target.toLocaleString()} target.`,
      tone: "warn",
    });
  }
  if (overview.openai_embedding_calls_planned > 0) {
    warnings.push({
      label: "Embeddings",
      value: `${overview.openai_embedding_calls_planned.toLocaleString()} summarized articles are missing embeddings.`,
      tone: "warn",
    });
  }
  const usersMissingInterests = overview.total_users - overview.users_with_interests;
  if (usersMissingInterests > 0) {
    warnings.push({
      label: "User setup",
      value: `${usersMissingInterests.toLocaleString()} beta users have not selected interests.`,
      tone: "warn",
    });
  }
  if (distribution) {
    const missingMarkets = distribution.by_country.filter(
      (item) => item.completed_count === 0,
    );
    if (missingMarkets.length > 0) {
      warnings.push({
        label: "Markets",
        value: `${missingMarkets.length.toLocaleString()} markets have no summarized articles.`,
        tone: "bad",
      });
    }
    const missingBuckets = importantCoverageBuckets(distribution).filter(
      (item) => item.completed_count === 0,
    );
    if (missingBuckets.length > 0) {
      warnings.push({
        label: "Coverage gaps",
        value: `${missingBuckets.length.toLocaleString()} priority gaps.`,
        tone: "warn",
      });
    }
  }
  if (warnings.length === 0) {
    warnings.push(
      {
        label: "Article supply",
        value: "Healthy",
        tone: "good",
      },
      {
        label: "Summaries",
        value: "Healthy",
        tone: "good",
      },
      {
        label: "Users",
        value: "Healthy",
        tone: "good",
      },
    );
  }
  return warnings.slice(0, 5);
}

function buildCoverageSummary(distribution: ArticleDistribution | null) {
  if (!distribution) {
    return [{ label: "Markets", value: "-", tone: "warn" as Tone }];
  }
  const zeroBuckets = importantCoverageBuckets(distribution).filter(
    (item) => item.completed_count === 0,
  );
  return [
    ...distribution.by_country.map((item) => ({
      label: countryLabel(item.country),
      value: `${item.completed_count.toLocaleString()} summarized`,
      tone: item.completed_count > 0 ? ("good" as Tone) : ("bad" as Tone),
    })),
    {
      label: "Priority gaps",
      value: zeroBuckets.length === 0 ? "None" : zeroBuckets.length.toLocaleString(),
      tone: zeroBuckets.length === 0 ? ("good" as Tone) : ("warn" as Tone),
    },
  ];
}

function buildEditionReadiness(schedules: Schedule[]) {
  return [
    editionStatus("Morning Brief", "morning", "7:00 AM", schedules),
    editionStatus("Midday Catch-Up", "midday", "4:00 PM", schedules),
    editionStatus("Daily Digest", "digest", "9:00 PM", schedules),
  ];
}

function editionStatus(
  label: string,
  keyword: string,
  expectedTime: string,
  schedules: Schedule[],
) {
  const schedule = schedules.find((item) =>
    item.name.toLowerCase().includes(keyword),
  );
  if (!schedule) {
    return {
      label,
      value: (
        <span className="edition-status-lines">
          <span>Schedule missing</span>
          <span>Expected {expectedTime}</span>
        </span>
      ),
      tone: "warn" as Tone,
    };
  }
  return {
    label,
    value: schedule.enabled
      ? (
        <span className="edition-status-lines">
          <span>
            Scheduled {pad(schedule.hour)}:{pad(schedule.minute)}
          </span>
          <span>Next {formatDate(schedule.next_run_at)}</span>
        </span>
      )
      : (
        <span className="edition-status-lines">
          <span>Paused</span>
          <span>Expected {expectedTime}</span>
        </span>
      ),
    tone: schedule.enabled ? ("good" as Tone) : ("warn" as Tone),
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

function timezoneLabel(value: string) {
  if (value === "America/New_York") return "NYC";
  if (value === "Asia/Kolkata") return "India";
  return value;
}

function describeRunOptions(metadata: Record<string, unknown>) {
  const options = metadata.options;
  const optionMap =
    options && typeof options === "object" ? (options as Record<string, unknown>) : {};
  const pieces = [
    optionMap.edition_type ? editionLabel(String(optionMap.edition_type)) : null,
    optionMap.market_timezone ? timezoneLabel(String(optionMap.market_timezone)) : null,
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
      return `${countryLabel(country)}: ${counts.fetched ?? 0} fetched, ${
        counts.inserted ?? 0
      } inserted`;
    })
    .filter(Boolean)
    .join(" · ");
}

function describeFetchInsertBreakdown(
  metadata: Record<string, unknown> | null,
  labelForKey: (key: string) => string,
) {
  if (!metadata) return [];
  const pieces = Object.entries(metadata)
    .map(([key, value]) => {
      if (!value || typeof value !== "object") return null;
      const counts = value as Record<string, unknown>;
      return `${labelForKey(key)}: ${Number(
        counts.fetched ?? 0,
      ).toLocaleString()} fetched, ${Number(counts.inserted ?? 0).toLocaleString()} inserted`;
    })
    .filter(Boolean);
  return pieces as string[];
}

function describeNestedFetchInsertBreakdown(metadata: Record<string, unknown> | null) {
  if (!metadata) return [];
  const pieces = Object.entries(metadata).flatMap(([country, categories]) => {
    if (!categories || typeof categories !== "object") return [];
    return Object.entries(categories as Record<string, unknown>)
      .map(([category, value]) => {
        if (!value || typeof value !== "object") return null;
        const counts = value as Record<string, unknown>;
        const fetched = Number(counts.fetched ?? 0);
        const inserted = Number(counts.inserted ?? 0);
        if (fetched === 0 && inserted === 0) return null;
        return `${countryLabel(country)} ${titleCase(category)}: ${fetched.toLocaleString()} fetched, ${inserted.toLocaleString()} inserted`;
      })
      .filter(Boolean);
  });
  return pieces as string[];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function runSourceLabel(run: PipelineRun) {
  const source = run.metadata_json.source;
  if (source === "scheduled") return "Scheduled";
  if (source === "task") return "Task";
  return "Dashboard";
}

function runPrunedCount(run: PipelineRun) {
  const ingestion = objectValue(run.metadata_json.ingestion);
  if (!ingestion || ingestion.pruned === undefined || ingestion.pruned === null) {
    return null;
  }
  return Number(ingestion.pruned);
}

function formatOptionalNumber(value: number | null) {
  return value === null || Number.isNaN(value) ? "-" : value.toLocaleString();
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

function formatDateShort(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
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
