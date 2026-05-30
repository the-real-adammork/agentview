import { describe, expect, it } from "vitest";

import {
  TIME_WINDOWS,
  TIMELINE_FILTERS,
  filterTimelineEvents,
  sortTimelineEvents,
  timelineFilterCount,
  windowTimelineEvents,
} from "../../src/frontend/views/timelineFilters";
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

const at = (kind: TimelineEventKind, isoTimestamp: string): TimelineEvent => ev(kind, { timestamp: isoTimestamp });

describe("TIMELINE_FILTERS", () => {
  it("exposes the grouped tabs in design order (Skills between Tools and Agent Ops)", () => {
    expect(TIMELINE_FILTERS.map((group) => group.key)).toEqual([
      "all",
      "messages",
      "tools",
      "skills",
      "agents",
      "tokens",
      "warnings",
    ]);
    expect(TIMELINE_FILTERS.map((group) => group.label)).toEqual([
      "All Events",
      "Messages",
      "Tools",
      "Skills",
      "Agent Ops",
      "Tokens",
      "Warnings",
    ]);
  });

  it("isolates skill_invoke events under the Skills tab (and keeps them out of Tools)", () => {
    const events = [ev("tool_call", { callId: "c1" }), ev("skill_invoke", { skillName: "read_pdf" })];
    expect(filterTimelineEvents(events, "skills").map((event) => event.kind)).toEqual(["skill_invoke"]);
    expect(filterTimelineEvents(events, "tools").map((event) => event.kind)).toEqual(["tool_call"]);
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

  it("hides token snapshots from every tab except Tokens when hideTokens is set", () => {
    const events = [ev("user_message"), ev("tool_call"), ev("token_snapshot"), ev("token_snapshot")];

    // All Events drops the token rows...
    const all = filterTimelineEvents(events, "all", true);
    expect(all.some((event) => event.kind === "token_snapshot")).toBe(false);
    expect(all).toHaveLength(2);
    // ...but the dedicated Tokens tab still shows them.
    expect(filterTimelineEvents(events, "tokens", true)).toHaveLength(2);
    // Default (hideTokens=false) is unchanged.
    expect(filterTimelineEvents(events, "all")).toHaveLength(4);
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

describe("TIME_WINDOWS", () => {
  it("exposes 1H/4H/12H/ALL in fixed order with ALL as 0ms", () => {
    expect(TIME_WINDOWS.map((option) => option.label)).toEqual(["1H", "4H", "12H", "ALL"]);
    expect(TIME_WINDOWS.map((option) => option.ms)).toEqual([3_600_000, 14_400_000, 43_200_000, 0]);
  });
});

describe("sortTimelineEvents", () => {
  it("orders events by their created-at timestamp", () => {
    const out = sortTimelineEvents([
      at("task_complete", "2026-05-27T18:00:00.000Z"),
      at("task_started", "2026-05-27T12:00:00.000Z"),
      at("tool_call", "2026-05-27T15:00:00.000Z"),
    ]);
    expect(out.map((event) => event.timestamp)).toEqual([
      "2026-05-27T12:00:00.000Z",
      "2026-05-27T15:00:00.000Z",
      "2026-05-27T18:00:00.000Z",
    ]);
  });

  it("breaks timestamp ties by sourceLine for a deterministic order", () => {
    const ts = "2026-05-27T12:00:00.000Z";
    const out = sortTimelineEvents([
      ev("assistant_message", { id: "b", timestamp: ts, sourceLine: 9 }),
      ev("tool_call", { id: "a", timestamp: ts, sourceLine: 4 }),
    ]);
    expect(out.map((event) => event.id)).toEqual(["a", "b"]);
  });

  it("is stable when both timestamp and sourceLine tie (preserves input order)", () => {
    const ts = "2026-05-27T12:00:00.000Z";
    const out = sortTimelineEvents([
      ev("tool_call", { id: "first", timestamp: ts, sourceLine: 1 }),
      ev("tool_result", { id: "second", timestamp: ts, sourceLine: 1 }),
    ]);
    expect(out.map((event) => event.id)).toEqual(["first", "second"]);
  });

  it("anchors events with unparseable timestamps next to the prior valid event", () => {
    const out = sortTimelineEvents([
      at("task_started", "2026-05-27T12:00:00.000Z"),
      ev("warning", { id: "bad", timestamp: "not-a-date", severity: "warning" }),
      at("task_complete", "2026-05-27T18:00:00.000Z"),
    ]);
    // "bad" inherits 12:00, so it sorts between the 12:00 and 18:00 events
    // rather than being flung to the front (time 0) or dropped.
    expect(out.map((event) => event.id)).toEqual([out[0].id, "bad", out[2].id]);
    expect(out[2].timestamp).toBe("2026-05-27T18:00:00.000Z");
  });

  it("returns an empty array unchanged", () => {
    expect(sortTimelineEvents([])).toEqual([]);
  });
});

describe("windowTimelineEvents", () => {
  // refNow is the latest event (18:00); the window measures backwards from it.
  const events = [
    at("task_started", "2026-05-27T12:00:00.000Z"), // 6h before latest
    at("tool_call", "2026-05-27T15:00:00.000Z"), // 3h before latest
    at("assistant_message", "2026-05-27T17:30:00.000Z"), // 30m before latest
    at("task_complete", "2026-05-27T18:00:00.000Z"), // latest = refNow
  ];

  it("returns everything for windowMs 0 (ALL)", () => {
    expect(windowTimelineEvents(events, 0)).toHaveLength(4);
  });

  it("trims relative to the latest event, not the wall clock", () => {
    const within1h = windowTimelineEvents(events, 3_600_000).map((event) => event.kind);
    expect(within1h).toEqual(["assistant_message", "task_complete"]);
  });

  it("includes events exactly on the window boundary", () => {
    // 3h window keeps the 15:00 event (exactly 3h before the 18:00 reference).
    const within3h = windowTimelineEvents(events, 3 * 3_600_000).map((event) => event.kind);
    expect(within3h).toEqual(["tool_call", "assistant_message", "task_complete"]);
  });

  it("always keeps the newest event (window is never empty for non-empty input)", () => {
    expect(windowTimelineEvents(events, 1)).toEqual([events[3]]);
  });

  it("returns an empty array unchanged", () => {
    expect(windowTimelineEvents([], 3_600_000)).toEqual([]);
  });

  it("keeps events with unparseable timestamps rather than dropping them", () => {
    const withBad = [...events, at("warning", "not-a-date")];
    expect(windowTimelineEvents(withBad, 3_600_000).some((event) => event.kind === "warning")).toBe(true);
  });
});
