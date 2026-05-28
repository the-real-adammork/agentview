import { describe, expect, it } from "vitest";

import { TIMELINE_FILTERS, filterTimelineEvents, timelineFilterCount } from "../../src/frontend/views/timelineFilters";
import type { TimelineEvent, TimelineEventKind } from "../../src/shared/contracts";

let counter = 0;
const ev = (kind: TimelineEventKind, overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: `e${counter++}`,
  threadId: "t",
  timestamp: new Date(Date.UTC(2026, 4, 27, 12, 0, 0)).toISOString(),
  sourceLine: 1,
  kind,
  severity: "info",
  previewText: kind,
  ...overrides,
});

describe("TIMELINE_FILTERS", () => {
  it("exposes the six grouped tabs in design order", () => {
    expect(TIMELINE_FILTERS.map((group) => group.key)).toEqual([
      "all",
      "messages",
      "tools",
      "agents",
      "tokens",
      "warnings",
    ]);
    expect(TIMELINE_FILTERS.map((group) => group.label)).toEqual([
      "All Events",
      "Messages",
      "Tools",
      "Agent Ops",
      "Tokens",
      "Warnings",
    ]);
  });
});

describe("filterTimelineEvents", () => {
  const events = [
    ev("task_started"),
    ev("user_message"),
    ev("assistant_message"),
    ev("agent_message"),
    ev("tool_call", { callId: "c1" }),
    ev("tool_call", { callId: "c2", joinedExitCode: 7, severity: "error" }),
    ev("tool_result", { callId: "c1" }),
    ev("token_snapshot"),
    ev("agent_launch"),
    ev("agent_wait"),
    ev("warning", { severity: "warning" }),
    ev("parse_error", { severity: "error" }),
  ];

  it("returns everything for the all group", () => {
    expect(filterTimelineEvents(events, "all")).toHaveLength(events.length);
  });

  it("groups user, assistant and agent messages together", () => {
    expect(filterTimelineEvents(events, "messages").map((event) => event.kind)).toEqual([
      "user_message",
      "assistant_message",
      "agent_message",
    ]);
  });

  it("treats tool calls (not tool results) as the Tools group", () => {
    expect(filterTimelineEvents(events, "tools").map((event) => event.kind)).toEqual(["tool_call", "tool_call"]);
  });

  it("groups agent launch and wait as Agent Ops", () => {
    expect(filterTimelineEvents(events, "agents").map((event) => event.kind)).toEqual(["agent_launch", "agent_wait"]);
  });

  it("collects warnings, parse errors, and failed tool calls under Warnings", () => {
    const kinds = filterTimelineEvents(events, "warnings").map((event) => event.kind);
    expect(kinds).toContain("warning");
    expect(kinds).toContain("parse_error");
    expect(kinds).toContain("tool_call"); // the failed (exit 7) call
    expect(kinds).not.toContain("user_message");
    // the successful tool call (c1) must not appear
    expect(filterTimelineEvents(events, "warnings").filter((event) => event.kind === "tool_call")).toHaveLength(1);
  });

  it("falls back to the all group for an unknown key", () => {
    expect(filterTimelineEvents(events, "bogus")).toHaveLength(events.length);
  });
});

describe("timelineFilterCount", () => {
  it("counts the events each group would show", () => {
    const events = [ev("user_message"), ev("tool_call"), ev("token_snapshot"), ev("warning", { severity: "warning" })];

    expect(timelineFilterCount(events, "all")).toBe(4);
    expect(timelineFilterCount(events, "messages")).toBe(1);
    expect(timelineFilterCount(events, "tools")).toBe(1);
    expect(timelineFilterCount(events, "warnings")).toBe(1);
  });
});
