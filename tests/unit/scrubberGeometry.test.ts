import { describe, expect, it } from "vitest";

import { AXIS_TICKS, scrubberDots } from "../../src/frontend/components/scrubberGeometry";
import type { TimelineEvent, TimelineEventKind } from "../../src/shared/contracts";

const BASE = Date.UTC(2026, 4, 27, 12, 0, 0);
let counter = 0;
const ev = (kind: TimelineEventKind, offsetMs: number): TimelineEvent => ({
  id: `e${counter++}`,
  threadId: "t",
  timestamp: new Date(BASE + offsetMs).toISOString(),
  sourceLine: 1,
  kind,
  severity: "info",
  previewText: kind,
});

describe("scrubberDots", () => {
  it("positions dots by timestamp as a percentage of the full span", () => {
    const dots = scrubberDots([ev("user_message", 0), ev("tool_call", 5_000), ev("task_complete", 10_000)]);

    expect(dots.map((dot) => dot.leftPct)).toEqual([0, 50, 100]);
  });

  it("places a single event (zero span) at 0% without NaN", () => {
    const dots = scrubberDots([ev("user_message", 0)]);

    expect(dots).toHaveLength(1);
    expect(dots[0].leftPct).toBe(0);
  });

  it("returns no dots for an empty timeline", () => {
    expect(scrubberDots([])).toEqual([]);
  });

  it("renders token snapshots as thin ticks that span the full rail", () => {
    const [dot] = scrubberDots([ev("token_snapshot", 0)]);

    expect(dot.widthPx).toBe(2);
    expect(dot.height).toBe("100%");
  });

  it("renders warnings taller than ordinary events", () => {
    const [warn] = scrubberDots([ev("warning", 0)]);
    const [user] = scrubberDots([ev("user_message", 0)]);

    expect(warn.height).toBe("22px");
    expect(user.height).toBe("14px");
  });

  it("color-codes dots by kind", () => {
    const color = (kind: TimelineEventKind) => scrubberDots([ev(kind, 0)])[0].colorVar;

    expect(color("warning")).toBe("var(--warn)");
    expect(color("tool_call")).toBe("var(--amber)");
    expect(color("user_message")).toBe("var(--cyan)");
    expect(color("agent_message")).toBe("var(--good)");
    expect(color("task_complete")).toBe("var(--ink-strong)");
    expect(color("assistant_message")).toBe("var(--primary)");
  });

  it("exposes axis tick percentages", () => {
    expect(AXIS_TICKS).toEqual([0, 25, 50, 75, 100]);
  });
});
