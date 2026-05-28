import type { TimelineEvent, TimelineEventKind } from "../../shared/contracts";

export type TimelineFilterKey = "all" | "messages" | "tools" | "agents" | "tokens" | "warnings";

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
  { key: "agents", label: "Agent Ops", matches: (event) => AGENT_KINDS.includes(event.kind) },
  { key: "tokens", label: "Tokens", matches: (event) => event.kind === "token_snapshot" },
  {
    key: "warnings",
    label: "Warnings",
    matches: (event) => event.kind === "warning" || event.kind === "parse_error" || failedToolCall(event),
  },
];

const groupFor = (key: string): TimelineFilterGroup => TIMELINE_FILTERS.find((group) => group.key === key) ?? TIMELINE_FILTERS[0];

export const filterTimelineEvents = (events: TimelineEvent[], key: string): TimelineEvent[] => {
  const group = groupFor(key);
  return events.filter((event) => group.matches(event));
};

export const timelineFilterCount = (events: TimelineEvent[], key: string): number => filterTimelineEvents(events, key).length;
