import type { ReactNode } from "react";

import { ShortId } from "../components/ShortId";
import { TimelineEventRow } from "../components/TimelineEventRow";
import { TimelineScrubber } from "../components/TimelineScrubber";
import type { AgentEdgeStatus, ApiError, SessionSummary, TimelinePayload } from "../../shared/contracts";
import { TIMELINE_FILTERS, filterTimelineEvents, timelineFilterCount } from "./timelineFilters";

interface TimelineViewProps {
  activeSession?: SessionSummary;
  sessions?: SessionSummary[];
  payload?: TimelinePayload;
  isLoading?: boolean;
  error?: ApiError | null;
  activeKind: string;
  onKindChange(kind: string): void;
  onRefresh(): void;
  onTail(): void;
  onSelectSession(sessionId: string, view: "Timeline"): void;
  onOpenGraph?(): void;
}

const compactFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const formatTime = (value?: string) => (value ? new Date(value).toLocaleTimeString("en-US") : "pending");
const formatPathTail = (value?: string) => value?.split("/").slice(-2).join("/") ?? "rollout pending";
const sessionTokens = (session: SessionSummary) => session.tokensUsed ?? session.tokenTotal;
const sourceLabel = (session: SessionSummary) =>
  session.threadSource === "subagent" ? `SUB · ${session.agentNickname ?? "worker"}` : "USER";

const STATUS_TONE: Record<AgentEdgeStatus, "good" | "warn"> = {
  open: "warn",
  closed: "good",
  failed: "warn",
};

function MetricRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </>
  );
}

function Segments({ value, hi = false }: { value: number; hi?: boolean }) {
  const cells = Array.from({ length: 24 }, (_, index) => index < Math.round((Math.max(0, Math.min(100, value)) / 100) * 24));

  return (
    <div className="segbar" aria-hidden="true">
      {cells.map((on, index) => (
        <i className={on ? (hi ? "hi" : "on") : undefined} key={index} />
      ))}
    </div>
  );
}

