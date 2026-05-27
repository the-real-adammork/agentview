import { describe, expect, it } from "vitest";

import {
  agentGraphFixture,
  diagnosticsLogsFixture,
  sessionSummariesFixture,
  timelineEventsFixture,
  tokenSeriesFixture,
} from "../../src/fixtures/observatoryFixtures";
import type {
  AgentGraph,
  ApiResult,
  ObservatoryApi,
  RuntimeLog,
  SessionSummary,
  TimelineEvent,
  TokenSeries,
} from "../../src/shared/contracts";

const expectFixtureResult = <T>(result: ApiResult<T>) => {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  expect(result.source).toBe("fixture");
  expect(result.warnings).toEqual([]);

  return result.data;
};

describe("observatory Task 2 contract fixtures", () => {
  it("wraps session summaries in the shared ApiResult fixture envelope", () => {
    const sessions: SessionSummary[] = sessionSummariesFixture;
    const result: ApiResult<SessionSummary[]> = {
      ok: true,
      data: sessions,
      source: "fixture",
      warnings: [],
    };

    const [session] = expectFixtureResult(result);

    expect(sessions.length).toBeGreaterThanOrEqual(3);
    expect(session).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      status: expect.stringMatching(/^(running|complete|failed|paused)$/),
      updatedAt: expect.any(String),
      branch: expect.any(String),
      cwd: expect.any(String),
      model: expect.any(String),
      lastMessage: expect.any(String),
      childCount: expect.any(Number),
      openChildCount: expect.any(Number),
      tokenTotal: expect.any(Number),
    });
  });

  it("provides timeline events for lifecycle, tools, tokens, agents, and warnings", () => {
    const events: TimelineEvent[] = timelineEventsFixture;
    const result: ApiResult<TimelineEvent[]> = {
      ok: true,
      data: events,
      source: "fixture",
      warnings: [],
    };

    const timeline = expectFixtureResult(result);
    const kinds = new Set(timeline.map((event) => event.kind));

    expect(timeline.length).toBeGreaterThanOrEqual(12);
    expect(kinds.has("task_started")).toBe(true);
    expect(kinds.has("user_message")).toBe(true);
    expect(kinds.has("assistant_message")).toBe(true);
    expect(kinds.has("tool_call")).toBe(true);
    expect(kinds.has("tool_result")).toBe(true);
    expect(kinds.has("token_snapshot")).toBe(true);
    expect(kinds.has("agent_launch")).toBe(true);
    expect(kinds.has("agent_wait")).toBe(true);
    expect(kinds.has("warning")).toBe(true);
    expect(kinds.has("task_complete")).toBe(true);
    expect(timeline[0]).toMatchObject({
      id: expect.any(String),
      threadId: expect.any(String),
      timestamp: expect.any(String),
      sourceLine: expect.any(Number),
      kind: expect.any(String),
      severity: expect.stringMatching(/^(info|warning|error)$/),
      previewText: expect.any(String),
    });
    expect(timeline.find((event) => event.kind === "tool_result")).toMatchObject({
      callId: expect.any(String),
      toolName: expect.any(String),
      outputPreview: expect.any(String),
      outputBytes: expect.any(Number),
      isCollapsedByDefault: expect.any(Boolean),
      hasRawAvailable: expect.any(Boolean),
    });
  });

  it("provides a graph fixture with root, nodes, edges, and open-child summary", () => {
    const graph: AgentGraph = agentGraphFixture;
    const result: ApiResult<AgentGraph> = {
      ok: true,
      data: graph,
      source: "fixture",
      warnings: [],
    };

    const data = expectFixtureResult(result);

    expect(data.root).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      status: expect.any(String),
      depth: 0,
      tokenTotal: expect.any(Number),
    });
    expect(data.nodes.length).toBeGreaterThan(data.edges.length);
    expect(data.edges).toContainEqual(
      expect.objectContaining({
        parentId: data.root.id,
        childId: expect.any(String),
        status: expect.stringMatching(/^(open|closed|failed)$/),
      }),
    );
    expect(data.maxDepth).toBeGreaterThanOrEqual(2);
    expect(data.openCount).toBeGreaterThanOrEqual(1);
    expect(data.statusSummary).toEqual(
      expect.objectContaining({
        open: expect.any(Number),
        closed: expect.any(Number),
      }),
    );
  });

  it("provides token snapshots with aggregate totals and ratio empty-state data", () => {
    const series: TokenSeries = tokenSeriesFixture;
    const result: ApiResult<TokenSeries> = {
      ok: true,
      data: series,
      source: "fixture",
      warnings: [],
    };

    const data = expectFixtureResult(result);

    expect(data.snapshots.length).toBeGreaterThanOrEqual(3);
    expect(data.snapshots[0]).toMatchObject({
      timestamp: expect.any(String),
      total: expect.any(Number),
      input: expect.any(Number),
      output: expect.any(Number),
      cachedInput: expect.any(Number),
    });
    expect(data.totals).toMatchObject({
      input: expect.any(Number),
      cachedInput: expect.any(Number),
      output: expect.any(Number),
      reasoningOutput: expect.any(Number),
      total: expect.any(Number),
    });
    expect(data.cachedInputRatio).toEqual(expect.any(Number));
    expect(data.emptyStateReasons).toEqual(expect.any(Array));
  });

  it("provides diagnostics logs with redacted body previews", () => {
    const logs: RuntimeLog[] = diagnosticsLogsFixture;
    const result: ApiResult<RuntimeLog[]> = {
      ok: true,
      data: logs,
      source: "fixture",
      warnings: [],
    };

    const data = expectFixtureResult(result);

    expect(data.length).toBeGreaterThanOrEqual(5);
    expect(data[0]).toMatchObject({
      id: expect.any(String),
      timestampMs: expect.any(Number),
      level: expect.stringMatching(/^(TRACE|DEBUG|INFO|WARN|ERROR)$/),
      target: expect.any(String),
      bodyPreview: expect.any(String),
      estimatedBytes: expect.any(Number),
      redactionApplied: expect.any(Boolean),
    });
    expect(data.some((log) => log.redactionApplied)).toBe(true);
  });

  it("extends ObservatoryApi with all fixture-backed Task 2 view methods", () => {
    const api: Pick<
      ObservatoryApi,
      "listSessions" | "getTimeline" | "getAgentGraph" | "getTokenSeries" | "queryLogs"
    > = {
      listSessions: async () => ({
        ok: true,
        data: sessionSummariesFixture,
        source: "fixture",
        warnings: [],
      }),
      getTimeline: async () => ({
        ok: true,
        data: {
          threadId: "fixture-thread",
          events: timelineEventsFixture,
          facts: {
            threadId: "fixture-thread",
            rolloutPath: "fixture://timeline",
            parserVersion: 1,
            sourceMtimeMs: 0,
            sourceSizeBytes: 0,
            parsedThroughByte: 0,
            events: timelineEventsFixture,
            toolCalls: [],
            tokenSnapshots: [],
            warnings: [],
          },
          nextByteOffset: 0,
          cacheStatus: "cold",
        },
        source: "fixture",
        warnings: [],
      }),
      getAgentGraph: async () => ({
        ok: true,
        data: agentGraphFixture,
        source: "fixture",
        warnings: [],
      }),
      getTokenSeries: async () => ({
        ok: true,
        data: tokenSeriesFixture,
        source: "fixture",
        warnings: [],
      }),
      queryLogs: async () => ({
        ok: true,
        data: diagnosticsLogsFixture,
        source: "fixture",
        warnings: [],
      }),
    };

    expect(api.getTimeline).toBeTypeOf("function");
    expect(api.getAgentGraph).toBeTypeOf("function");
    expect(api.getTokenSeries).toBeTypeOf("function");
    expect(api.queryLogs).toBeTypeOf("function");
  });
});
