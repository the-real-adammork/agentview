import type { TimelineEvent, TimelineEventKind } from "../../shared/contracts";

export interface ScrubberDot {
  id: string;
  kind: TimelineEventKind;
  leftPct: number;
  widthPx: number;
  /** CSS length: token snapshots span the full rail ("100%"), others are fixed px. */
  height: string;
  colorVar: string;
}

/** Axis tick percentages drawn across the scrubber track. */
export const AXIS_TICKS = [0, 25, 50, 75, 100] as const;

const colorForKind = (kind: TimelineEventKind): string => {
  switch (kind) {
    case "warning":
    case "parse_error":
      return "var(--warn)";
    case "tool_call":
    case "tool_result":
      return "var(--amber)";
    case "user_message":
      return "var(--cyan)";
    case "agent_message":
    case "agent_launch":
    case "agent_wait":
      return "var(--good)";
    case "task_complete":
      return "var(--ink-strong)";
    default:
      return "var(--primary)";
  }
};

const sizeForKind = (kind: TimelineEventKind): { widthPx: number; height: string } => {
  if (kind === "token_snapshot") {
    return { widthPx: 2, height: "100%" };
  }
  if (kind === "warning" || kind === "parse_error") {
    return { widthPx: 4, height: "22px" };
  }
  return { widthPx: 4, height: "14px" };
};

/**
 * Maps timeline events to scrubber dots positioned by timestamp across the full
 * [first, last] span (not by index), sized and colored per kind. A zero-length
 * span (single event / identical timestamps) collapses to 0% without NaN.
 */
export const scrubberDots = (events: TimelineEvent[]): ScrubberDot[] => {
  if (events.length === 0) {
    return [];
  }

  const times = events.map((event) => Date.parse(event.timestamp));
  const finite = times.filter((time) => Number.isFinite(time));
  const t0 = finite.length ? Math.min(...finite) : 0;
  const tEnd = finite.length ? Math.max(...finite) : 0;
  const span = Math.max(1, tEnd - t0);

  return events.map((event, index) => {
    const time = times[index];
    const leftPct = Number.isFinite(time) ? ((time - t0) / span) * 100 : 0;
    const { widthPx, height } = sizeForKind(event.kind);

    return {
      id: event.id,
      kind: event.kind,
      leftPct,
      widthPx,
      height,
      colorVar: colorForKind(event.kind),
    };
  });
};
