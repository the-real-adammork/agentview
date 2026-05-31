import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";

import {
  agentGraphFixture,
  diagnosticsLogsFixture,
  sessionSummariesFixture,
  timelineEventsFixture,
  tokenSeriesFixture,
} from "../../src/fixtures/observatoryFixtures";
import type {
  AgentEdge,
  AgentGraph,
  ApiResult,
  EdgeSource,
  ObservatoryApi,
  RuntimeLog,
  SessionFilter,
  SessionSummary,
  SourceId,
  TimelineEvent,
  TokenSeries,
} from "../../src/shared/contracts";
import type {
  LiveChannel,
  LiveTimelinePayload,
  LiveReadyPayload,
} from "../../src/shared/contracts";
import { observedEventMsg, observedResponseItem } from "../fixtures/codexHome";
import { createObservedDiagnosticsCodexHomeFixture } from "../fixtures/diagnostics";

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
      lastInput: expect.any(Number),
      lastOutput: expect.any(Number),
      modelContextWindow: expect.any(Number),
      planType: expect.any(String),
      rateLimitPrimaryPercentRaw: expect.any(Number),
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

  it("provides observed rollout envelope builders for event_msg and response_item records", () => {
    expect(
      observedEventMsg({
        timestamp: "2026-05-26T18:00:00.000Z",
        turnId: "turn-1",
        payload: {
          type: "task_started",
          turn_context: { model: "gpt-codex-5", approval_policy: "never" },
        },
      }),
    ).toMatchObject({
      type: "event_msg",
      timestamp: "2026-05-26T18:00:00.000Z",
      turn_id: "turn-1",
      payload: {
        type: "task_started",
        turn_context: expect.any(Object),
      },
    });

    expect(
      observedResponseItem({
        timestamp: "2026-05-26T18:00:01.000Z",
        turnId: "turn-1",
        payload: {
          type: "function_call_output",
          call_id: "call-1",
          output: "{\"exit_code\":1,\"output\":\"failed\"}",
        },
      }),
    ).toMatchObject({
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
      },
    });
  });

  it("creates observed logs_2.sqlite fixture records without derived command columns", async () => {
    const fixture = await createObservedDiagnosticsCodexHomeFixture({
      logs: [
        {
          timestampMs: 1779818400123,
          timestampNanos: 123456789,
          level: "WARN",
          target: "codex_core::session",
          body: "observed warning body",
          threadId: "thread-observed",
          processUuid: "proc-observed",
        },
      ],
    });

    try {
      const db = new DatabaseSync(fixture.logsDbPath, { readOnly: true });
      const columns = db.prepare("PRAGMA table_info(logs)").all().map((row) => String((row as { name: unknown }).name));
      const row = db.prepare("SELECT ts, ts_nanos, feedback_log_body, estimated_bytes FROM logs").get() as {
        ts: number;
        ts_nanos: number;
        feedback_log_body: string;
        estimated_bytes: number;
      };
      db.close();

      expect(columns).toEqual(expect.arrayContaining(["ts", "ts_nanos", "feedback_log_body", "estimated_bytes"]));
      expect(columns).not.toContain("command");
      expect(row).toMatchObject({
        ts: 1779818400,
        ts_nanos: 123456789,
        feedback_log_body: "observed warning body",
        estimated_bytes: expect.any(Number),
      });
    } finally {
      await fixture.cleanup();
    }
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
            turns: [],
            agentLaunches: [],
            agentWaits: [],
            summary: {
              eventCount: timelineEventsFixture.length,
              turnCount: 1,
              toolCallCount: 0,
              failedToolCallCount: 0,
              tokenSnapshotCount: 0,
              agentLaunchCount: 0,
              agentWaitCount: 0,
              warningCount: 0,
              parsedThroughByte: 0,
            },
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
        data: {
          logs: diagnosticsLogsFixture,
          nextCursor: null,
        },
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

describe("source adapter contracts", () => {
  it("declares SourceId as the codex|claude-code union and carries it on SessionSummary", () => {
    const codex: SourceId = "codex";
    const claudeCode: SourceId = "claude-code";
    expect([codex, claudeCode]).toEqual(["codex", "claude-code"]);

    const summary: SessionSummary = {
      id: "thread-1",
      source: "codex",
      title: "t",
      status: "complete",
      updatedAt: new Date(0).toISOString(),
      branch: "",
      cwd: "/repo",
      model: "",
      lastMessage: "",
      childCount: 0,
      openChildCount: 0,
      tokenTotal: 0,
    };
    expect(summary.source).toBe("codex");
  });

  it("narrows the merged session list with SessionFilter.source", () => {
    const filter: SessionFilter = { source: "codex" };
    expect(filter.source).toBe("codex");
  });

  it("defines EdgeSource as native|reconstructed and stamps native on a tool-native edge", () => {
    const nativeEdge: EdgeSource = "native";
    const reconstructed: EdgeSource = "reconstructed";
    expect([nativeEdge, reconstructed]).toEqual(["native", "reconstructed"]);

    const edge: AgentEdge = {
      parentId: "p",
      childId: "c",
      status: "closed",
      source: "native",
    };
    expect(edge.source).toBe("native");

    const summary: SessionSummary = {
      id: "child",
      source: "codex",
      title: "t",
      status: "complete",
      updatedAt: new Date(0).toISOString(),
      branch: "",
      cwd: "/repo",
      model: "",
      lastMessage: "",
      childCount: 0,
      openChildCount: 0,
      tokenTotal: 0,
      parentId: "parent",
      parentEdgeSource: "native",
    };
    expect(summary.parentEdgeSource).toBe("native");
  });
});

describe("live stream contracts", () => {
  it("types a timeline delta payload with append/reset semantics", () => {
    const payload: LiveTimelinePayload = {
      threadId: "thread-1",
      events: [],
      nextByteOffset: 42,
      reset: false,
      warnings: [],
    };
    expect(payload.nextByteOffset).toBe(42);
    expect(payload.reset).toBe(false);
  });

  it("types a ready control payload and channel union", () => {
    const channels: LiveChannel[] = ["sessions", "timeline", "tokens", "diagnostics", "ready", "error"];
    const ready: LiveReadyPayload = { threadId: null, nextByteOffset: null, logCursorId: null };
    expect(channels).toContain("ready");
    expect(ready.threadId).toBeNull();
  });
});
