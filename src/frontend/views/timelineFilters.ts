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
