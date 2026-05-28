import { useMemo, useState, type ReactNode } from "react";

import { ShortId } from "../components/ShortId";
import { LiveSessionTokens, LiveTokenTotal } from "../live/LiveTokens";
import { formatTokens } from "./formatTokens";
import { countActiveSessions, tokensByHour } from "./sessionStats";
import {
  REPO_ACTIVE_WINDOW_MS,
  buildSessionRows,
  indexSessions,
  rootOf,
  sessionRepoName,
  sessionUpdatedMs,
} from "./sessionTree";
import type { ApiError, ArchivedFilter, DiagnosticsSummary, SessionFilter, SessionSummary, ThreadSource } from "../../shared/contracts";

interface SessionsViewProps {
  activeSessionId: string;
  onSelectSession: (sessionId: string, view?: "Timeline") => void;
  filter: SessionFilter;
  onFilterChange: (filter: SessionFilter) => void;
  repoFilter?: string | null;
  onClearRepoFilter?: () => void;
  sessions: SessionSummary[];
  diagnosticsByThreadId: Record<string, DiagnosticsSummary["sessionsWarningBadges"][number]>;
  isLoading: boolean;
  error: ApiError | null;
}

const uniqueValues = (sessions: SessionSummary[], getValue: (session: SessionSummary) => string | null | undefined) =>
  Array.from(new Set(sessions.map(getValue).filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b),
  );

const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-US");

const isSubagent = (session: SessionSummary) => session.threadSource === "subagent" || Boolean(session.agentRole);

// Sub-agents are spawned with prompts that share a long generic preamble, so the
// raw title is indistinguishable between siblings. Lead with the agent's own
// identity (nickname · role) and keep its prompt as the brief line below.
const sessionTitle = (session: SessionSummary) =>
  isSubagent(session) ? `${session.agentNickname ?? "agent"} · ${session.agentRole ?? "worker"}` : session.title;

const sessionBrief = (session: SessionSummary) =>
  isSubagent(session)
    ? session.firstUserMessagePreview || session.title || session.preview || session.titlePreview || "No prompt available."
    : session.lastMessage || session.preview || session.firstUserMessagePreview || session.titlePreview || "No preview available.";

