import type { IncomingMessage, ServerResponse } from "node:http";

import { StateStoreError } from "../sqlite/stateStore";
import { createDefaultRegistry } from "../sources/defaultRegistry";
import { parseSourceId } from "../sources/sourceQuery";
import type {
  ArchivedFilter,
  CountStatus,
  FailedToolCountStatus,
  PageOptions,
  SessionFilter,
  ThreadSource,
} from "../../shared/contracts";
import { fail, ok, writeJson } from "./http";

type ParsedQuery =
  | {
      ok: true;
      filter: SessionFilter;
      page: PageOptions;
    }
  | {
      ok: false;
      message: string;
    };

const archivedValues = new Set<ArchivedFilter>(["include", "exclude", "only"]);
const sourceValues = new Set<ThreadSource>(["user", "subagent"]);
const countStatusValues = new Set<CountStatus>(["not_requested", "loading", "ready", "unavailable"]);
const failedToolStatusValues = new Set<FailedToolCountStatus>([
  "not_requested",
  "loading",
  "ready",
  "unavailable",
  "unknown",
]);

const parseInteger = (value: string | null, name: string, min: number) => {
  if (value === null || value.trim() === "") {
    return { ok: true as const, value: undefined };
  }

  if (!/^\d+$/.test(value)) {
    return { ok: false as const, message: `${name} must be an integer.` };
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    return { ok: false as const, message: `${name} must be greater than or equal to ${min}.` };
  }

  return { ok: true as const, value: parsed };
};

const parseEnum = <T extends string>(value: string | null, name: string, allowed: Set<T>) => {
  if (value === null || value.trim() === "") {
    return { ok: true as const, value: undefined };
  }

  if (!allowed.has(value as T)) {
    return { ok: false as const, message: `${name} has unsupported value: ${value}.` };
  }

  return { ok: true as const, value: value as T };
};

const parseListQuery = (url: URL): ParsedQuery => {
  const archived = parseEnum(url.searchParams.get("archived"), "archived", archivedValues);
  if (!archived.ok) return archived;

  const threadSource = parseEnum(url.searchParams.get("source"), "source", sourceValues);
  if (!threadSource.ok) return threadSource;

  const warningCountStatus = parseEnum(url.searchParams.get("warningStatus"), "warningStatus", countStatusValues);
  if (!warningCountStatus.ok) return warningCountStatus;

  const failedToolCountStatus = parseEnum(
    url.searchParams.get("failedToolStatus"),
    "failedToolStatus",
    failedToolStatusValues,
  );
  if (!failedToolCountStatus.ok) return failedToolCountStatus;

  const minTokens = parseInteger(url.searchParams.get("minTokens"), "minTokens", 0);
  if (!minTokens.ok) return minTokens;

  const maxTokens = parseInteger(url.searchParams.get("maxTokens"), "maxTokens", 0);
  if (!maxTokens.ok) return maxTokens;

  const limit = parseInteger(url.searchParams.get("limit"), "limit", 1);
  if (!limit.ok) return limit;

  const offset = parseInteger(url.searchParams.get("offset"), "offset", 0);
  if (!offset.ok) return offset;

  const updatedAfterMs = parseInteger(url.searchParams.get("updatedAfterMs"), "updatedAfterMs", 0);
  if (!updatedAfterMs.ok) return updatedAfterMs;

  const updatedBeforeMs = parseInteger(url.searchParams.get("updatedBeforeMs"), "updatedBeforeMs", 0);
  if (!updatedBeforeMs.ok) return updatedBeforeMs;

  const createdAfterMs = parseInteger(url.searchParams.get("createdAfterMs"), "createdAfterMs", 0);
  if (!createdAfterMs.ok) return createdAfterMs;

  const createdBeforeMs = parseInteger(url.searchParams.get("createdBeforeMs"), "createdBeforeMs", 0);
  if (!createdBeforeMs.ok) return createdBeforeMs;

  return {
    ok: true,
    filter: {
      search: url.searchParams.get("search") ?? undefined,
      cwd: url.searchParams.get("cwd") ?? undefined,
      repo: url.searchParams.get("repo") ?? undefined,
      archived: archived.value,
      threadSource: threadSource.value,
      agentRole: url.searchParams.get("role") ?? undefined,
      model: url.searchParams.get("model") ?? undefined,
      minTokens: minTokens.value,
      maxTokens: maxTokens.value,
      warningCountStatus: warningCountStatus.value,
      failedToolCountStatus: failedToolCountStatus.value,
      updatedAfterMs: updatedAfterMs.value,
      updatedBeforeMs: updatedBeforeMs.value,
      createdAfterMs: createdAfterMs.value,
      createdBeforeMs: createdBeforeMs.value,
    },
    page: {
      limit: limit.value,
      offset: offset.value,
    },
  };
};

