import { access } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";

import { resolveCodexHome } from "../codexPaths";
import { StateStoreError } from "../sqlite/stateStore";
import { createCodexSource } from "../sources/codex/CodexSource";
import { fail, ok, writeJson } from "./http";

// Cap how deep the spawn subtree is walked when merging the unified +SUBS stream.
const MAX_SUBTREE_DEPTH = 10;

const badRequest = (response: ServerResponse, origin: string | undefined, message: string) => {
  writeJson(
    response,
    400,
    fail("rollout-cache", {
      code: "INVALID_TIMELINE_REQUEST",
      message,
    }),
    origin,
  );
};

const stateStoreStatus = (error: unknown) =>
  error instanceof StateStoreError && (error.code === "STATE_DB_MISSING" || error.code === "SCHEMA_UNSUPPORTED")
    ? 503
    : 500;

export const resolveRolloutPath = async (codexHome: string, rolloutPath: string) => {
  if (!rolloutPath.trim()) {
    throw new Error("Thread has no rollout_path.");
  }

  const resolved = isAbsolute(rolloutPath) ? resolve(rolloutPath) : resolve(codexHome, rolloutPath);
  const relativeToHome = relative(codexHome, resolved);
  if (relativeToHome.startsWith("..") || isAbsolute(relativeToHome)) {
    const error = new Error("Thread rollout_path resolves outside CODEX_HOME.");
    error.name = "RolloutPathTraversalError";
    throw error;
  }

  try {
    await access(resolved);
  } catch {
    const error = new Error("Thread rollout file is not readable.");
    error.name = "RolloutNotFoundError";
    throw error;
  }
  return resolved;
};

const parseFromByte = (value: string | null) => {
  if (value === null || value.trim() === "") return undefined;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const handleTimelineApiRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/api/timeline") {
    return false;
  }

  if (request.method !== "GET") {
    writeJson(
      response,
      405,
      fail("rollout-cache", {
        code: "METHOD_NOT_ALLOWED",
        message: "Timeline API only supports GET requests.",
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

  const fromByte = parseFromByte(url.searchParams.get("fromByte"));
  if (fromByte === null) {
    badRequest(response, origin, "fromByte must be a non-negative integer.");
    return true;
  }

  // +SUBS: merge the active thread's spawn subtree into one stream server-side, so
  // the UI fetches once and filters ("this" = active threadId) instead of fanning
  // out N requests and merging on the client. Tail requests stay single-thread.
  const subtree =
    fromByte === undefined && (url.searchParams.get("subtree") === "1" || url.searchParams.get("subtree") === "true");

  try {
    const codexHome = await resolveCodexHome();
    const source = createCodexSource({ codexHome });

    try {
      const thread = await source.getSession(threadId);
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

      const resolved = await source.resolveSession(threadId);
      const cached = await source.parseWithCache(resolved);

      if (fromByte !== undefined) {
        const tail = await source.tailRaw(resolved, fromByte, cached.facts.events.length + 1);
        const warnings = [...cached.warnings, ...tail.warnings];
        writeJson(
          response,
          200,
          ok(
            "rollout-cache",
            {
              threadId,
              events: tail.payload.events,
              facts: cached.facts,
              nextByteOffset: tail.payload.nextByteOffset,
              cacheStatus: "tail" as const,
            },
            warnings,
          ),
          origin,
        );
        return true;
      }

      let events = cached.facts.events;
      const warnings = [...cached.warnings, ...cached.facts.warnings];

      if (subtree) {
        // Walk the spawn subtree and fold each descendant's events into one
        // time-ordered stream. Descendants are best-effort: a missing/unreadable
        // rollout is skipped rather than failing the whole request.
        const descendants = await source.listChildren(threadId, MAX_SUBTREE_DEPTH);

        for (const descendant of descendants) {
          if (!descendant.rolloutPath) continue;
          let descendantResolved;
          try {
            descendantResolved = await source.resolveSession(descendant.id);
          } catch {
            continue;
          }
          try {
            const descendantCached = await source.parseWithCache(descendantResolved);
            events = events.concat(descendantCached.facts.events);
            warnings.push(...descendantCached.warnings, ...descendantCached.facts.warnings);
          } catch {
            // Skip a descendant whose rollout failed to parse.
          }
        }

        events = [...events].sort((left, right) => {
          const leftMs = Date.parse(left.timestamp);
          const rightMs = Date.parse(right.timestamp);
          if (leftMs !== rightMs) return leftMs - rightMs;
          if (left.threadId !== right.threadId) return left.threadId < right.threadId ? -1 : 1;
          return left.sourceLine - right.sourceLine;
        });
      }

      writeJson(
        response,
        200,
        ok(
          "rollout-cache",
          {
            threadId,
            events,
            facts: cached.facts,
            nextByteOffset: cached.facts.parsedThroughByte,
            cacheStatus: cached.status,
          },
          warnings,
        ),
        origin,
      );
      return true;
    } finally {
      await source.close();
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
            : "TIMELINE_UNAVAILABLE";
    writeJson(
      response,
      status,
      fail("rollout-cache", {
        code,
        message:
          error instanceof Error && (error.name === "RolloutNotFoundError" || error.name === "RolloutPathTraversalError")
            ? `${code}: ${url.searchParams.get("threadId") ?? "unknown thread"}`
            : error instanceof Error
              ? error.message
              : "Unable to load timeline.",
      }),
      origin,
    );
    return true;
  }
};
