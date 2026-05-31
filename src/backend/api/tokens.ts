import type { IncomingMessage, ServerResponse } from "node:http";

import { getRolloutFactsWithCache } from "../cache/rolloutCache";
import { resolveCodexHome } from "../codexPaths";
import { parseRolloutFile } from "../rollout/jsonlStream";
import { deriveTokenSeries } from "../rollout/tokenSeries";
import { openStateStore, StateStoreError } from "../sqlite/stateStore";
import { fail, ok, writeJson } from "./http";
import { resolveRolloutPath } from "./timeline";

// `deriveTokenSeries` now lives in `../rollout/tokenSeries` (pure, no api/sources
// deps) so the Codex live token feed (`CodexSource.liveTokenSeries`) can reuse it
// without an import cycle. Re-exported here for back-compat with `./tokens` importers.
export { deriveTokenSeries };

const badRequest = (response: ServerResponse, origin: string | undefined, message: string) => {
  writeJson(
    response,
    400,
    fail("rollout-cache", {
      code: "INVALID_TOKEN_SERIES_REQUEST",
      message,
    }),
    origin,
  );
};

const stateStoreStatus = (error: unknown) =>
  error instanceof StateStoreError && (error.code === "STATE_DB_MISSING" || error.code === "SCHEMA_UNSUPPORTED")
    ? 503
    : 500;

export const handleTokensApiRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/api/tokens") {
    return false;
  }

  if (request.method !== "GET") {
    writeJson(
      response,
      405,
      fail("rollout-cache", {
        code: "METHOD_NOT_ALLOWED",
        message: "Tokens API only supports GET requests.",
      }),
      origin,
    );
    return true;
  }

  const threadId = url.searchParams.get("threadId")?.trim();
  if (!threadId) {
    badRequest(response, origin, "threadId is required.");
    return true;
  }

  try {
    const codexHome = await resolveCodexHome();
    const store = await openStateStore({ codexHome });

    try {
      const thread = await store.getThread(threadId);
      if (!thread) {
        writeJson(
          response,
          404,
          fail("state-db", {
            code: "THREAD_NOT_FOUND",
            message: `Thread not found: ${threadId}`,
          }),
          origin,
        );
        return true;
      }

      if (!thread.rolloutPath) {
        writeJson(
          response,
          404,
          fail("state-db", {
            code: "ROLLOUT_MISSING",
            message: `Thread has no rollout path: ${threadId}`,
          }),
          origin,
        );
        return true;
      }

      const rolloutPath = await resolveRolloutPath(codexHome, thread.rolloutPath);
      const cached = await getRolloutFactsWithCache({
        codexHome,
        threadId,
        rolloutPath,
        parse: (sourceMtimeMs, sourceSizeBytes) =>
          parseRolloutFile(rolloutPath, {
            threadId,
            rolloutPath,
            sourceMtimeMs,
            sourceSizeBytes,
          }),
      });

      writeJson(
        response,
        200,
        ok("rollout-cache", deriveTokenSeries(cached.facts), [...cached.warnings, ...cached.facts.warnings]),
        origin,
      );
      return true;
    } finally {
      await store.close();
    }
  } catch (error) {
    const status =
      error instanceof StateStoreError
        ? stateStoreStatus(error)
        : error instanceof Error && error.name === "RolloutNotFoundError"
          ? 404
          : error instanceof Error && error.name === "RolloutPathTraversalError"
            ? 400
            : 500;
    const code =
      error instanceof StateStoreError
        ? error.code
        : error instanceof Error && error.name === "RolloutNotFoundError"
          ? "ROLLOUT_NOT_FOUND"
          : error instanceof Error && error.name === "RolloutPathTraversalError"
            ? "ROLLOUT_PATH_TRAVERSAL"
            : "TOKEN_SERIES_UNAVAILABLE";

    writeJson(
      response,
      status,
      fail("rollout-cache", {
        code,
        message:
          error instanceof Error && (error.name === "RolloutNotFoundError" || error.name === "RolloutPathTraversalError")
            ? `${code}: ${threadId}`
            : error instanceof Error
              ? error.message
              : "Unable to load token series.",
      }),
      origin,
    );
    return true;
  }
};
