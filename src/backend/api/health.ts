import type { IncomingMessage, ServerResponse } from "node:http";

import { StateStoreError } from "../sqlite/stateStore";
import type { CodexSource } from "../sources/codex/CodexSource";
import { createDefaultRegistry } from "../sources/defaultRegistry";
import { parseSourceId } from "../sources/sourceQuery";
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

  // The SourceId dispatch discriminator travels as `sourceId` (default "codex").
  const sourceResult = parseSourceId(url);
  if (!sourceResult.ok) {
    writeJson(response, 400, fail("state-db", { code: "UNKNOWN_SOURCE", message: sourceResult.message }), origin);
    return true;
  }

  try {
    const registry = await createDefaultRegistry();

    try {
      if (!registry.has(sourceResult.source)) {
        writeJson(
          response,
          400,
          fail("state-db", {
            code: "UNKNOWN_SOURCE",
            message: `Source is not registered: ${sourceResult.source}`,
          }),
          origin,
        );
        return true;
      }

      // The state-db schema body stays a Codex concern this phase; the dispatched
      // source is the Codex source. `registry.getHealth()` aggregates per-source
      // availability (one Codex entry now) but the wire body keeps its shape.
      const source = registry.get(sourceResult.source) as CodexSource;
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
      await registry.close();
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