const toErrorStatus = (error: unknown) => {
  if (error instanceof StateStoreError) {
    return error.code === "STATE_DB_MISSING" || error.code === "SCHEMA_UNSUPPORTED" ? 503 : 500;
  }

  return 503;
};

const writeStateStoreError = (response: ServerResponse, origin: string | undefined, error: unknown) => {
  writeJson(
    response,
    toErrorStatus(error),
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
};

export const handleSessionsApiRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/api/sessions" && !url.pathname.startsWith("/api/sessions/")) {
    return false;
  }

  if (request.method !== "GET") {
    writeJson(
      response,
      405,
      fail("state-db", {
        code: "METHOD_NOT_ALLOWED",
        message: "Sessions API only supports GET requests.",
      }),
      origin,
    );
    return true;
  }

  const threadId = url.pathname.startsWith("/api/sessions/")
    ? decodeURIComponent(url.pathname.slice("/api/sessions/".length))
    : null;

  if (threadId === "") {
    writeJson(
      response,
      400,
      fail("state-db", {
        code: "INVALID_FILTER",
        message: "Thread id is required.",
      }),
      origin,
    );
    return true;
  }

  const parsed = threadId ? null : parseListQuery(url);
  if (parsed?.ok === false) {
    writeJson(
      response,
      400,
      fail("state-db", {
        code: "INVALID_FILTER",
        message: parsed.message,
      }),
      origin,
    );
    return true;
  }

  // The SourceId dispatch discriminator travels as `sourceId` (NOT `source`,
  // which already maps to SessionFilter.threadSource). For a specific session id
  // it is only a hint; absent means resolve by id across registered sources.
  const sourceResult = parseSourceId(url);
  if (!sourceResult.ok) {
    writeJson(response, 400, fail("state-db", { code: "UNKNOWN_SOURCE", message: sourceResult.message }), origin);
    return true;
  }
  const explicitSource = (url.searchParams.get("sourceId") ?? "").trim() !== "";

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

      if (threadId) {
        const matched = await registry.findSession(threadId, explicitSource ? sourceResult.source : undefined);
        const session = matched?.session ?? null;

        if (!session) {
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

        writeJson(response, 200, ok("state-db", session), origin);
        return true;
      }

      if (!parsed) {
        writeJson(
          response,
          400,
          fail("state-db", {
            code: "INVALID_FILTER",
            message: "Session list query is required.",
          }),
          origin,
        );
        return true;
      }

      // Explicit `?sourceId=` narrows to that single source; absent ⇒ merged
      // fan-out across every registered source (one source this phase).
      const filter: SessionFilter = explicitSource ? { ...parsed.filter, source: sourceResult.source } : parsed.filter;
      const sessions = await registry.listSessions(filter, parsed.page);
      writeJson(response, 200, ok("state-db", sessions), origin);
      return true;
    } finally {
      await registry.close();
    }
  } catch (error) {
    writeStateStoreError(response, origin, error);
    return true;
  }
};
