import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { handleAgentGraphApiRequest } from "./api/agentGraph";
import { handleDiagnosticsApiRequest } from "./api/diagnostics";
import { handleFixtureApiRequest } from "./api/fixtures";
import { corsHeadersForOrigin } from "./api/http";
import { handleHealthApiRequest } from "./api/health";
import { handleSessionsApiRequest } from "./api/sessions";
import { handleStreamApiRequest } from "./api/stream";
import { handleTimelineApiRequest } from "./api/timeline";
import { handleTimelineRawApiRequest } from "./api/timelineRaw";
import { handleTokensApiRequest } from "./api/tokens";
import { resolveCodexHome } from "./codexPaths";
import { openLogStore } from "./sqlite/logStore";
import { warmStateStore } from "./sqlite/stateStore";

const DEFAULT_API_PORT = 4317;
const DEFAULT_API_HOST = "127.0.0.1";

export interface StartAgentViewApiOptions {
  host?: string;
  port?: number;
  warmStores?: boolean;
}

export interface RunningAgentViewApi {
  server: Server;
  host: string;
  port: number;
  baseUrl: string;
  close(): Promise<void>;
}

const warmLocalStores = () => {
  // Warm the local DBs during idle boot time so the first sessions/timeline
  // request skips the reconstructed-edge scan and the first Diagnostics open
  // skips the cold logs_2 open.
  void resolveCodexHome()
    .then(async (codexHome) => {
      await warmStateStore(codexHome);
      await openLogStore({ codexHome })
        .then((store) => store.close())
        .catch(() => undefined);
    })
    .catch(() => undefined);
};

export const createAgentViewServer = () => createServer(async (request, response) => {
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

    if (await handleTimelineRawApiRequest(request, response)) {
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

const parsePort = (value: string | undefined) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : DEFAULT_API_PORT;
};

const listen = (server: Server, port: number, host: string) =>
  new Promise<AddressInfo>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("AgentView API did not bind to a TCP address."));
        return;
      }
      resolveListen(address);
    });
  });

export const startAgentViewApi = async ({
  host = DEFAULT_API_HOST,
  port = parsePort(process.env.AGENTVIEW_API_PORT),
  warmStores = true,
}: StartAgentViewApiOptions = {}): Promise<RunningAgentViewApi> => {
  const server = createAgentViewServer();
  const address = await listen(server, port, host);
  const baseUrl = `http://${host}:${address.port}`;
  console.log(`AgentView API listening on ${baseUrl}`);

  if (warmStores) {
    warmLocalStores();
  }

  return {
    server,
    host,
    port: address.port,
    baseUrl,
    close() {
      return new Promise<void>((resolveClose, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolveClose();
        });
      });
    },
  };
};

const isDirectRun = () => {
  const entry = process.argv[1];
  return Boolean(entry && resolve(entry) === fileURLToPath(import.meta.url));
};

if (isDirectRun()) {
  void startAgentViewApi().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