export function TimelineView({
  activeSession,
  sessions = [],
  payload,
  isLoading = false,
  error = null,
  activeKind,
  onKindChange,
  onRefresh,
  onSelectSession,
  onTail,
  onOpenGraph,
}: TimelineViewProps) {
  const events = payload?.events ?? [];
  const facts = payload?.facts;
  const summary = facts?.summary;
  const firstTurn = facts?.turns[0];

  // Tool results are shown inline on their tool_call (joined by callId), so hide
  // the standalone result rows that have a matching call in this stream.
  const resultByCall = new Map(
    events.filter((event) => event.kind === "tool_result" && event.callId).map((event) => [event.callId as string, event]),
  );
  const renderableEvents = events
    .filter((event) => !(event.kind === "tool_result" && event.callId && resultByCall.has(event.callId)))
    .map((event) => {
      // The joined result row is hidden, so carry its collapse metadata onto the
      // tool_call that now renders the output inline (preserves the expand toggle).
      const result = event.kind === "tool_call" && event.callId ? resultByCall.get(event.callId) : undefined;
      return result
        ? {
            ...event,
            // The output belongs to the (now hidden) result row, so prefer its
            // size/collapse metadata; the call's own values are usually 0/false.
            outputBytes: result.outputBytes ?? event.outputBytes,
            isCollapsedByDefault: result.isCollapsedByDefault ?? event.isCollapsedByDefault,
          }
        : event;
    });
  const visibleEvents = filterTimelineEvents(renderableEvents, activeKind);

  const latestSnapshot = facts?.tokenSnapshots.at(-1);
  const tokenTotal = activeSession?.tokensUsed ?? activeSession?.tokenTotal ?? latestSnapshot?.total ?? 0;
  const contextPercent = Math.round(
    latestSnapshot?.contextUtilization ??
      (latestSnapshot?.modelContextWindow
        ? (latestSnapshot.total / latestSnapshot.modelContextWindow) * 100
        : Math.min(99, (tokenTotal / 200_000) * 100)),
  );
  const primaryRate = Math.round(latestSnapshot?.rateLimitPrimaryPercent ?? 54);
  const secondaryRate = Math.round(latestSnapshot?.rateLimitSecondaryPercent ?? 18);
  const toolUsage =
    facts?.toolCalls.reduce<Record<string, number>>((usage, tool) => {
      usage[tool.toolName] = (usage[tool.toolName] ?? 0) + 1;
      return usage;
    }, {}) ?? {};

  const startedAt = summary?.startedAt ?? firstTurn?.startedAt;
  const completedAt = summary?.completedAt ?? firstTurn?.completedAt;
  const durationSeconds =
    startedAt && completedAt ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000)) : undefined;

  const branch = activeSession?.branch || activeSession?.gitBranch || "unknown";
  const gitSha = activeSession?.gitSha ?? undefined;
  const model = activeSession?.model || firstTurn?.model || "unknown";
  const effort = firstTurn?.reasoningEffort ?? activeSession?.reasoningEffort ?? undefined;
  const sandbox = firstTurn?.sandboxPolicy ?? "unknown";
  const approval = firstTurn?.approvalMode ?? "unknown";

  // Match each spawned agent to its wait (for open/closed status) and to its
  // child session (for token totals) — all from real data, no fabrication.
  const statusByChild = new Map<string, AgentEdgeStatus>();
  for (const wait of facts?.agentWaits ?? []) {
    if (wait.childThreadId && wait.status) {
      statusByChild.set(wait.childThreadId, wait.status);
    }
  }
  const spawnedAgents = (facts?.agentLaunches ?? []).map((launch) => {
    const child = launch.childThreadId ? sessions.find((session) => session.id === launch.childThreadId) : undefined;
    const status: AgentEdgeStatus = launch.childThreadId ? statusByChild.get(launch.childThreadId) ?? "open" : "open";
    return {
      callId: launch.callId,
      childThreadId: launch.childThreadId,
      nickname: launch.nickname ?? "agent",
      role: launch.role ?? "worker",
      status,
      tokens: child ? sessionTokens(child) : undefined,
    };
  });

  const otherSessions = sessions.slice(0, 14);

  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <aside className="tl-side" aria-label="Session meta">
        <div className="tl-meta">
          <div className="chip amber">
            {activeSession?.threadSource === "subagent" ? `SUB · ${activeSession.agentNickname ?? "worker"}` : "USER · ROOT"}
          </div>
          <h1 className="tl-heading" id="timeline-title">Timeline</h1>
          <div className="title">{activeSession?.title ?? "Fixture timeline"}</div>
          <div className="sub">{activeSession?.lastMessage ?? activeSession?.preview ?? "Timeline events are loaded lazily from the rollout cache."}</div>
          <div className="row">
            <MetricRow label="Session" value={<ShortId value={activeSession?.id ?? payload?.threadId ?? "fixture"} />} />
            <MetricRow label="Rollout" value={formatPathTail(facts?.rolloutPath)} />
            <MetricRow label="Repo" value={activeSession?.cwd ?? "fixture://timeline"} />
            <MetricRow label="Branch" value={gitSha ? `${branch} · ${gitSha.slice(0, 7)}` : branch} />
            <MetricRow label="Model" value={effort ? `${model} · effort ${effort}` : model} />
            <MetricRow label="Sandbox" value={`${sandbox} · approval ${approval}`} />
            <MetricRow label="Started" value={formatTime(startedAt)} />
            <MetricRow label="Updated" value={formatTime(activeSession?.updatedAt ?? completedAt)} />
          </div>
        </div>
        <div className="tl-side__body">
          <div className="panel-tit"><span className="dot"></span><span>Other Sessions</span><span className="spacer"></span><span className="meta">{payload?.cacheStatus ?? "pending"}</span></div>
          <div className="tl-other" role="list" aria-label="Other sessions">
            {otherSessions.length === 0 ? <div className="faint">-- no sessions --</div> : null}
            {otherSessions.map((session) => (
              <button
                aria-current={session.id === activeSession?.id ? "true" : undefined}
                className="tl-other__row"
                data-active={session.id === activeSession?.id ? "true" : undefined}
                key={session.id}
                onClick={() => onSelectSession(session.id, "Timeline")}
                role="listitem"
                type="button"
              >
                <span className="tl-other__top">
                  <span className="tl-other__title">{session.title}</span>
                  <span className="num muted">{formatTime(session.updatedAt)}</span>
                </span>
                <span className="tl-other__sub muted">{sourceLabel(session)} · {compactFormatter.format(sessionTokens(session))} tok</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="tl-main" aria-label="Timeline detail">
        <div className="tl-tabs" aria-label="Timeline event filters">
          {TIMELINE_FILTERS.map((group) => (
            <button
              aria-pressed={activeKind === group.key}
              data-on={activeKind === group.key ? "true" : "false"}
              key={group.key}
              onClick={() => onKindChange(group.key)}
              type="button"
            >
              {group.label} <span aria-hidden="true" className="muted">·{timelineFilterCount(renderableEvents, group.key)}</span>
            </button>
          ))}
          <span className="spacer" />
          <button className="tl-tabs__aux" type="button" onClick={onRefresh}>Refresh</button>
          <button className="tl-tabs__aux" type="button" onClick={onTail}>Tail</button>
        </div>

        {error ? <div role="alert" className="inline-alert">{error.message}</div> : null}
        {isLoading ? <div role="status">Loading timeline</div> : null}

        <div className="tl-scrubber-wrap">
          <div className="hdr">
            <span>TURN 01 · TASK_STARTED → TASK_COMPLETE{durationSeconds !== undefined ? ` · DUR ${durationSeconds}s` : ""}</span>
            <span>TTFT {firstTurn?.firstTokenMs ?? "n/a"}ms · next byte {payload?.nextByteOffset ?? 0}</span>
          </div>
          <TimelineScrubber events={renderableEvents} activeKind={activeKind} />
        </div>

        <ol className="tl-stream" aria-label="Timeline events">
          {visibleEvents.map((event) => {
            let meta: string | undefined;
            if (event.kind === "task_started") {
              meta = `model ${model} · effort ${effort ?? "n/a"} · sandbox ${sandbox}`;
            } else if (event.kind === "task_complete") {
              const ttft = firstTurn?.firstTokenMs;
              meta = `${durationSeconds !== undefined ? `dur ${durationSeconds}s` : "dur n/a"}${ttft !== undefined ? ` · ttft ${ttft}ms` : ""}`;
            }
            return (
              <TimelineEventRow
                event={event}
                key={event.id}
                meta={meta}
                onOpenThread={(threadId) => onSelectSession(threadId, "Timeline")}
              />
            );
          })}
        </ol>
      </section>

      <aside className="tl-side-r" aria-label="Turn vitals">
        <div className="panel-tit"><span className="dot"></span><span>Turn 01 · Vitals</span><span className="spacer" /><span className="meta">live</span></div>
        <div className="tl-vitals">
          <div className="display tl-token-total">{compactFormatter.format(tokenTotal)}</div>
          <div className="kicker">Σ tokens · used</div>

          <div className="tl-meter">
            <div className="tl-meter__label"><span>Context window</span><strong>{contextPercent}%</strong></div>
            <Segments value={contextPercent} hi={contextPercent > 70} />
          </div>
          <div className="tl-meter">
            <div className="tl-meter__label"><span>Primary rate-limit</span><strong>{primaryRate}%</strong></div>
            <Segments value={primaryRate} />
          </div>
          <div className="tl-meter">
            <div className="tl-meter__label"><span>Secondary</span><strong>{secondaryRate}%</strong></div>
            <Segments value={secondaryRate} />
          </div>

          <div className="tl-section">
            <div className="kicker">▸ Tool Usage · this turn</div>
            {Object.entries(toolUsage).length > 0 ? (
              Object.entries(toolUsage).map(([tool, count]) => (
                <div className="tl-kv" key={tool}>
                  <span>{tool}</span>
                  <strong>{count}</strong>
                </div>
              ))
            ) : (
              <div className="faint">-- no tool calls --</div>
            )}
          </div>

          <div className="tl-section">
            <div className="kicker">▸ Spawned Agents</div>
            {spawnedAgents.length ? (
              spawnedAgents.map((agent) => (
                <button
                  className="tl-agent-link"
                  disabled={!agent.childThreadId}
                  key={agent.callId}
                  onClick={() => agent.childThreadId && onSelectSession(agent.childThreadId, "Timeline")}
                  type="button"
                >
                  <span className="tl-agent-link__top">
                    <span className="strong">{agent.nickname}</span>
                    <span className={`chip ${STATUS_TONE[agent.status]}`}>{agent.status.toUpperCase()}</span>
                  </span>
                  <span className="muted">{agent.role}{agent.tokens !== undefined ? ` · ${compactFormatter.format(agent.tokens)} tok` : ""}</span>
                </button>
              ))
            ) : (
              <div className="faint">-- no sub-agents --</div>
            )}
          </div>

          <button className="tl-graph-link" type="button" onClick={() => onOpenGraph?.()}>▸ Open Agent Graph</button>
        </div>
      </aside>
    </section>
  );
}
