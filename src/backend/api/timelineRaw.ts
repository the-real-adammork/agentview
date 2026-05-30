import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

import { resolveCodexHome } from "../codexPaths";
import { selectRawLines } from "../rollout/selectRawLines";
import { openStateStore, StateStoreError } from "../sqlite/stateStore";
import { corsHeadersForOrigin, fail, readJsonBody, writeJson } from "./http";
import { resolveRolloutPath } from "./timeline";

/** Guard against an absurd request flooding the response. */
const MAX_SOURCE_LINES = 200_000;

/**
 * `POST /api/timeline/raw` — return the verbatim original JSONL lines for a set of
 * `sourceLine`s the UI filtered to (plus each tool_call's result line when
 * `includeResults`). The filter lives entirely client-side; this endpoint only
 * fetches lines by number, so it works for any present or future filter set.
 */
export const handleTimelineRawApiRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/api/timeline/raw") return false;

  if (request.method !== "POST") {
    writeJson(response, 405, fail("rollout-cache", { code: "METHOD_NOT_ALLOWED", message: "Use POST." }), origin);
    return true;
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch {
    writeJson(response, 400, fail("rollout-cache", { code: "INVALID_JSON", message: "Request body must be JSON." }), origin);
    return true;
  }

  const payload = (body ?? {}) as { threadId?: unknown; sourceLines?: unknown; includeResults?: unknown };
  const threadId = typeof payload.threadId === "string" ? payload.threadId.trim() : "";
  const sourceLines = Array.isArray(payload.sourceLines)
    ? payload.sourceLines.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : null;
  const includeResults = payload.includeResults !== false; // default true

  if (!threadId || !sourceLines) {
    writeJson(
      response,
      400,
      fail("rollout-cache", { code: "INVALID_REQUEST", message: "threadId (string) and sourceLines (number[]) are required." }),
      origin,
    );
    return true;
  }
  if (sourceLines.length > MAX_SOURCE_LINES) {
    writeJson(
      response,
      400,
      fail("rollout-cache", { code: "TOO_MANY_LINES", message: `At most ${MAX_SOURCE_LINES} source lines per request.` }),
      origin,
    );
    return true;
  }

  try {
    const codexHome = await resolveCodexHome();
    const store = await openStateStore({ codexHome });
    try {
      const thread = await store.getThread(threadId);
      if (!thread?.rolloutPath) {
        writeJson(response, 404, fail("state-db", { code: "THREAD_NOT_FOUND", message: `Thread not found: ${threadId}` }), origin);
        return true;
      }
      const rolloutPath = await resolveRolloutPath(codexHome, thread.rolloutPath);
      const lines = (await readFile(rolloutPath, "utf8")).split("\n");
      const ndjson = selectRawLines(lines, sourceLines, includeResults);
      response.writeHead(200, { ...corsHeadersForOrigin(origin), "content-type": "application/x-ndjson" });
      response.end(ndjson ? `${ndjson}\n` : "");
      return true;
    } finally {
      await store.close();
    }
  } catch (error) {
    const named = error instanceof Error ? error.name : "";
    const status = error instanceof StateStoreError ? 503 : named === "RolloutNotFoundError" ? 404 : named === "RolloutPathTraversalError" ? 400 : 500;
    writeJson(
      response,
      status,
      fail("rollout-cache", { code: "RAW_EXPORT_FAILED", message: error instanceof Error ? error.message : "Raw export failed." }),
      origin,
    );
    return true;
  }
};
