import {
  agentGraphFixture,
  diagnosticsLogsFixture,
  sessionSummariesFixture,
  timelineEventsFixture,
  tokenSeriesFixture,
} from "../../fixtures/observatoryFixtures";
import type {
  AgentGraph,
  ApiResult,
  HealthStatus,
  ObservatoryApi,
  PageOptions,
  RuntimeLog,
  RuntimeLogPage,
  RuntimeLogQuery,
  RawTuiLogTail,
  SessionFilter,
  SessionSummary,
  TimelineEvent,
  TimelinePayload,
  TokenSeries,
} from "../../shared/contracts";

const checkedAt = "2026-05-26T18:05:00.000Z";

const ok = <T,>(data: T): ApiResult<T> => ({
  ok: true,
  data,
  source: "fixture",
  warnings: [],
});

export interface FixtureSnapshot {
  health: HealthStatus;
  sessions: SessionSummary[];
  timelineEvents: TimelineEvent[];
  agentGraph: AgentGraph;
  tokenSeries: TokenSeries;
  diagnosticsLogs: RuntimeLog[];
}

export function createFixtureSnapshot(): FixtureSnapshot {
  return {
    health: {
      status: "ok",
      mode: "fixture",
      checkedAt,
    },
    sessions: sessionSummariesFixture,
    timelineEvents: timelineEventsFixture,
    agentGraph: agentGraphFixture,
    tokenSeries: tokenSeriesFixture,
    diagnosticsLogs: diagnosticsLogsFixture,
  };
}

export const fixtureApiClient: ObservatoryApi = {
  async getHealth() {
    return ok(createFixtureSnapshot().health);
  },
  async listSessions() {
    return ok(sessionSummariesFixture);
  },
  async getTimeline(threadId) {
    const events = timelineEventsFixture.filter((event) => event.threadId === threadId);
    return ok({
      threadId,
      events,
      facts: {
        threadId,
        rolloutPath: "fixture://timeline",
        parserVersion: 1,
        sourceMtimeMs: 0,
        sourceSizeBytes: 0,
        parsedThroughByte: events.length,
        events,
        toolCalls: [],
        tokenSnapshots: [],
        turns: [],
        agentLaunches: [],
        agentWaits: [],
        summary: {
          eventCount: events.length,
          turnCount: new Set(events.map((event) => event.turnId).filter(Boolean)).size,
          toolCallCount: 0,
          failedToolCallCount: 0,
          tokenSnapshotCount: 0,
          agentLaunchCount: events.filter((event) => event.kind === "agent_launch").length,
          agentWaitCount: events.filter((event) => event.kind === "agent_wait").length,
          warningCount: events.filter((event) => event.severity !== "info").length,
          parsedThroughByte: events.length,
        },
        warnings: [],
      },
      nextByteOffset: events.length,
      cacheStatus: "cold",
    });
  },
  async getAgentGraph() {
    return ok(agentGraphFixture);
  },
  async getTokenSeries() {
    return ok(tokenSeriesFixture);
  },
  async queryLogs() {
    return ok({ logs: diagnosticsLogsFixture, nextCursor: null });
  },
};

const apiBaseUrl = (import.meta.env.VITE_AGENTVIEW_API_BASE_URL ?? "http://127.0.0.1:4317").replace(/\/$/, "");

const appendParam = (params: URLSearchParams, name: string, value: string | number | undefined) => {
  if (value === undefined) {
    return;
  }

  if (typeof value === "string" && value.trim() === "") {
    return;
  }

  params.set(name, String(value));
};

export const buildSessionQuery = (filter: SessionFilter = {}, page: PageOptions = {}) => {
  const params = new URLSearchParams();

  appendParam(params, "search", filter.search?.trim());
  appendParam(params, "cwd", filter.cwd);
  appendParam(params, "repo", filter.repo);
  appendParam(params, "archived", filter.archived);
  // `source` is the thread-source axis (user/subagent); `sourceId` is the
  // SourceId dispatch discriminator (codex/claude-code). Distinct wire params.
  appendParam(params, "source", filter.threadSource);
  appendParam(params, "sourceId", filter.source);
  appendParam(params, "role", filter.agentRole);
  appendParam(params, "model", filter.model);
  appendParam(params, "minTokens", filter.minTokens);
  appendParam(params, "maxTokens", filter.maxTokens);
  appendParam(params, "warningStatus", filter.warningCountStatus);
  appendParam(params, "failedToolStatus", filter.failedToolCountStatus);
  appendParam(params, "updatedAfterMs", filter.updatedAfterMs);
  appendParam(params, "updatedBeforeMs", filter.updatedBeforeMs);
  appendParam(params, "createdAfterMs", filter.createdAfterMs);
  appendParam(params, "createdBeforeMs", filter.createdBeforeMs);
  appendParam(params, "limit", page.limit);
  appendParam(params, "offset", page.offset);

  const query = params.toString();
  return query ? `?${query}` : "";
};

