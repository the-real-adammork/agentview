import { useMemo } from "react";

import type { SessionSummary } from "../../shared/contracts";
import { formatTokens } from "./formatTokens";
import { type RepoGroup, type RepoRoot, groupSessionsByRepo, sessionUpdatedMs } from "./sessionTree";

interface ReposViewProps {
  sessions: SessionSummary[];
  onOpenRepo: (repoName: string) => void;
  onSelectSession: (sessionId: string) => void;
}

const pad2 = (value: number) => String(value).padStart(2, "0");

const ago = (ms: number, nowMs: number) => {
  const minutes = Math.max(0, Math.round((nowMs - ms) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
};

const sessionTokens = (session: SessionSummary) => session.tokensUsed ?? session.tokenTotal ?? 0;
const roleInitial = (session: SessionSummary) => (session.agentRole ?? "worker").charAt(0).toUpperCase() || "W";

function SubChip({ sub, nowMs, onSelectSession }: { sub: SessionSummary; nowMs: number; onSelectSession: (id: string) => void }) {
  const isOpen = sub.openChildCount > 0;
  return (
    <button
      className="sub-chip"
      data-status={isOpen ? "open" : "closed"}
      onClick={(event) => {
        event.stopPropagation();
        onSelectSession(sub.id);
      }}
      title={`${sub.agentNickname ?? "agent"} · ${sub.agentRole ?? "worker"} · ${formatTokens(sessionTokens(sub))} tok · ${ago(sessionUpdatedMs(sub), nowMs)} ago`}
      type="button"
    >
      <span className="sub-chip-tab" aria-hidden="true" />
      <span className="sub-chip-nick">{sub.agentNickname ?? "agent"}</span>
      <span className="sub-chip-role">{roleInitial(sub)}</span>
      <span className="sub-chip-tok num">{formatTokens(sessionTokens(sub))}</span>
      {isOpen ? <span className="sub-chip-dot" aria-label="open" /> : null}
    </button>
  );
}

function RepoTreeRow({
  repoRoot,
  nowMs,
  onSelectSession,
}: {
  repoRoot: RepoRoot;
  nowMs: number;
  onSelectSession: (id: string) => void;
}) {
  const { root, subs } = repoRoot;
  return (
    <div className="repo-tree-row">
      <div
        className="repo-row repo-row-parent"
        onClick={(event) => {
          event.stopPropagation();
          onSelectSession(root.id);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectSession(root.id);
          }
        }}
      >
        <span className="repo-row-bullet" aria-hidden="true">▸</span>
        <div className="repo-row-body">
          <div className="repo-row-title">{root.title}</div>
          <div className="repo-row-meta">
            <span className="chip">USER · ROOT</span>
            <span className="num">{formatTokens(sessionTokens(root))}</span>
            <span className="muted">·</span>
            <span className="muted num">{ago(sessionUpdatedMs(root), nowMs)} ago</span>
            {(root.warningCount ?? 0) > 0 ? <span className="chip warn">▲ {root.warningCount}</span> : null}
          </div>
        </div>
      </div>
      {subs.length > 0 ? (
        <div className="repo-subs-row">
          {subs.map((sub) => (
            <SubChip key={sub.id} sub={sub} nowMs={nowMs} onSelectSession={onSelectSession} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RepoCard({
  group,
  nowMs,
  onOpenRepo,
  onSelectSession,
}: {
  group: RepoGroup;
  nowMs: number;
  onOpenRepo: (repoName: string) => void;
  onSelectSession: (id: string) => void;
}) {
  const parentDir = group.cwd.split("/").slice(0, -1).join("/") + "/";
  const leaf = group.cwd.split("/").pop() || group.repoName;
  const open = () => onOpenRepo(group.repoName);

  return (
    <article className="repo-card" data-has-active={group.active.length > 0}>
      <header className="repo-card-head" onClick={open}>
        <div className="repo-tab" aria-hidden="true" />
        <div className="repo-id">
          <div className="repo-name">
            <span className="parent-dir">{parentDir}</span>
            <span className="leaf">{leaf}</span>
          </div>
          <div className="repo-branch">
            <span>{group.branch ?? "—"}</span>
            {group.gitSha ? (
              <>
                <span className="sep">·</span>
                <span className="num">{group.gitSha.slice(0, 7)}</span>
              </>
            ) : null}
            {group.originPreview ? (
              <>
                <span className="sep">·</span>
                <span className="muted">{group.originPreview}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="repo-stats">
          <div className={group.active.length > 0 ? "stat hot" : "stat"}>
            <span className="v num">{group.active.length}</span>
            <span className="l">Active 12h</span>
          </div>
          <div className="stat">
            <span className="v num">{formatTokens(group.totalTokens)}</span>
            <span className="l">Σ Tokens</span>
          </div>
          <div className="stat">
            <span className={group.warnings > 0 ? "v num warn-c" : "v num"}>{group.warnings}</span>
            <span className="l">Warn</span>
          </div>
          <div className="stat">
            <span className={group.openChildren > 0 ? "v num warn-c blink" : "v num"}>{group.openChildren}</span>
            <span className="l">Open ◌</span>
          </div>
        </div>
      </header>

      <div className="repo-body">
        {group.active.length === 0 ? (
          <div className="repo-empty">
            <span className="faint">—— no activity in last 12h ——</span>
            <span className="muted repo-empty__seen">last seen {ago(group.lastActivityMs, nowMs)} ago</span>
          </div>
        ) : (
          <>
            <div className="repo-section-lbl">▸ Active sessions <span className="muted">· last 12h</span></div>
            <div className="repo-tree">
              {group.active.map((repoRoot) => (
                <RepoTreeRow
                  key={repoRoot.root.id}
                  repoRoot={repoRoot}
                  nowMs={nowMs}
                  onSelectSession={onSelectSession}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="repo-card-foot" onClick={open}>
        <span>▸ OPEN {group.sessionCount} SESSION{group.sessionCount === 1 ? "" : "S"}</span>
        <span className="arrow" aria-hidden="true">›</span>
      </footer>
    </article>
  );
}

export function ReposView({ sessions, onOpenRepo, onSelectSession }: ReposViewProps) {
  const nowMs = Date.now();
  const groups = useMemo(() => groupSessionsByRepo(sessions, nowMs), [sessions, nowMs]);

  const totalRepos = groups.length;
  const totalActive = groups.reduce((total, group) => total + group.active.length, 0);
  const totalSessions = groups.reduce((total, group) => total + group.sessionCount, 0);

  return (
    <section className="repos" aria-labelledby="repos-title">
      <div className="repos-head">
        <div className="hazard-tag" data-tone="primary">
          <span className="hazard-tag__stripe" aria-hidden="true" />
          <h1 className="hazard-tag__label" id="repos-title">REPOS · INDEX</h1>
        </div>
        <div className="repos-head-stats">
          <div><span className="kicker">Repos</span><span className="num strong">{pad2(totalRepos)}</span></div>
          <div><span className="kicker">Active</span><span className="num strong">{totalActive}</span></div>
          <div><span className="kicker">Sessions</span><span className="num strong">{totalSessions}</span></div>
          <div><span className="kicker">Active = 12h</span><span className="num faint">window</span></div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="repos-empty faint">No repositories found in the current session index.</div>
      ) : (
        <div className="repos-grid">
          {groups.map((group) => (
            <RepoCard
              key={group.repoName}
              group={group}
              nowMs={nowMs}
              onOpenRepo={onOpenRepo}
              onSelectSession={onSelectSession}
            />
          ))}
        </div>
      )}
    </section>
  );
}
