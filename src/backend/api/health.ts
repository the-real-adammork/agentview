import type { IncomingMessage, ServerResponse } from "node:http";

import { resolveCodexHome } from "../codexPaths";
import { StateStoreError } from "../sqlite/stateStore";
import { createCodexSource } from "../sources/codex/CodexSource";
import type { HealthStatus } from "../../shared/contracts";
import { fail, ok, writeJson } from "./http";

const errorStatus = (error: unknown) => {
  if (error instanceof StateStoreError) {
    return error.code === "STATE_DB_MISSING" || error.code === "SCHEMA_UNSUPPORTED" ? 503 : 500;
  }

  return 503;
};

export const handleHealthApiRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/api/health") {
    return false;
  }

  if (request.method !== "GET") {
    writeJson(
      response,
      405,
      fail("state-db", {
        code: "METHOD_NOT_ALLOWED",
        message: "Health API only supports GET requests.",
      }),
      origin,
    );
    return true;
  }

  try {
    const codexHome = await resolveCodexHome();
    const source = createCodexSource({ codexHome });

    try {
      const schema = await source.stateDbSchema();
      writeJson(
        response,
        200,
        ok("state-db", {
          status: "ok",
          mode: "real",
          checkedAt: new Date().toISOString(),
          stateDb: schema,
        } satisfies HealthStatus),
        origin,
      );
    } finally {
      await source.close();
    }
  } catch (error) {
    writeJson(
      response,
      errorStatus(error),
      fail("state-db", {
        code: error instanceof Error && "code" in error ? String(error.code) : "STATE_DB_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Unable to open Codex state database.",
        detail:
          error instanceof StateStoreError && error.missing?.length
            ? error.missing.join(", ")
            : error instanceof Error
              ? error.message
              : undefined,
      }),
      origin,
    );
  }

  return true;
};
