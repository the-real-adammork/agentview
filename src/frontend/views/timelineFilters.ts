import type { TimelineEvent, TimelineEventKind } from "../../shared/contracts";

export type TimelineFilterKey = "all" | "messages" | "tools" | "skills" | "agents" | "tokens" | "warnings";

export interface TimelineFilterGroup {
  key: TimelineFilterKey;
  label: string;
  matches: (event: TimelineEvent) => boolean;
}

const MESSAGE_KINDS: TimelineEventKind[] = ["user_message", "assistant_message", "agent_message"];
const AGENT_KINDS: TimelineEventKind[] = ["agent_launch", "agent_wait"];

const failedToolCall = (event: TimelineEvent) =>
  event.kind === "tool_call" && (event.joinedExitCode ?? event.exitCode ?? 0) !== 0;

/**
 * The six grouped filter tabs from the design handoff. Counts and membership are
 * driven by these predicates so the tab badges and the filtered stream agree.
 */
export const TIMELINE_FILTERS: TimelineFilterGroup[] = [
  { key: "all", label: "All Events", matches: () => true },
  { key: "messages", label: "Messages", matches: (event) => MESSAGE_KINDS.includes(event.kind) },
  { key: "tools", label: "Tools", matches: (event) => event.kind === "tool_call" },
  { key: "skills", label: "Skills", matches: (event) => event.kind === "skill_invoke" },
  { key: "agents", label: "Agent Ops", matches: (event) => AGENT_KINDS.includes(event.kind) },
  { key: "tokens", label: "Tokens", matches: (event) => event.kind === "token_snapshot" },
  {
    key: "warnings",
    label: "Warnings",
    matches: (event) => event.kind === "warning" || event.kind === "parse_error" || failedToolCall(event),
  },
];

/**
 * Orders events chronologically by their created-at `timestamp` so every events
 * list (All Events, Messages, Tools, …) reads in time order. Events reach the UI
 * in file/append order — pagination chunks and the live SSE stream both concat
 * onto the tail — which only approximates chronological order and produces slight
 * mixups when timestamps don't line up with line order.
 *
 * The sort is stable: equal timestamps fall back to `sourceLine`, then the
 * original position, so deterministic input yields deterministic output. Events
 * with an unparseable timestamp inherit the previous valid event's time, keeping
 * them anchored where they were instead of jumping to an edge (mirrors how
 * windowTimelineEvents keeps, rather than drops, such events).
 */
export const sortTimelineEvents = (events: TimelineEvent[]): TimelineEvent[] => {
  let lastValidMs = 0;
  return events
    .map((event, index) => {
      const parsed = Date.parse(event.timestamp);
      const ms = Number.isFinite(parsed) ? parsed : lastValidMs;
      if (Number.isFinite(parsed)) {
        lastValidMs = parsed;
      }
      return { event, index, ms };
    })
    .sort((a, b) => a.ms - b.ms || a.event.sourceLine - b.event.sourceLine || a.index - b.index)
    .map((entry) => entry.event);
};

const groupFor = (key: string): TimelineFilterGroup => TIMELINE_FILTERS.find((group) => group.key === key) ?? TIMELINE_FILTERS[0];

/**
 * Filters events to a tab. With `hideTokens`, token_snapshot rows are dropped from
 * every tab EXCEPT the dedicated "tokens" tab (where they're the whole point), so
 * the noisy per-turn token snapshots can be muted from the All Events stream.
 */
export const filterTimelineEvents = (events: TimelineEvent[], key: string, hideTokens = false): TimelineEvent[] => {
  const group = groupFor(key);
  return events.filter(
    (event) => group.matches(event) && !(hideTokens && key !== "tokens" && event.kind === "token_snapshot"),
  );
};

export const timelineFilterCount = (events: TimelineEvent[], key: string, hideTokens = false): number =>
  filterTimelineEvents(events, key, hideTokens).length;

/**
 * Tool sub-type filter — a mute layer over tool_call rows, keyed on the typed
 * `outputRender.kind` the row already carries (diff/search/git-status/find/…),
 * with an "other" bucket for tool calls we couldn't classify (plain/no render).
 * Non-tool events are not governed by this filter; they stay under the group tabs.
 */
export type ToolTypeKey =
  | "diff"
  | "matches"
  | "status"
  | "diffstat"
  | "tree"
  | "file"
  | "http"
  | "table"
  | "tests"
  | "build"
  | "lint"
  | "log"
  | "json"
  | "trace"
  | "git"
  | "compose"
  | "read"
  | "search_call"
  | "fetch"
  | "agent"
  | "tool_search"
  | "other";

export interface ToolTypeOption {
  key: ToolTypeKey;
  /** User-facing label, matching the row's WHO label vocabulary. */
  label: string;
}

export const TOOL_TYPES: ToolTypeOption[] = [
  { key: "diff", label: "Diff" },
  { key: "matches", label: "Search" },
  { key: "status", label: "Git Status" },
  { key: "diffstat", label: "Diffstat" },
  { key: "tree", label: "Tree" },
  { key: "file", label: "File" },
  { key: "http", label: "HTTP" },
  { key: "table", label: "Table" },
  { key: "tests", label: "Tests" },
  { key: "build", label: "Build" },
  { key: "lint", label: "Lint" },
  { key: "log", label: "Git Log" },
  { key: "json", label: "JSON" },
  { key: "trace", label: "Trace" },
  { key: "git", label: "Git" },
  { key: "compose", label: "Compose" },
  { key: "read", label: "Read" },
  { key: "search_call", label: "Search Req" },
  { key: "fetch", label: "Fetch" },
  { key: "agent", label: "Agent" },
  { key: "tool_search", label: "Tool Search" },
  { key: "other", label: "Other" },
];

