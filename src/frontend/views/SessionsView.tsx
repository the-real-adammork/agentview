import { ShortId } from "../components/ShortId";
import type { ApiError, ArchivedFilter, DiagnosticsSummary, SessionFilter, SessionSummary, ThreadSource } from "../../shared/contracts";

interface SessionsViewProps {
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  filter: SessionFilter;
  onFilterChange: (filter: SessionFilter) => void;
  sessions: SessionSummary[];
  diagnosticsByThreadId: Record<string, DiagnosticsSummary["sessionsWarningBadges"][number]>;
  isLoading: boolean;
  error: ApiError | null;
}

const numberFormatter = new Intl.NumberFormat("en-US");
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

const uniqueValues = (sessions: SessionSummary[], getValue: (session: SessionSummary) => string | null | undefined) =>
  Array.from(new Set(sessions.map(getValue).filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b),
  );

const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-US");
const shortRepo = (cwd: string) => cwd.split("/").filter(Boolean).at(-1) ?? cwd;
const repoName = (session: SessionSummary) => session.repoLabel || shortRepo(session.cwd);

function StatCell({ label, sub, tone, value }: { label: string; sub: string; tone?: "warn"; value: string | number }) {
  return (
    <div className="cell">
      <div className="l">{label}</div>
      <div className="v" data-tone={tone}>{value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

function VBars({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);

  return (
    <div className="spark" aria-hidden="true">
      {data.map((value, index) => (
        <i
          key={index}
          style={{
            height: `${Math.max(8, (value / max) * 100)}%`,
            opacity: 0.35 + 0.65 * (value / max),
          }}
        />
      ))}
    </div>
  );
}

function TokenSegBar({ value }: { value: number }) {
  const cells = Array.from({ length: 12 }, (_, index) => index < Math.round((Math.min(value, 220_000) / 220_000) * 12));

  return (
    <div className="segbar" aria-hidden="true">
      {cells.map((on, index) => (
        <i className={on ? (value > 100_000 ? "hi" : "on") : undefined} key={index} />
      ))}
    </div>
  );
}

export function SessionsView({
  activeSessionId,
  onFilterChange,
  onSelectSession,
  filter,
  sessions,
  diagnosticsByThreadId,
  isLoading,
  error,
}: SessionsViewProps) {
  const roleOptions = uniqueValues(sessions, (session) => session.agentRole);
  const modelOptions = uniqueValues(sessions, (session) => session.model);
  const repoOptions = uniqueValues(sessions, repoName);
  const updateFilter = (patch: Partial<SessionFilter>) => onFilterChange({ ...filter, ...patch });
  const activeSessions = sessions.filter((session) => !session.archived).length;
  const subagentSessions = sessions.filter((session) => session.threadSource === "subagent" || session.agentRole).length;
  const openChildren = sessions.reduce((total, session) => total + session.openChildCount, 0);
  const tokenTotal = sessions.reduce((total, session) => total + (session.tokensUsed ?? session.tokenTotal), 0);
  const latestUpdateMs = Math.max(...sessions.map((session) => Date.parse(session.updatedAt)).filter(Number.isFinite), Date.now());
  const tokensByHour = sessions.reduce(
    (buckets, session) => {
      const updatedAtMs = Date.parse(session.updatedAt);
      const hour = Number.isFinite(updatedAtMs) ? Math.min(11, Math.max(0, Math.floor((latestUpdateMs - updatedAtMs) / 3_600_000))) : 11;
      buckets[11 - hour] += session.tokensUsed ?? session.tokenTotal;
      return buckets;
    },
    Array.from({ length: 12 }, () => 0),
  );
  const selectSource = (source?: ThreadSource) => updateFilter({ threadSource: source });
  const selectArchive = (archived: ArchivedFilter) => updateFilter({ archived });

  return (
    <section className="overview" aria-labelledby="sessions-title">
      <aside className="ov-side" aria-label="Session catalog controls">
        <div className="ov-side__head">
          <div className="kicker">▸ Catalog</div>
          <h1 aria-label="Sessions" className="display" id="sessions-title">SESSION INDEX</h1>
          <div className="muted">state_5.sqlite · threads · {sessions.length} visible</div>
        </div>

        <div className="side-stat">
          <StatCell label="Active" value={activeSessions} sub="not archived" />
          <StatCell label="Sub-agents" value={subagentSessions} sub="subagent threads" />
          <StatCell label="Open child" value={openChildren} tone="warn" sub="awaiting" />
          <StatCell label="Σ Tokens" value={compactNumberFormatter.format(tokenTotal)} sub="all sessions" />
        </div>

        <div className="filter-grp">
          <div className="lbl">Token usage · last 12h</div>
          <VBars data={tokensByHour} />
          <div className="filter-grp__range">
            <span>-12H</span>
            <span>NOW</span>
          </div>
        </div>

        <form className="filter-grp sessions-filter-matrix" role="search" aria-label="Session filters" onSubmit={(event) => event.preventDefault()}>
          <div className="lbl">Thread source</div>
          <div className="row" role="group" aria-label="Thread source quick filters">
            <button className="opt" data-on={!filter.threadSource} onClick={() => selectSource()} type="button">All</button>
            <button className="opt" data-on={filter.threadSource === "user"} onClick={() => selectSource("user")} type="button">User</button>
            <button className="opt" data-on={filter.threadSource === "subagent"} onClick={() => selectSource("subagent")} type="button">Sub-agent</button>
          </div>

          <label className="field">
            <span>Source</span>
            <select
              aria-label="Source"
              value={filter.threadSource ?? ""}
              onChange={(event) =>
                updateFilter({ threadSource: event.target.value ? (event.target.value as ThreadSource) : undefined })
              }
            >
              <option value="">Any</option>
              <option value="user">User</option>
              <option value="subagent">Subagent</option>
            </select>
          </label>

          <div className="lbl">Repo</div>
          <div className="row" role="group" aria-label="Repository quick filters">
            <button className="opt" data-on={!filter.cwd} onClick={() => updateFilter({ cwd: undefined })} type="button">All</button>
            {repoOptions.slice(0, 5).map((repo) => (
              <button className="opt" data-on={filter.cwd === repo} key={repo} onClick={() => updateFilter({ cwd: repo })} type="button">
                {repo}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Role</span>
            <select
              aria-label="Role"
              value={filter.agentRole ?? ""}
              onChange={(event) => updateFilter({ agentRole: event.target.value || undefined })}
            >
              <option value="">Any</option>
              {roleOptions.map((role) => (
                <option value={role} key={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Model</span>
            <select
              aria-label="Model"
              value={filter.model ?? ""}
              onChange={(event) => updateFilter({ model: event.target.value || undefined })}
            >
              <option value="">Any</option>
              {modelOptions.map((model) => (
                <option value={model} key={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>

          <div className="lbl">Flag</div>
          <div className="row" role="group" aria-label="Archive quick filters">
            <button className="opt" data-on={(filter.archived ?? "include") === "include"} onClick={() => selectArchive("include")} type="button">Any</button>
            <button className="opt" data-on={filter.archived === "exclude"} onClick={() => selectArchive("exclude")} type="button">Active</button>
            <button className="opt" data-on={filter.archived === "only"} onClick={() => selectArchive("only")} type="button">Archived</button>
          </div>

          <label className="field">
            <span>Archived</span>
            <select
              aria-label="Archived"
              value={filter.archived ?? "include"}
              onChange={(event) => updateFilter({ archived: event.target.value as ArchivedFilter })}
            >
              <option value="include">Include</option>
              <option value="exclude">Exclude</option>
              <option value="only">Only</option>
            </select>
          </label>

          <label className="field field--numeric">
            <span>Min tokens</span>
            <input
              aria-label="Minimum tokens"
              inputMode="numeric"
              min="0"
              type="number"
              value={filter.minTokens ?? ""}
              onChange={(event) =>
                updateFilter({ minTokens: event.target.value ? Number.parseInt(event.target.value, 10) : undefined })
              }
            />
          </label>
        </form>

        <div className="ov-side__foot">
          <span>RESULTS · {sessions.length}</span>
          <span className="warn-c blink">▸ LIVE INDEX</span>
        </div>
      </aside>

      <div className="ov-main">
        <div className="ov-toolbar">
          <label className="ov-search">
            <span className="sigil">QUERY:</span>
            <input
              aria-label="Search sessions"
              placeholder="title · first user message · uuid"
              type="search"
              value={filter.search ?? ""}
              onChange={(event) => updateFilter({ search: event.target.value })}
            />
            <span className="muted">↵ exec</span>
          </label>
          <div className="chip dim">SORT · updated_at ↓</div>
          <div className="chip dim">JOIN · thread_spawn_edges</div>
          <div className="chip">PROFILE · adam@local</div>
        </div>

      {error ? (
        <div className="inline-alert" role="alert">
          {error.message}
        </div>
      ) : null}
      <div className="ov-table table-frame">
        <table aria-label="Sessions" className="tbl">
          <thead>
            <tr>
              <th aria-label="Index" scope="col"></th>
              <th scope="col">Updated</th>
              <th aria-label="Session" scope="col">Title / Brief</th>
              <th scope="col">Repo · branch</th>
              <th scope="col">Model</th>
              <th scope="col">Tokens</th>
              <th scope="col">Source</th>
              <th scope="col">Child</th>
              <th scope="col">Warn</th>
              <th aria-label="Open" scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && sessions.length === 0 ? (
              <tr>
                <td colSpan={10}>Loading sessions...</td>
              </tr>
            ) : null}
            {!isLoading && sessions.length === 0 ? (
              <tr>
                <td colSpan={10}>No sessions match the current filters.</td>
              </tr>
            ) : null}
            {sessions.map((session, index) => {
              const diagnostics = diagnosticsByThreadId[session.id];
              const tokenValue = session.tokensUsed ?? session.tokenTotal;
              const branch = session.branch || session.gitBranch || "-";
              const repo = repoName(session);
              const source = session.threadSource ?? (session.agentRole ? "subagent" : "user");
              return (
                <tr
                  aria-current={session.id === activeSessionId ? "true" : undefined}
                  className="session-row"
                  key={session.id}
                  onClick={() => onSelectSession(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectSession(session.id);
                    }
                  }}
                  tabIndex={0}
                  data-active={session.id === activeSessionId ? "true" : undefined}
                >
                  <td className="muted num">{String(index + 1).padStart(3, "0")}</td>
                  <td className="num">
                    <time dateTime={session.updatedAt}>{formatTime(session.updatedAt)}</time>
                    <div className="muted">{new Date(session.updatedAt).toLocaleDateString("en-US")}</div>
                  </td>
                  <th scope="row">
                    <span className="session-title strong">{session.title}</span>
                    <span className="session-brief arr">{session.lastMessage || session.preview || session.firstUserMessagePreview || session.titlePreview || "No preview available."}</span>
                    <ShortId value={session.id} />
                  </th>
                  <td>
                    <div>{repo}</div>
                    <div className="muted"><span className="num">{session.gitSha ?? "—"}</span> · {branch}</div>
                  </td>
                  <td>{session.model || "-"}</td>
                  <td className="numeric">
                    <div>{numberFormatter.format(tokenValue)}</div>
                    <TokenSegBar value={tokenValue} />
                  </td>
                  <td className="badge-cell">
                    <span className={source === "subagent" ? "chip amber" : "chip"}>{source === "subagent" ? `SUB · ${(session.agentRole ?? "worker").charAt(0).toUpperCase()}` : "USER"}</span>
                    <div className="muted">{session.archived ? "archived" : session.status}</div>
                  </td>
                  <td className="numeric badge-cell">
                    {session.childCount > 0 ? (
                      <>
                        <span className="strong">{session.openChildCount}/{session.childCount}</span>
                        {session.openChildCount > 0 ? <span className="warn-c"> · {session.openChildCount} open</span> : null}
                      </>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                  <td className="badge-cell">
                    {diagnostics ? (
                      <>
                        <span className="sr-only">
                          {diagnostics.warningCount} {diagnostics.warningCount === 1 ? "warning" : "warnings"}
                          {" / "}
                          {diagnostics.failedToolCount}{" "}
                          {diagnostics.failedToolCount === 1 ? "failed command" : "failed commands"}
                          {" / observed schema"}
                        </span>
                        {diagnostics.warningCount > 0 ? <span className="chip warn">▲ {diagnostics.warningCount}</span> : <span className="faint">·</span>}
                        {diagnostics.failedToolCount > 0 ? <div className="warn-c">✕ {diagnostics.failedToolCount} fail</div> : null}
                      </>
                    ) : (
                      <span className="faint">·</span>
                    )}
                  </td>
                  <td className="muted">›</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    </section>
  );
}