function StatCell({ label, sub, tone, value }: { label: string; sub: string; tone?: "warn"; value: ReactNode }) {
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

export function SessionsView({
  activeSessionId,
  onFilterChange,
  onSelectSession,
  filter,
  repoFilter = null,
  onClearRepoFilter,
  sessions,
  diagnosticsByThreadId,
  isLoading,
  error,
}: SessionsViewProps) {
  // Client-side branch scoping (by the root parent's branch). Only the repo +
  // search + source filters round-trip to the API; branch is a local refinement.
  const [branchFilter, setBranchFilter] = useState<string | null>(null);

  const index = useMemo(() => indexSessions(sessions), [sessions]);
  const rootRepo = (session: SessionSummary) => sessionRepoName(rootOf(session, index));
  const rootBranch = (session: SessionSummary) => {
    const root = rootOf(session, index);
    return root.gitBranch || root.branch || null;
  };

  // repoFilter (inbound from the Repos view) matches the root parent's repo so
  // sub-agents follow their owner into the dossier.
  const repoScoped = useMemo(
    () => (repoFilter ? sessions.filter((session) => rootRepo(session) === repoFilter) : sessions),
    [sessions, repoFilter, index],
  );
  const branchOptions = uniqueValues(repoScoped, rootBranch);
  const scopedSessions = useMemo(
    () => (branchFilter ? repoScoped.filter((session) => rootBranch(session) === branchFilter) : repoScoped),
    [repoScoped, branchFilter, index],
  );

  const rows = useMemo(() => buildSessionRows(scopedSessions, () => true), [scopedSessions]);

  const repoOptions = uniqueValues(sessions, sessionRepoName);
  const updateFilter = (patch: Partial<SessionFilter>) => onFilterChange({ ...filter, ...patch });
  const nowMs = Date.now();
  const activeSessions = repoFilter
    ? scopedSessions.filter((session) => nowMs - sessionUpdatedMs(session) <= REPO_ACTIVE_WINDOW_MS).length
    : countActiveSessions(scopedSessions, nowMs);
  const subagentSessions = scopedSessions.filter((session) => session.threadSource === "subagent" || session.agentRole).length;
  const openChildren = scopedSessions.reduce((total, session) => total + session.openChildCount, 0);
  const tokenTotal = scopedSessions.reduce((total, session) => total + (session.tokensUsed ?? session.tokenTotal), 0);
  const hourlyTokens = tokensByHour(scopedSessions, nowMs);
  const selectSource = (source?: ThreadSource) => updateFilter({ threadSource: source });
  const selectArchive = (archived: ArchivedFilter) => updateFilter({ archived });

  // Representative session for the dossier header (prefer a user root).
  const repoSample = repoScoped.find((session) => !session.parentId) ?? repoScoped[0];
  const repoLeaf = repoSample?.cwd.split("/").pop() ?? repoFilter ?? "—";
  const repoDir = repoSample ? `${repoSample.cwd.split("/").slice(0, -1).join("/")}/` : "";

  return (
    <section className="overview" aria-labelledby="sessions-title">
      <aside className="ov-side" aria-label="Session catalog controls">
        {repoFilter ? (
          <div className="ov-repo-head">
            <button className="ov-back" onClick={onClearRepoFilter} type="button" title="Back to Repos">
              <span className="arrow" aria-hidden="true">‹</span>
              <span>ALL REPOS</span>
            </button>
            <div className="ov-repo-name">
              <span className="parent-dir">{repoDir}</span>
              <span className="leaf">{repoLeaf}</span>
            </div>
            <div className="ov-repo-meta">
              <span>{repoSample?.gitBranch || repoSample?.branch || "—"}</span>
              {repoSample?.gitSha ? (
                <>
                  <span className="sep">·</span>
                  <span className="num">{repoSample.gitSha.slice(0, 7)}</span>
                </>
              ) : null}
              {repoSample?.gitOriginUrlPreview ? (
                <>
                  <span className="sep">·</span>
                  <span className="muted">{repoSample.gitOriginUrlPreview}</span>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="ov-side__head">
            <div className="kicker">▸ Catalog</div>
            <h1 aria-label="Sessions" className="display" id="sessions-title">SESSION INDEX</h1>
            <div className="muted">state_5.sqlite · threads · {scopedSessions.length} visible</div>
          </div>
        )}

        <div className="side-stat">
          <StatCell label="Active" value={activeSessions} sub={repoFilter ? "updated < 12h" : "updated < 1h"} />
          <StatCell label="Sub-agents" value={subagentSessions} sub="subagent threads" />
          <StatCell label="Open child" value={openChildren} tone="warn" sub="awaiting" />
          <StatCell label="Σ Tokens" value={repoFilter ? formatTokens(tokenTotal) : <LiveTokenTotal fallback={tokenTotal} />} sub={repoFilter ? "this repo" : "all sessions"} />
        </div>

        <div className="filter-grp">
          <div className="lbl">Token usage · last 12h</div>
          <VBars data={hourlyTokens} />
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

          <div className="lbl">Repo</div>
          <div className="row" role="group" aria-label="Repository quick filters">
            <button className="opt" data-on={!filter.repo} onClick={() => updateFilter({ repo: undefined })} type="button">All</button>
            {repoOptions.slice(0, 5).map((repo) => (
              <button className="opt" data-on={filter.repo === repo} key={repo} onClick={() => updateFilter({ repo })} type="button">
                {repo}
              </button>
            ))}
          </div>

          {branchOptions.length > 1 ? (
            <>
              <div className="lbl">Branch</div>
              <div className="row" role="group" aria-label="Branch quick filters">
                <button className="opt" data-on={!branchFilter} onClick={() => setBranchFilter(null)} type="button">All</button>
                {branchOptions.slice(0, 5).map((branch) => (
                  <button className="opt" data-on={branchFilter === branch} key={branch} onClick={() => setBranchFilter(branch)} type="button">
                    {branch}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="lbl">Flag</div>
          <div className="row" role="group" aria-label="Archive quick filters">
            <button className="opt" data-on={filter.archived === "include"} onClick={() => selectArchive("include")} type="button">Any</button>
            <button className="opt" data-on={(filter.archived ?? "exclude") === "exclude"} onClick={() => selectArchive("exclude")} type="button">Active</button>
            <button className="opt" data-on={filter.archived === "only"} onClick={() => selectArchive("only")} type="button">Archived</button>
          </div>
        </form>

        <div className="ov-side__foot">
          <span>RESULTS · {scopedSessions.length}</span>
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
          <div className="chip dim">TREE · thread_spawn_edges</div>
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
            {isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={10}>Loading sessions...</td>
              </tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={10}>No sessions match the current filters.</td>
              </tr>
            ) : null}
            {rows.map(({ session, depth }, index) => {
              const diagnostics = diagnosticsByThreadId[session.id];
              const tokenValue = session.tokensUsed ?? session.tokenTotal;
              const branch = session.branch || session.gitBranch || "-";
              const repo = sessionRepoName(session);
              const source = session.threadSource ?? (session.agentRole ? "subagent" : "user");
              return (
                <tr
                  aria-current={session.id === activeSessionId ? "true" : undefined}
                  className="session-row"
                  key={session.id}
                  onClick={() => onSelectSession(session.id, "Timeline")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectSession(session.id, "Timeline");
                    }
                  }}
                  tabIndex={0}
                  data-active={session.id === activeSessionId ? "true" : undefined}
                  data-depth={depth}
                >
                  <td className="muted num">{String(index + 1).padStart(3, "0")}</td>
                  <td className="num">
                    <time dateTime={session.updatedAt}>{formatTime(session.updatedAt)}</time>
                    <div className="muted">{new Date(session.updatedAt).toLocaleDateString("en-US")}</div>
                  </td>
                  <th scope="row" className={depth > 0 ? "session-cell session-cell--sub" : "session-cell"}>
                    {depth > 0 ? <span className="tree-branch" aria-hidden="true">└</span> : null}
                    <span className="session-title strong">{sessionTitle(session)}</span>
                    <span className="session-brief arr">{sessionBrief(session)}</span>
                    <ShortId value={session.id} />
                  </th>
                  <td>
                    <div>{repo}</div>
                    <div className="muted"><span className="num">{session.gitSha ?? "—"}</span> · {branch}</div>
                  </td>
                  <td>{session.model || "-"}</td>
                  <td className="numeric">
                    <LiveSessionTokens sessionId={session.id} fallback={tokenValue} live={session.status === "running"} />
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
