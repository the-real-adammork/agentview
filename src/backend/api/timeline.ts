import { access } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";

import { getRolloutFactsWithCache } from "../cache/rolloutCache";
import { resolveCodexHome } from "../codexPaths";
import { parseRolloutFile } from "../rollout/jsonlStream";
import { openStateStore, StateStoreError } from "../sqlite/stateStore";
import { tailRolloutFile } from "../tail/liveTail";
import { fail, ok, writeJson } from "./http";

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

const resolveRolloutPath = async (codexHome: string, rolloutPath: string) => {
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

      if (fromByte !== undefined) {
        const tail = await tailRolloutFile({
          path: rolloutPath,
          threadId,
          fromByte,
          sourceLine: cached.facts.events.length + 1,
        });
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

      writeJson(
        response,
        200,
        ok(
          "rollout-cache",
          {
            threadId,
            events: cached.facts.events,
            facts: cached.facts,
            nextByteOffset: cached.facts.parsedThroughByte,
            cacheStatus: cached.status,
          },
          [...cached.warnings, ...cached.facts.warnings],
        ),
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
