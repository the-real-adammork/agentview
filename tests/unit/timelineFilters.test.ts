import { describe, expect, it } from "vitest";

import {
  EVENT_TYPES,
  TIME_WINDOWS,
  TIMELINE_FILTERS,
  TOOL_TYPES,
  eventTypeCounts,
  eventTypeKey,
  filterByEventTypes,
  filterByToolTypes,
  filterTimelineEvents,
  sortTimelineEvents,
  timelineFilterCount,
  toolTypeCounts,
  toolTypeKey,
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

describe("tool sub-type filter", () => {
  const toolWith = (kind?: TimelineEvent["outputRender"]) => ev("tool_call", { outputRender: kind });

  it("exposes the typed exec-renderer kinds plus an Other bucket, in order", () => {
    expect(TOOL_TYPES.map((type) => type.key)).toEqual([
      "diff",
      "matches",
      "status",
      "diffstat",
      "tree",
      "file",
      "http",
      "table",
      "tests",
      "build",
      "lint",
      "log",
      "json",
      "trace",
      "git",
      "compose",
      "read",
      "search_call",
      "fetch",
      "agent",
      "tool_search",
      "other",
    ]);
    expect(TOOL_TYPES.find((type) => type.key === "matches")?.label).toBe("Search");
    expect(TOOL_TYPES.find((type) => type.key === "tree")?.label).toBe("Tree");
  });

  describe("toolTypeKey", () => {
    it("returns the typed render kind of a tool call", () => {
      expect(toolTypeKey(toolWith({ kind: "tree", entries: [] }))).toBe("tree");
      expect(toolTypeKey(toolWith({ kind: "status", files: [] }))).toBe("status");
    });

    it("maps the new typed render kinds to their own key (not 'other')", () => {
      expect(toolTypeKey(toolWith({ kind: "build", tool: "cargo", errors: 0, warnings: 0, diagnostics: [] }))).toBe("build");
      expect(toolTypeKey(toolWith({ kind: "lint", tool: "eslint", errors: 0, warnings: 0, files: [] }))).toBe("lint");
      expect(toolTypeKey(toolWith({ kind: "log", total: 0, commits: [] }))).toBe("log");
      expect(toolTypeKey(toolWith({ kind: "json", value: {} }))).toBe("json");
      expect(toolTypeKey(toolWith({ kind: "trace", lang: "python", exception: "E", message: "", frames: [] }))).toBe("trace");
      expect(toolTypeKey(toolWith({ kind: "compose", resources: [] }))).toBe("compose");
    });

    it("maps a call-rendered tool (no output render) by its callRender kind", () => {
      expect(toolTypeKey(ev("tool_call", { callRender: { kind: "fetch", mode: "search", query: "x" } }))).toBe("fetch");
      expect(toolTypeKey(ev("tool_call", { callRender: { kind: "agent", op: "spawn" } }))).toBe("agent");
      expect(toolTypeKey(ev("tool_call", { callRender: { kind: "tool_search", query: "x", resultCount: 0, namespaces: [] } }))).toBe(
        "tool_search",
      );
    });

    it("buckets plain / unclassified tool calls as 'other'", () => {
      expect(toolTypeKey(toolWith(undefined))).toBe("other");
      expect(toolTypeKey(toolWith({ kind: "plain" }))).toBe("other");
    });

    it("returns null for non-tool events (they aren't governed by this filter)", () => {
      expect(toolTypeKey(ev("assistant_message"))).toBeNull();
      expect(toolTypeKey(ev("reasoning"))).toBeNull();
    });
  });

  describe("filterByToolTypes", () => {
    const events = [
      ev("assistant_message"),
      toolWith({ kind: "tree", entries: [] }),
      toolWith({ kind: "matches", files: [] }),
      toolWith(undefined), // other
    ];
    const allKeys = new Set(TOOL_TYPES.map((type) => type.key));

    it("is identity when every type is enabled", () => {
      expect(filterByToolTypes(events, allKeys)).toHaveLength(4);
    });

    it("mutes tool rows whose type is disabled, leaving non-tool events untouched", () => {
      const enabled = new Set(allKeys);
      enabled.delete("tree");
      const out = filterByToolTypes(events, enabled);
      expect(out).toHaveLength(3);
      expect(out.some((event) => event.outputRender?.kind === "tree")).toBe(false);
      expect(out.some((event) => event.kind === "assistant_message")).toBe(true);
    });

    it("keeps only the enabled tool types when narrowed to one", () => {
      const out = filterByToolTypes(events, new Set(["matches"]));
      // assistant_message stays (non-tool), only the matches tool row survives
      expect(out.map((event) => event.kind)).toEqual(["assistant_message", "tool_call"]);
      expect(out[1].outputRender?.kind).toBe("matches");
    });
  });

  describe("toolTypeCounts", () => {
    it("counts tool rows per type, ignoring non-tool events", () => {
      const counts = toolTypeCounts([
        ev("assistant_message"),
        toolWith({ kind: "status", files: [] }),
        toolWith({ kind: "status", files: [] }),
        toolWith(undefined),
      ]);
      expect(counts.status).toBe(2);
      expect(counts.other).toBe(1);
      expect(counts.diff).toBeUndefined();
    });
  });
});

describe("event-type filter", () => {
  it("exposes the non-tool event kinds, in order", () => {
    expect(EVENT_TYPES.map((type) => type.key)).toEqual([
      "user_message",
      "assistant_message",
      "reasoning",
      "turn_context",
      "task_started",
      "task_complete",
      "agent_message",
      "warning",
    ]);
    expect(EVENT_TYPES.find((type) => type.key === "agent_message")?.label).toBe("Agent Report");
    expect(EVENT_TYPES.find((type) => type.key === "assistant_message")?.label).toBe("Assistant");
  });

  describe("eventTypeKey", () => {
    it("returns the kind for a managed event type", () => {
      expect(eventTypeKey(ev("reasoning"))).toBe("reasoning");
      expect(eventTypeKey(ev("turn_context"))).toBe("turn_context");
    });
    it("returns null for kinds this filter does not manage", () => {
      expect(eventTypeKey(ev("tool_call"))).toBeNull();
      expect(eventTypeKey(ev("agent_launch"))).toBeNull();
      expect(eventTypeKey(ev("token_snapshot"))).toBeNull();
    });
  });

  describe("filterByEventTypes", () => {
    const events = [
      ev("user_message"),
      ev("reasoning"),
      ev("agent_launch"),
      ev("tool_call"),
      ev("turn_context"),
    ];
    const allKeys = new Set(EVENT_TYPES.map((type) => type.key));

    it("is identity when every type is enabled", () => {
      expect(filterByEventTypes(events, allKeys)).toHaveLength(5);
    });

    it("mutes a disabled kind, leaving unmanaged kinds untouched", () => {
      const enabled = new Set(allKeys);
      enabled.delete("reasoning");
      const out = filterByEventTypes(events, enabled);
      expect(out.some((event) => event.kind === "reasoning")).toBe(false);
      // agent_launch + tool_call are not managed by this filter → always kept
      expect(out.some((event) => event.kind === "agent_launch")).toBe(true);
      expect(out.some((event) => event.kind === "tool_call")).toBe(true);
      expect(out).toHaveLength(4);
    });
  });

  describe("eventTypeCounts", () => {
    it("counts managed kinds, ignoring others", () => {
      const counts = eventTypeCounts([ev("reasoning"), ev("reasoning"), ev("user_message"), ev("tool_call")]);
      expect(counts.reasoning).toBe(2);
      expect(counts.user_message).toBe(1);
      expect(counts.tool_call).toBeUndefined();
    });
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