const buildLogQuery = (query: RuntimeLogQuery = {}) => {
  const params = new URLSearchParams();

  appendParam(params, "level", query.level);
  appendParam(params, "target", query.target);
  appendParam(params, "threadId", query.threadId);
  appendParam(params, "scope", query.scope);
  appendParam(params, "limit", query.limit);
  appendParam(params, "cursor", query.cursor);

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // fetch only rejects on a transport failure (server down, DNS, CORS). Surface
    // an actionable message instead of the browser's bare "Failed to fetch".
    return {
      ok: false,
      source: "client",
      warnings: [],
      error: {
        code: "API_UNREACHABLE",
        message: `Cannot reach the AgentView API at ${apiBaseUrl}. Is the API server running (npm run api)?`,
      },
    };
  }

  let body: ApiResult<T>;
  try {
    body = (await response.json()) as ApiResult<T>;
  } catch {
    return {
      ok: false,
      source: "client",
      warnings: [],
      error: {
        code: "INVALID_RESPONSE",
        message: `The AgentView API returned a non-JSON response (HTTP ${response.status}).`,
      },
    };
  }

  if (!response.ok && body.ok) {
    return {
      ok: false,
      source: body.source,
      warnings: body.warnings,
      error: {
        code: "HTTP_ERROR",
        message: `HTTP ${response.status}`,
      },
    };
  }

  return body;
}

/**
 * Fetch the raw (verbatim, unredacted) rollout JSONL for a set of source lines.
 * Returns NDJSON text; throws with the server's message on failure. Used by the
 * timeline raw export, which sends the filtered events' `sourceLine`s.
 */
export async function getRawTimeline(
  threadId: string,
  sourceLines: number[],
  includeResults = true,
): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/api/timeline/raw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, sourceLines, includeResults }),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body; keep the HTTP status message
    }
    throw new Error(message);
  }
  return response.text();
}

const getJson = <T>(path: string): Promise<ApiResult<T>> => requestJson<T>(path);

const postJson = <T>(path: string, payload: unknown): Promise<ApiResult<T>> =>
  requestJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

export const realApiClient: ObservatoryApi = {
  getHealth() {
    return getJson<HealthStatus>("/api/health");
  },
  listSessions(filter, page) {
    return getJson<SessionSummary[]>(`/api/sessions${buildSessionQuery(filter, page)}`);
  },
  getThread(threadId, options) {
    void options;
    return getJson<SessionSummary>(`/api/sessions/${encodeURIComponent(threadId)}`);
  },
  getTimeline(threadId, options) {
    const params = new URLSearchParams({ threadId });
    if (options?.fromByte !== undefined) {
      params.set("fromByte", String(options.fromByte));
    }
    if (options?.subtree) {
      params.set("subtree", "1");
    }
    return getJson<TimelinePayload>(`/api/timeline?${params.toString()}`);
  },
  getAgentGraph(rootThreadId, options) {
    const params = new URLSearchParams({ rootThreadId });
    if (options?.maxDepth !== undefined) {
      params.set("maxDepth", String(options.maxDepth));
    }
    return getJson<AgentGraph>(`/api/agent-graph?${params.toString()}`);
  },
  getTokenSeries(threadId) {
    return getJson<TokenSeries>(`/api/tokens?threadId=${encodeURIComponent(threadId)}`);
  },
  queryLogs(query) {
    return getJson<RuntimeLogPage>(`/api/logs${buildLogQuery(query)}`);
  },
  getDiagnosticsSummary(options) {
    // POST so the (potentially hundreds of) thread ids travel in the body instead
    // of an over-length query string that the server would reject.
    const threadIds = (options?.threadIds ?? []).filter((threadId) => threadId.trim());
    return postJson("/api/diagnostics/summary", {
      threadIds,
      ...(options?.targetLimit !== undefined ? { targetLimit: options.targetLimit } : {}),
      ...(options?.includeFailedCommands !== undefined ? { includeFailedCommands: options.includeFailedCommands } : {}),
    });
  },
  tailRawTuiLog(options) {
    const params = new URLSearchParams();
    appendParam(params, "fromByte", options?.fromByte);
    appendParam(params, "maxBytes", options?.maxBytes);
    const queryString = params.toString();
    return getJson<RawTuiLogTail>(`/api/diagnostics/raw-tail${queryString ? `?${queryString}` : ""}`);
  },
};
