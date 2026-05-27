import { createServer } from "node:http";

import { handleAgentGraphApiRequest } from "./api/agentGraph";
import { handleDiagnosticsApiRequest } from "./api/diagnostics";
import { handleFixtureApiRequest } from "./api/fixtures";
import { corsHeadersForOrigin } from "./api/http";
import { handleHealthApiRequest } from "./api/health";
import { handleSessionsApiRequest } from "./api/sessions";
import { handleStreamApiRequest } from "./api/stream";
import { handleTimelineApiRequest } from "./api/timeline";
import { handleTokensApiRequest } from "./api/tokens";

const port = Number.parseInt(process.env.AGENTVIEW_API_PORT ?? "4317", 10);
const host = "127.0.0.1";

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeadersForOrigin(request.headers.origin));
    response.end();
    return;
  }

  try {
    if (await handleHealthApiRequest(request, response)) {
      return;
    }

    if (await handleSessionsApiRequest(request, response)) {
      return;
    }

    if (await handleTimelineApiRequest(request, response)) {
      return;
    }

    if (await handleAgentGraphApiRequest(request, response)) {
      return;
    }

    if (await handleTokensApiRequest(request, response)) {
      return;
    }

    if (await handleDiagnosticsApiRequest(request, response)) {
      return;
    }

    if (await handleStreamApiRequest(request, response)) {
      return;
    }

    if (handleFixtureApiRequest(request, response)) {
      return;
    }

    response.writeHead(404, {
      ...corsHeadersForOrigin(request.headers.origin),
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        ok: false,
        source: "fixture",
        warnings: [],
        error: {
          code: "NOT_FOUND",
          message: "API route not found.",
        },
      }),
    );
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      response.writeHead(500, {
        ...corsHeadersForOrigin(request.headers.origin),
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify({
          ok: false,
          source: "state-db",
          warnings: [],
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Unhandled API error.",
          },
        }),
      );
    }
  }
});

server.listen(port, host, () => {
  console.log(`AgentView API listening on http://${host}:${port}`);
});
