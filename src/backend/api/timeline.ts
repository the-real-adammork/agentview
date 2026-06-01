import { access } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";

import { StateStoreError } from "../sqlite/stateStore";
import { createDefaultRegistry } from "../sources/defaultRegistry";
import type { SessionSource, TimelineSource } from "../sources/SessionSource";
import { parseSourceId } from "../sources/sourceQuery";
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

const isTimelineSource = (value: unknown): value is TimelineSource => {
  const candidate = value as Partial<TimelineSource>;
  return (
    typeof candidate.parseCached === "function" &&
    typeof candidate.tailParsed === "function" &&
    typeof candidate.resolveChild === "function"
  );
};

// Narrow a dispatched source to its `TimelineSource` capability (every registered
// source implements it). This keeps the handler polymorphic — ONE path for all
// sources — instead of branching on the source id or casting to a concrete source.
const asTimelineSource = (source: SessionSource): TimelineSource => {
  if (!isTimelineSource(source)) {
    const error = new Error(`Source does not support timeline loading: ${source.id}`);
    error.name = "TimelineUnsupportedError";
    throw error;
  }
  return source;
};

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

  const explicitSource = (url.searchParams.get("sourceId") ?? "").trim() !== "";
  const sourceResult = explicitSource ? parseSourceId(url) : null;
  if (sourceResult && !sourceResult.ok) {
    writeJson(response, 400, fail("rollout-cache", { code: "UNKNOWN_SOURCE", message: sourceResult.message }), origin);
    return true;
  }

  try {
    const registry = await createDefaultRegistry();

    try {
      if (sourceResult && !registry.has(sourceResult.source)) {
        writeJson(
          response,
          400,
          fail("rollout-cache", {
            code: "UNKNOWN_SOURCE",
            message: `Source is not registered: ${sourceResult.source}`,
          }),
          origin,
        );
        return true;
      }

      const matched = await registry.findSession(threadId, sourceResult?.source);
      if (!matched) {
        writeJson(
          response,
          404,
          fail("state-db", { code: "THREAD_NOT_FOUND", message: `Thread not found: ${threadId}` }),
          origin,
        );
        return true;
      }

      // One polymorphic path for every source. The resolved source is narrowed
      // to its `TimelineSource` capability (parseCached / tailParsed / resolveChild);
      // each source keeps its own cache key, tail reader, and child resolution behind
      // that interface, so there is no `if (source === ...)` branch or concrete cast.
      const source = matched.source;
      const timeline = asTimelineSource(source);
      const thread = matched.session;

      if (!thread.rolloutPath) {
        writeJson(
          response,
          404,
          fail("state-db", { code: "ROLLOUT_MISSING", message: `Thread has no rollout path: ${threadId}` }),
          origin,
        );
        return true;
      }

      const resolved = await source.resolveSession(threadId);
      const cached = await timeline.parseCached(resolved);

      if (fromByte !== undefined) {
        const tail = await timeline.tailParsed(resolved, fromByte, cached.facts.events.length + 1);
        writeJson(
          response,
          200,
          ok(
            "rollout-cache",
            {
              threadId,
              events: tail.events,
              facts: cached.facts,
              nextByteOffset: tail.nextByteOffset,
              cacheStatus: "tail" as const,
            },
            [...cached.warnings, ...tail.warnings],
          ),
          origin,
        );
        return true;
      }

      let events = cached.facts.events;
      const warnings = [...cached.warnings, ...cached.facts.warnings];

      if (subtree) {
        // Walk the spawn subtree (children resolved through the source) and fold each
        // descendant's events into one time-ordered stream. Best-effort: a descendant
        // whose resolve/parse throws is skipped rather than failing the whole request.
        const descendants = await source.listChildren(threadId, MAX_SUBTREE_DEPTH);

        for (const descendant of descendants) {
          if (!descendant.rolloutPath) continue;
          let descendantResolved;
          try {
            descendantResolved = await timeline.resolveChild(descendant);
          } catch {
            continue;
          }
          try {
            const descendantCached = await timeline.parseCached(descendantResolved);
            events = events.concat(descendantCached.facts.events);
            warnings.push(...descendantCached.warnings, ...descendantCached.facts.warnings);
          } catch {
            // Skip a descendant whose transcript failed to parse.
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
      await registry.close();
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
