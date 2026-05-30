import { useEffect, useState, type CSSProperties } from "react";

import { AnimatedNumber } from "../components/AnimatedNumber";
import { useEnteringIds } from "../live/useEnteringIds";
import { TimelineEventRow, type EventSource } from "../components/TimelineEventRow";
import { ExecModal } from "../components/execRenderers";
import { TimelineLoadingSkeleton } from "../components/TimelineLoadingSkeleton";
import { TimelineScrubber } from "../components/TimelineScrubber";
import { flattenAgentTree, indexSessions, isDescendantOf, sessionDepth, toneForDepth } from "./sessionTree";
import type { AgentEdgeStatus, ApiError, SessionSummary, TimelineEvent, TimelinePayload } from "../../shared/contracts";
import {
  EVENT_TYPES,
  TIME_WINDOWS,
  TIMELINE_FILTERS,
  TOOL_TYPES,
  eventTypeCounts,
  filterByEventTypes,
  filterByToolTypes,
  filterTimelineEvents,
  sortTimelineEvents,
  timelineFilterCount,
  toolTypeCounts,
  windowTimelineEvents,
} from "./timelineFilters";

interface TimelineViewProps {
  activeSession?: SessionSummary;
  sessions?: SessionSummary[];
  payload?: TimelinePayload;
  isLoading?: boolean;
  error?: ApiError | null;
  activeKind: string;
  /**
   * "this" shows only the active thread; "all" (+SUBS) shows the whole spawn
   * subtree. The payload already carries the merged subtree (built server-side)
   * when the thread has descendants, so scope is purely a client-side filter.
   */
  scope?: "this" | "all";
  /** True while the one server-merged subtree call for +SUBS is in flight. */
  subtreeLoading?: boolean;
  onScopeChange?(scope: "this" | "all"): void;
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
// Render only the most recent slice by default — a busy +SUBS subtree can be
// thousands of rows, and mounting them all locks the main thread. Older events
// stay in memory and reveal in chunks on demand.
const DEFAULT_RENDER_LIMIT = 1000;
const RENDER_LIMIT_STEP = 1000;
const sessionTokens = (session: SessionSummary) => session.tokensUsed ?? session.tokenTotal;

const STATUS_TONE: Record<AgentEdgeStatus, "good" | "warn"> = {
  open: "warn",
  closed: "good",
  failed: "warn",
};

const isSubagent = (session: SessionSummary) => session.threadSource === "subagent" || Boolean(session.agentRole);
const threadKicker = (session: SessionSummary) =>
  isSubagent(session) ? `SUB · ${(session.agentRole ?? "worker").toUpperCase()}` : "USER · ROOT";
const threadName = (session: SessionSummary) =>
  isSubagent(session) ? session.agentNickname ?? "agent" : session.title;
/** Short label for the per-event origin rail (full titles are too long there). */
const railName = (session: SessionSummary) =>
  isSubagent(session) ? session.agentNickname ?? "agent" : "root";

/**
 * Agent Tree — the full spawn tree rooted at the current session's root, so from
 * any sub-agent you can still see and jump to the parent, siblings, and cousins.
 */
function ThreadNav({
  current,
  sessions,
  statusByChild,
  liveTotal,
  onSelect,
}: {
  current: SessionSummary;
  sessions: SessionSummary[];
  statusByChild: Map<string, AgentEdgeStatus>;
  liveTotal: number;
  onSelect: (sessionId: string) => void;
}) {
  const rows = flattenAgentTree(current, sessions);
  // Feed-enter: a thread that just joined the spawn tree (new sub-agent) slides
  // in. The viewed root is the reset key, so switching threads re-baselines
  // rather than flashing the whole tree.
  const enteringIds = useEnteringIds(
    rows.map((row) => row.session.id),
    { resetKey: current.id },
  );

  return (
    <div className="thread-nav">
      <div className="panel-tit">
        <span className="dot" />
        <span>Agent Tree</span>
        <span className="spacer" />
        <span className="meta">{rows.length} thread{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="thread-nav-body" role="list" aria-label="Agent tree">
        {rows.map(({ session, depth }) => {
          const here = session.id === current.id;
          // Unified depth semantics: orange root · amber sub · cyan sub-sub.
          const tone = toneForDepth(depth);
          const open = statusByChild.get(session.id) === "open";
          return (
            <button
              aria-current={here ? "true" : undefined}
              className={enteringIds.has(session.id) ? "thread-row feed-enter" : "thread-row"}
              data-depth={depth}
              data-here={here ? "true" : undefined}
              data-tone={tone}
              disabled={here}
              key={session.id}
              onClick={here ? undefined : () => onSelect(session.id)}
              role="listitem"
              style={{ "--depth": depth } as CSSProperties}
              title={here ? "Current thread" : `Open ${threadName(session)}'s timeline`}
              type="button"
            >
              {depth > 0 ? <span className="tn-connector" data-tone={tone} aria-hidden="true">└</span> : null}
              <span className="tn-tab" data-tone={tone} aria-hidden="true" />
              <span className="tn-text">
                <span className="tn-kicker">{threadKicker(session)}</span>
                <span className="tn-name">{threadName(session)}</span>
              </span>
              <span className="tn-meta">
                {here ? (
                  <>
                    <AnimatedNumber
                      className="tn-tok num"
                      value={liveTotal}
                      format={(value) => compactFormatter.format(value)}
                    />
                    <span className="tn-here">● HERE</span>
                  </>
                ) : (
                  <>
                    {open ? <span className="tn-dot" aria-label="open" /> : null}
                    <span className="num">{compactFormatter.format(sessionTokens(session))}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
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
  scope = "this",
  subtreeLoading = false,
  onScopeChange,
  onKindChange,
  onRefresh,
  onSelectSession,
  onTail,
  onOpenGraph,
}: TimelineViewProps) {
  const [windowMs, setWindowMs] = useState(0); // 0 === "ALL"
  // The exec-output event whose full output is open in the modal (null = closed).
  const [expandedEvent, setExpandedEvent] = useState<TimelineEvent | null>(null);
  // Live tail: when on, new events stream in with the feed-enter animation and
  // the toggle pulses. The real stream is SSE-driven (App owns it); turning this
  // on also pulls the newest bytes immediately.
  const [live, setLive] = useState(false);
  // How many of the most-recent visible events to actually render; "load older"
  // grows it. Reset when the filter/window/scope/session changes (below).
  const [renderLimit, setRenderLimit] = useState(DEFAULT_RENDER_LIMIT);
  // Per-turn token_count snapshots are noisy in the stream; hide them from every
  // tab except "Tokens" by default. Toggleable so they can be brought back.
  const [hideTokens, setHideTokens] = useState(true);
  // Tool sub-type mute filter (sidebar): each typed exec-render kind can be hidden.
  // All on by default — composes with the group tabs as a mute layer over tool rows.
  const [toolTypes, setToolTypes] = useState<Set<string>>(() => new Set(TOOL_TYPES.map((type) => type.key)));
  const allToolTypesOn = toolTypes.size === TOOL_TYPES.length;
  // Stable string of the enabled set, for the re-frame effect deps + feed-enter reset key.
  const toolTypesKey = TOOL_TYPES.map((type) => (toolTypes.has(type.key) ? "1" : "0")).join("");
  const toggleToolType = (key: string) =>
    setToolTypes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const resetToolTypes = () => setToolTypes(new Set(TOOL_TYPES.map((type) => type.key)));
  // Second mute layer for the noisy non-tool event kinds (reasoning, turn_context, …).
  const [eventTypes, setEventTypes] = useState<Set<string>>(() => new Set(EVENT_TYPES.map((type) => type.key)));
  const allEventTypesOn = eventTypes.size === EVENT_TYPES.length;
  const eventTypesKey = EVENT_TYPES.map((type) => (eventTypes.has(type.key) ? "1" : "0")).join("");
  const toggleEventType = (key: string) =>
    setEventTypes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const resetEventTypes = () => setEventTypes(new Set(EVENT_TYPES.map((type) => type.key)));
  // +SUBS scope merges descendant agents' events into the stream; each event keeps
  // its own threadId so its origin (depth + agent name) can be derived per row.
  const sessionIndex = indexSessions(sessions);
  const hasDescendants =
    Boolean(activeSession) && sessions.some((session) => isDescendantOf(session, activeSession!.id, sessionIndex));
  const showSubs = scope === "all" && hasDescendants;
  const activeDepth = activeSession ? sessionDepth(activeSession, sessionIndex) : 0;
  // Show the depth rail when merging sub-agents (+SUBS) OR when the thread itself
  // is a sub-agent — so a sub-agent's own timeline always marks its depth.
  const showRail = showSubs || activeDepth > 0;

  // The payload carries the full spawn subtree (merged server-side) when this
  // thread has descendants. "this" scope is a filter on that incoming stream;
  // "+SUBS" keeps every thread. Sorting by created-at keeps the stream, scrubber,
  // tab counts, and token deltas all in time order.
  const scopedEvents = (payload?.events ?? []).filter(
    (event) => scope === "all" || !activeSession || event.threadId === activeSession.id,
  );
  const events = sortTimelineEvents(scopedEvents);
  // The loading skeleton stands in for fetching + parsing this session's rollout.
  // It shows while a load is in flight and there's nothing yet for the active
  // thread — i.e. a cold open or a session switch (whose stale events were just
  // filtered out) — and clears the moment the thread's events arrive.
  const showSkeleton = isLoading && events.length === 0;

  // Per-event origin for the depth rail: look the source thread up in the session
  // index and tone it by tree depth (orange root · amber sub · cyan sub-sub).
  const sourceForEvent = (event: TimelineEvent): EventSource | undefined => {
    if (!showRail) return undefined;
    const source = sessionIndex.get(event.threadId);
    const depth = source ? sessionDepth(source, sessionIndex) : 0;
    return { depth, name: source ? railName(source) : "agent", tone: toneForDepth(depth) };
  };

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
  // Single source of truth: the time window trims the events array itself, so the
  // scrubber rail, tab counts, header duration, and stream all derive from one slice.
  const windowedEvents = windowTimelineEvents(renderableEvents, windowMs);
  // Per-type tool-row counts for the sidebar badges — over the windowed slice and
  // before the mute filter, so each badge shows what's available to toggle.
  const toolCounts = toolTypeCounts(windowedEvents);
  const eventCounts = eventTypeCounts(windowedEvents);
  // Sidebar mute layers (tool sub-types, then event kinds), then the group tab +
  // token filter. filter() returns a fresh array, so reversing (newest first) is safe.
  const typeFilteredEvents = filterByEventTypes(filterByToolTypes(windowedEvents, toolTypes), eventTypes);
  const visibleEvents = filterTimelineEvents(typeFilteredEvents, activeKind, hideTokens).reverse();
  // Render only the most-recent `renderLimit` (newest-first, so the slice head is
  // the most recent); the rest reveal via "load older".
  const renderedEvents = visibleEvents.slice(0, renderLimit);
  const hiddenOlderCount = visibleEvents.length - renderedEvents.length;

  // Δ-since-last for token_count rows: chronological pass over the renderable
  // events records how much each snapshot's total grew over the previous one.
  const tokenDeltaById = (() => {
    const deltas = new Map<string, number>();
    // Track the previous total per source thread so merged sub-agent snapshots
    // (+SUBS) don't compute deltas against another agent's running total.
    const previousByThread = new Map<string, number>();
    for (const event of renderableEvents) {
      if (event.kind === "token_snapshot" && event.tokenSnapshot) {
        const previousTotal = previousByThread.get(event.threadId);
        if (previousTotal !== undefined) {
          deltas.set(event.id, event.tokenSnapshot.total - previousTotal);
        }
        previousByThread.set(event.threadId, event.tokenSnapshot.total);
      }
    }
    return deltas;
  })();

  // Feed-enter animation: events that weren't present at the last commit
  // slide+fade in as the SSE stream appends them — independent of the tail
  // toggle, which only governs follow/scroll. Changing the session, scope,
  // window, or kind re-frames the stream, so that context is the reset key:
  // the first render of a new frame is a baseline (no flash), later inserts
  // animate. (visibleEvents is recomputed fresh each render; the hook diffs ids.)
  const enteringIds = useEnteringIds(
    visibleEvents.map((event) => event.id),
    // isLoading is part of the context so the initial fixture→real payload swap
    // (and any explicit refetch) re-baselines rather than flashing every row.
    { resetKey: `${activeSession?.id ?? ""}|${scope}|${windowMs}|${activeKind}|${toolTypesKey}|${eventTypesKey}|${isLoading}` },
  );

  // Changing the filter, window, scope, or session re-frames the stream, so drop
  // back to the most-recent page rather than carrying a grown limit across views.
  useEffect(() => {
    setRenderLimit(DEFAULT_RENDER_LIMIT);
    // Re-framing the stream closes any open exec-output modal so it can't outlive
    // the events it was opened from (e.g. switching threads or windows).
    setExpandedEvent(null);
  }, [activeKind, windowMs, scope, hideTokens, toolTypesKey, eventTypesKey, activeSession?.id]);

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

  // When a window is active, the scrubber header swaps to "LAST {N}H" and the
  // duration is recomputed from the windowed span (handoff COMP/06).
  const windowLabel = TIME_WINDOWS.find((option) => option.ms === windowMs)?.label;
  const windowedDurationSeconds = (() => {
    if (windowedEvents.length === 0) return undefined;
    const first = Date.parse(windowedEvents[0].timestamp);
    const last = Date.parse(windowedEvents[windowedEvents.length - 1].timestamp);
    return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, Math.round((last - first) / 1000)) : undefined;
  })();
  const headerSpanLabel = windowMs ? `LAST ${windowLabel}` : "TASK_STARTED → TASK_COMPLETE";
  const headerDurationSeconds = windowMs ? windowedDurationSeconds : durationSeconds;

  const branch = activeSession?.branch || activeSession?.gitBranch || "unknown";
  const gitSha = activeSession?.gitSha ?? undefined;
  const model = activeSession?.model || firstTurn?.model || "unknown";
  const effort = firstTurn?.reasoningEffort ?? activeSession?.reasoningEffort ?? undefined;
  const sandbox = firstTurn?.sandboxPolicy ?? "unknown";

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

  return (
    <section className="timeline" aria-labelledby="timeline-title">
      {/* The view name already shows in the top app-bar nav; this heading keeps
          the section labelled for assistive tech without restating it visually.
          Handoff: the timeline body is two columns — left sidebar + stream. */}
      <h1 className="sr-only" id="timeline-title">Timeline</h1>

      {/* Left sidebar (handoff: 320px column) leads with the full Agent Tree,
          then the Turn vitals title, then the scrollable vitals body. */}
      <aside className="tl-side" aria-label="Agent tree and turn vitals">
        {activeSession ? (
          <ThreadNav
            current={activeSession}
            sessions={sessions}
            statusByChild={statusByChild}
            liveTotal={tokenTotal}
            onSelect={(sessionId) => onSelectSession(sessionId, "Timeline")}
          />
        ) : (
          <div className="thread-nav">
            <div className="panel-tit"><span className="dot" /><span>Agent Tree</span></div>
            <div className="faint" style={{ padding: 14 }}>-- no session selected --</div>
          </div>
        )}

        <div className="tl-tooltypes-panel">
          <div className="panel-tit">
            <span className="dot" />
            <span>Tool Types</span>
            <span className="spacer" />
            {allToolTypesOn ? (
              <span className="meta">all</span>
            ) : (
              <button className="tl-tt-reset" type="button" onClick={resetToolTypes}>
                reset
              </button>
            )}
          </div>
          <div className="tl-tooltypes" role="group" aria-label="Filter timeline by tool type">
            {TOOL_TYPES.map((type) => {
              const on = toolTypes.has(type.key);
              const count = toolCounts[type.key] ?? 0;
              return (
                <button
                  aria-pressed={on}
                  className="tl-tt"
                  data-on={on ? "true" : "false"}
                  data-empty={count === 0 ? "true" : undefined}
                  key={type.key}
                  onClick={() => toggleToolType(type.key)}
                  title={on ? `Hide ${type.label} rows` : `Show ${type.label} rows`}
                  type="button"
                >
                  <span className="tl-tt-lbl">{type.label}</span>
                  <span className="tl-tt-cnt num" aria-hidden="true">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tl-tooltypes-panel">
          <div className="panel-tit">
            <span className="dot" />
            <span>Event Types</span>
            <span className="spacer" />
            {allEventTypesOn ? (
              <span className="meta">all</span>
            ) : (
              <button className="tl-tt-reset" type="button" onClick={resetEventTypes}>
                reset
              </button>
            )}
          </div>
          <div className="tl-tooltypes" role="group" aria-label="Filter timeline by event type">
            {EVENT_TYPES.map((type) => {
              const on = eventTypes.has(type.key);
              const count = eventCounts[type.key] ?? 0;
              return (
                <button
                  aria-pressed={on}
                  className="tl-tt"
                  data-on={on ? "true" : "false"}
                  data-empty={count === 0 ? "true" : undefined}
                  key={type.key}
                  onClick={() => toggleEventType(type.key)}
                  title={on ? `Hide ${type.label} rows` : `Show ${type.label} rows`}
                  type="button"
                >
                  <span className="tl-tt-lbl">{type.label}</span>
                  <span className="tl-tt-cnt num" aria-hidden="true">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel-tit">
          <span className="dot" />
          <span>Turn 01 · Vitals</span>
          <span className="spacer" />
          <span className={`meta${live ? " blink" : ""}`}>{live ? "● live" : "live"}</span>
        </div>
        <div className="tl-vitals">
          <AnimatedNumber
            className="display tl-token-total"
            value={tokenTotal}
            format={(value) => compactFormatter.format(value)}
          />
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
              {group.label} <span aria-hidden="true" className="muted">·{timelineFilterCount(windowedEvents, group.key, hideTokens)}</span>
            </button>
          ))}
          <span className="spacer" />
          <div className="tl-range" role="group" aria-label="Token rows">
            <span aria-hidden="true" className="tl-range-lbl">▸ Tokens</span>
            <button
              aria-pressed={!hideTokens}
              data-on={!hideTokens ? "true" : "false"}
              onClick={() => setHideTokens((value) => !value)}
              title={hideTokens ? "Token snapshot rows are hidden — click to show them" : "Token snapshot rows are shown — click to hide them"}
              type="button"
            >
              {hideTokens ? "Hidden" : "Shown"}
            </button>
          </div>
          {hasDescendants ? (
            <div className="tl-range" role="group" aria-label="Event scope">
              <span aria-hidden="true" className="tl-range-lbl">▸ Scope</span>
              <button
                aria-pressed={scope === "this"}
                data-on={scope === "this" ? "true" : "false"}
                onClick={() => onScopeChange?.("this")}
                title="Only events from this agent thread"
                type="button"
              >
                This
              </button>
              <button
                aria-pressed={scope === "all"}
                data-on={scope === "all" ? "true" : "false"}
                data-loading={subtreeLoading ? "true" : undefined}
                onClick={() => onScopeChange?.("all")}
                title="Include events from sub-agents and their sub-agents"
                type="button"
              >
                {subtreeLoading ? "+Subs…" : "+Subs"}
              </button>
            </div>
          ) : null}
          <div className="tl-range" role="group" aria-label="Time window">
            <span aria-hidden="true" className="tl-range-lbl">▸ Window</span>
            {TIME_WINDOWS.map((option) => (
              <button
                aria-pressed={windowMs === option.ms}
                data-on={windowMs === option.ms ? "true" : "false"}
                key={option.label}
                onClick={() => setWindowMs(option.ms)}
                title={option.ms ? `Show events from the last ${option.label}` : "Show the entire session"}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            className="tl-live-btn"
            type="button"
            data-on={live ? "true" : "false"}
            aria-pressed={live}
            onClick={() => {
              const next = !live;
              setLive(next);
              if (next) onTail();
            }}
            title={live ? "Live — new events stream in" : "Tail — follow new events as they arrive"}
          >
            <span className="dot" aria-hidden="true" />
            {live ? "Live" : "Tail"}
          </button>
          <button className="tl-tabs__aux" type="button" onClick={onRefresh}>Refresh</button>
        </div>

        {error ? <div role="alert" className="inline-alert">{error.message}</div> : null}

        <div className="tl-scrubber-wrap tl-scrubber" data-loading={showSkeleton ? "true" : undefined}>
          <div className="hdr">
            <span>
              TURN 01 · {showSkeleton ? "LOADING ROLLOUT…" : headerSpanLabel}
              {showSkeleton ? " · DUR —" : headerDurationSeconds !== undefined ? ` · DUR ${headerDurationSeconds}s` : ""}
            </span>
            <span>TTFT {firstTurn?.firstTokenMs ?? "n/a"}ms · next byte {payload?.nextByteOffset ?? 0}</span>
          </div>
          {/* Dots are withheld while loading so stale/abruptly-appearing dots never flash. */}
          <TimelineScrubber events={showSkeleton ? [] : windowedEvents} activeKind={activeKind} />
          {showSkeleton ? <div className="tl-scan" aria-hidden="true" /> : null}
        </div>

        {showSkeleton ? (
          <TimelineLoadingSkeleton />
        ) : (
        <ol className="tl-stream" aria-label="Timeline events">
          {visibleEvents.length === 0 ? (
            <li className="tl-stream__empty faint">-- no events in this window --</li>
          ) : null}
          {renderedEvents.map((event) => {
            let meta: string | undefined;
            if (event.kind === "task_started") {
              // Carries the session identity the sidebar no longer shows (handoff
              // moves meta out of the timeline body): model, effort, sandbox, branch.
              const branchMeta = gitSha ? `${branch} · ${gitSha.slice(0, 7)}` : branch;
              meta = `model ${model} · effort ${effort ?? "n/a"} · sandbox ${sandbox} · ${branchMeta}`;
            } else if (event.kind === "task_complete") {
              const ttft = firstTurn?.firstTokenMs;
              meta = `${durationSeconds !== undefined ? `dur ${durationSeconds}s` : "dur n/a"}${ttft !== undefined ? ` · ttft ${ttft}ms` : ""}`;
            }
            return (
              <TimelineEventRow
                event={event}
                key={event.id}
                meta={meta}
                delta={tokenDeltaById.get(event.id)}
                isNew={enteringIds.has(event.id)}
                source={sourceForEvent(event)}
                onOpenThread={(threadId) => onSelectSession(threadId, "Timeline")}
                onExpand={setExpandedEvent}
              />
            );
          })}
          {hiddenOlderCount > 0 ? (
            <li className="tl-stream__more">
              <button type="button" className="tl-load-older" onClick={() => setRenderLimit((limit) => limit + RENDER_LIMIT_STEP)}>
                ↓ Load older events · {compactFormatter.format(hiddenOlderCount)} more
              </button>
            </li>
          ) : null}
        </ol>
        )}
      </section>
      {expandedEvent ? <ExecModal event={expandedEvent} onClose={() => setExpandedEvent(null)} /> : null}
    </section>
  );
}
