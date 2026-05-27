import type { IncomingMessage, ServerResponse } from "node:http";

import {
  agentGraphFixture,
  diagnosticsLogsFixture,
  sessionSummariesFixture,
  timelineEventsFixture,
  tokenSeriesFixture,
} from "../../fixtures/observatoryFixtures";
import type { ApiError, ApiResult, HealthStatus } from "../../shared/contracts";

const checkedAt = "2026-05-26T18:05:00.000Z";

const baseCorsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, OPTIONS",
  "cache-control": "no-store",
};

function corsHeadersForOrigin(origin: string | undefined) {
  if (!origin) {
    return baseCorsHeaders;
  }

  try {
    const url = new URL(origin);
    const isLoopback =
      url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);

    if (isLoopback) {
      return {
        ...baseCorsHeaders,
        "access-control-allow-origin": url.origin,
        vary: "Origin",
      };
    }
  } catch {
    return baseCorsHeaders;
  }

  return baseCorsHeaders;
}

function ok<T>(data: T): ApiResult<T> {
  return {
    ok: true,
    data,
    source: "fixture",
    warnings: [],
  };
}

function fail(error: ApiError): ApiResult<never> {
  return {
    ok: false,
    error,
    source: "fixture",
    warnings: [],
  };
}

function writeJson(response: ServerResponse, status: number, body: ApiResult<unknown>, origin?: string) {
  response.writeHead(status, {
    ...corsHeadersForOrigin(origin),
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}

export function handleFixtureApiRequest(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeadersForOrigin(origin));
    response.end();
    return true;
  }

  if (request.method !== "GET") {
    writeJson(
      response,
      405,
      fail({
        code: "method_not_allowed",
        message: "Fixture API only supports GET requests.",
      }),
      origin,
    );
    return true;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/api/health") {
    const health: HealthStatus = {
      status: "ok",
      mode: "fixture",
      checkedAt,
    };

    writeJson(response, 200, ok(health), origin);
    return true;
  }

  if (url.pathname === "/api/sessions") {
    writeJson(response, 200, ok(sessionSummariesFixture), origin);
    return true;
  }

  if (url.pathname === "/api/timeline") {
    const threadId = url.searchParams.get("threadId");
    const events = threadId
      ? timelineEventsFixture.filter((event) => event.threadId === threadId)
      : timelineEventsFixture;

    writeJson(response, 200, ok(events), origin);
    return true;
  }

  if (url.pathname === "/api/agent-graph") {
    writeJson(response, 200, ok(agentGraphFixture), origin);
    return true;
  }

  if (url.pathname === "/api/tokens") {
    writeJson(response, 200, ok(tokenSeriesFixture), origin);
    return true;
  }

  if (url.pathname === "/api/logs") {
    writeJson(response, 200, ok(diagnosticsLogsFixture), origin);
    return true;
  }

  writeJson(
    response,
    404,
    fail({
      code: "not_found",
      message: `Fixture API route not found: ${url.pathname}`,
    }),
    origin,
  );
  return true;
}