const TYPED_TOOL_KEYS = new Set<string>(TOOL_TYPES.filter((type) => type.key !== "other").map((type) => type.key));

/** The tool sub-type of a tool_call row (from its output render OR its call render); null for non-tool events. */
export const toolTypeKey = (event: TimelineEvent): ToolTypeKey | null => {
  if (event.kind !== "tool_call") return null;
  const renderKind = event.outputRender?.kind;
  if (renderKind && TYPED_TOOL_KEYS.has(renderKind)) return renderKind as ToolTypeKey;
  const callKind = event.callRender?.kind;
  if (callKind && TYPED_TOOL_KEYS.has(callKind)) return callKind as ToolTypeKey;
  return "other";
};

/**
 * Mutes tool_call rows whose sub-type isn't in `enabled`; non-tool events pass
 * through untouched. Identity (no allocation churn aside) when every type is on.
 */
export const filterByToolTypes = (events: TimelineEvent[], enabled: ReadonlySet<string>): TimelineEvent[] => {
  if (TOOL_TYPES.every((type) => enabled.has(type.key))) return events;
  return events.filter((event) => {
    const key = toolTypeKey(event);
    return key === null || enabled.has(key);
  });
};

/** Per-type tool-row counts (for the sidebar badges); non-tool events are ignored. */
export const toolTypeCounts = (events: TimelineEvent[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = toolTypeKey(event);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

/**
 * Event-type filter — a second sidebar mute layer, keyed on `event.kind`, for the
 * non-tool kinds that crowd the All Events stream (reasoning, turn_context, the
 * task markers, user/agent messages). Only the kinds it manages are governed;
 * everything else (assistant, tool_call, warning, …) passes through.
 */
export type EventTypeKey = Extract<
  TimelineEventKind,
  | "user_message"
  | "assistant_message"
  | "skill_invoke"
  | "reasoning"
  | "turn_context"
  | "task_started"
  | "task_complete"
  | "agent_message"
  | "warning"
>;

export interface EventTypeOption {
  key: EventTypeKey;
  label: string;
}

export const EVENT_TYPES: EventTypeOption[] = [
  { key: "user_message", label: "User" },
  { key: "assistant_message", label: "Assistant" },
  { key: "skill_invoke", label: "Skills" },
  { key: "reasoning", label: "Reasoning" },
  { key: "turn_context", label: "Turn Context" },
  { key: "task_started", label: "Task Started" },
  { key: "task_complete", label: "Task Complete" },
  { key: "agent_message", label: "Agent Report" },
  { key: "warning", label: "Warning" },
];

const EVENT_TYPE_KEYS = new Set<string>(EVENT_TYPES.map((type) => type.key));

/** The managed event kind of a row, or null when this filter doesn't govern it. */
export const eventTypeKey = (event: TimelineEvent): EventTypeKey | null =>
  EVENT_TYPE_KEYS.has(event.kind) ? (event.kind as EventTypeKey) : null;

/** Mutes events of a disabled managed kind; unmanaged kinds pass through. Identity when all enabled. */
export const filterByEventTypes = (events: TimelineEvent[], enabled: ReadonlySet<string>): TimelineEvent[] => {
  if (EVENT_TYPES.every((type) => enabled.has(type.key))) return events;
  return events.filter((event) => {
    const key = eventTypeKey(event);
    return key === null || enabled.has(key);
  });
};

/** Per-kind counts for the sidebar badges; unmanaged kinds are ignored. */
export const eventTypeCounts = (events: TimelineEvent[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const key = eventTypeKey(event);
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

export interface TimeWindowOption {
  ms: number;
  label: string;
}

/** Timeline window segments from the design handoff (fixed order); ms === 0 means "all". */
export const TIME_WINDOWS: TimeWindowOption[] = [
  { ms: 3_600_000, label: "1H" },
  { ms: 14_400_000, label: "4H" },
  { ms: 43_200_000, label: "12H" },
  { ms: 0, label: "ALL" },
];

/**
 * Trims events to those within `windowMs` of the most recent event's timestamp.
 * The reference "now" is the latest event, not the wall clock — sessions are
 * historical artifacts on disk, so a wall-clock window would hide everything in
 * any non-live session. windowMs <= 0 means "all" (no trimming); the newest
 * event always sits at the reference, so a window is never empty for non-empty
 * input. Events with unparseable timestamps are kept rather than dropped.
 */
export const windowTimelineEvents = (events: TimelineEvent[], windowMs: number): TimelineEvent[] => {
  if (windowMs <= 0 || events.length === 0) {
    return events;
  }
  const times = events.map((event) => Date.parse(event.timestamp)).filter(Number.isFinite);
  if (times.length === 0) {
    return events;
  }
  const refNow = Math.max(...times);
  return events.filter((event) => {
    const time = Date.parse(event.timestamp);
    return !Number.isFinite(time) || refNow - time <= windowMs;
  });
};
