import type { ReactNode } from "react";

import { ShortId } from "../components/ShortId";
import { TimelineEventRow } from "../components/TimelineEventRow";
import { TimelineScrubber } from "../components/TimelineScrubber";
import type { ApiError, SessionSummary, TimelineEventKind, TimelinePayload } from "../../shared/contracts";

interface TimelineViewProps {
  activeSession?: SessionSummary;
  payload?: TimelinePayload;
  isLoading?: boolean;
  error?: ApiError | null;
  activeKind: string;
  onKindChange(kind: string): void;
  onRefresh(): void;
  onTail(): void;
  onSelectSession(sessionId: string, view: "Timeline"): void;
}

const filters: Array<{ key: "all" | TimelineEventKind; label: string }> = [
  { key: "all", label: "all" },
  { key: "user_message", label: "user message" },
  { key: "assistant_message", label: "assistant message" },
  { key: "tool_call", label: "tool call" },
  { key: "tool_result", label: "tool result" },
  { key: "token_snapshot", label: "token snapshot" },
  { key: "warning", label: "warning" },
];

const compactFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const formatTime = (value?: string) => (value ? new Date(value).toLocaleTimeString("en-US") : "pending");
const formatPathTail = (value?: string) => value?.split("/").slice(-2).join("/") ?? "rollout pending";

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
  payload,
  isLoading = false,
  error = null,
  activeKind,
  onKindChange,
  onRefresh,
  onSelectSession,
  onTail,
}: TimelineViewProps) {
  const events = payload?.events ?? [];
  const visibleEvents = activeKind === "all" ? events : events.filter((event) => event.kind === activeKind);
  const facts = payload?.facts;
  const summary = facts?.summary;
  const latestSnapshot = facts?.tokenSnapshots.at(-1);
  const tokenTotal = activeSession?.tokensUsed ?? activeSession?.tokenTotal ?? latestSnapshot?.total ?? 0;
  const contextPercent = Math.round(
    latestSnapshot?.contextUtilization ?? (latestSnapshot?.modelContextWindow ? (latestSnapshot.total / latestSnapshot.modelContextWindow) * 100 : Math.min(99, (tokenTotal / 200_000) * 100)),
  );
  const primaryRate = Math.round(latestSnapshot?.rateLimitPrimaryPercent ?? 54);
  const secondaryRate = Math.round(latestSnapshot?.rateLimitSecondaryPercent ?? 18);
  const toolUsage = facts?.toolCalls.reduce<Record<string, number>>((usage, tool) => {
    usage[tool.toolName] = (usage[tool.toolName] ?? 0) + 1;
    return usage;
  }, {}) ?? {};
  const startedAt = summary?.startedAt ?? facts?.turns[0]?.startedAt;
  const completedAt = summary?.completedAt ?? facts?.turns[0]?.completedAt;
  const durationSeconds = startedAt && completedAt ? Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000)) : undefined;
  const firstTurn = facts?.turns[0];

  return (
    <section className="timeline" aria-labelledby="timeline-title">
      <aside className="tl-side" aria-label="Session meta">
        <div className="tl-meta">
          <div className="chip amber">{activeSession?.threadSource === "subagent" ? `SUB · ${activeSession.agentNickname ?? "worker"}` : "USER · ROOT"}</div>
          <h1 className="tl-heading" id="timeline-title">Timeline</h1>
          <div className="title">{activeSession?.title ?? "Fixture timeline"}</div>
          <div className="sub">{activeSession?.lastMessage ?? activeSession?.preview ?? "Timeline events are loaded lazily from the rollout cache."}</div>
          <div className="row">
            <MetricRow label="Session" value={<ShortId value={activeSession?.id ?? payload?.threadId ?? "fixture"} />} />
            <MetricRow label="Rollout" value={formatPathTail(facts?.rolloutPath)} />
            <MetricRow label="Repo" value={activeSession?.cwd ?? "fixture://timeline"} />
            <MetricRow label="Branch" value={activeSession?.branch || activeSession?.gitBranch || "unknown"} />
            <MetricRow label="Model" value={activeSession?.model || firstTurn?.model || "unknown"} />
            <MetricRow label="Started" value={formatTime(startedAt)} />
            <MetricRow label="Updated" value={formatTime(activeSession?.updatedAt ?? completedAt)} />
          </div>
        </div>
        <div className="tl-side__body">
          <div className="panel-tit"><span className="dot"></span><span>Session Meta</span><span className="spacer"></span><span className="meta">{payload?.cacheStatus ?? "pending"}</span></div>
          <div className="tl-side__facts">
            <div><span>events</span><strong>{summary?.eventCount ?? events.length}</strong></div>
            <div><span>turns</span><strong>{summary?.turnCount ?? 0}</strong></div>
            <div><span>tools</span><strong>{summary?.toolCallCount ?? 0}</strong></div>
            <div><span>warn</span><strong className="warn-c">{summary?.warningCount ?? 0}</strong></div>
          </div>
        </div>
      </aside>

      <section className="tl-main" aria-label="Timeline detail">
        <div className="tl-tabs" aria-label="Timeline event filters">
          {filters.map((filter) => {
            const count = filter.key === "all" ? events.length : events.filter((event) => event.kind === filter.key).length;
            return (
            <button
              aria-pressed={activeKind === filter.key}
              className="timeline-tabs__button"
              data-on={activeKind === filter.key ? "true" : "false"}
              key={filter.key}
              type="button"
              onClick={() => onKindChange(filter.key)}
            >
              {filter.label} <span aria-hidden="true" className="muted">·{count}</span>
            </button>
            );
          })}
          <span className="spacer" />
          <button type="button" onClick={onRefresh}>Refresh</button>
          <button type="button" onClick={onTail}>Tail</button>
        </div>

      {error ? <div role="alert" className="inline-alert">{error.message}</div> : null}
      {isLoading ? <div role="status">Loading timeline</div> : null}

        <div className="tl-scrubber-wrap">
          <div className="hdr">
            <span>TURN 01 · TASK_STARTED → TASK_COMPLETE{durationSeconds !== undefined ? ` · DUR ${durationSeconds}s` : ""}</span>
            <span>TTFT {firstTurn?.firstTokenMs ?? "n/a"}ms · next byte {payload?.nextByteOffset ?? 0}</span>
          </div>
          <TimelineScrubber events={events} activeKind={activeKind} />
        </div>

      <ol className="tl-stream timeline-list" aria-label="Timeline events">
        {visibleEvents.map((event) => (
          <TimelineEventRow event={event} key={event.id} onOpenThread={(threadId) => onSelectSession(threadId, "Timeline")} />
        ))}
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
            {facts?.agentLaunches.length ? (
              facts.agentLaunches.map((agent) => (
                <button className="tl-agent-link" key={agent.callId} onClick={() => agent.childThreadId && onSelectSession(agent.childThreadId, "Timeline")} type="button">
                  <span className="strong">{agent.nickname ?? "agent"}</span>
                  <span className="muted">{agent.role ?? "worker"}</span>
                </button>
              ))
            ) : (
              <div className="faint">-- no sub-agents --</div>
            )}
          </div>
        </div>
      </aside>
    </section>
  );
}
