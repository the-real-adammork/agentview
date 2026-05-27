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
  SessionFilter,
  SessionSummary,
  TimelineEvent,
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
    return ok(timelineEventsFixture.filter((event) => event.threadId === threadId));
  },
  async getAgentGraph() {
    return ok(agentGraphFixture);
  },
  async getTokenSeries() {
    return ok(tokenSeriesFixture);
  },
  async queryLogs() {
    return ok(diagnosticsLogsFixture);
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
  appendParam(params, "archived", filter.archived);
  appendParam(params, "source", filter.threadSource);
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

async function getJson<T>(path: string): Promise<ApiResult<T>> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      accept: "application/json",
    },
  });
  const body = (await response.json()) as ApiResult<T>;

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

export const realApiClient: ObservatoryApi = {
  getHealth() {
    return getJson<HealthStatus>("/api/health");
  },
  listSessions(filter, page) {
    return getJson<SessionSummary[]>(`/api/sessions${buildSessionQuery(filter, page)}`);
  },
  getThread(threadId) {
    return getJson<SessionSummary>(`/api/sessions/${encodeURIComponent(threadId)}`);
  },
  getTimeline(threadId) {
    return getJson<TimelineEvent[]>(`/api/timeline?threadId=${encodeURIComponent(threadId)}`);
  },
  getAgentGraph(rootThreadId) {
    return getJson<AgentGraph>(`/api/agent-graph?rootThreadId=${encodeURIComponent(rootThreadId)}`);
  },
  getTokenSeries(threadId) {
    return getJson<TokenSeries>(`/api/tokens?threadId=${encodeURIComponent(threadId)}`);
  },
  queryLogs() {
    return getJson<RuntimeLog[]>("/api/logs");
  },
};
