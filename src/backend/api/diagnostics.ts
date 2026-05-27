import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";

import type { CachedRolloutFacts, CachedToolCall, DiagnosticsSummary, RuntimeLogLevel, RuntimeLogQuery } from "../../shared/contracts";
import { getRolloutFactsWithCache, rolloutCachePath } from "../cache/rolloutCache";
import { RawTuiLogError, tailRawTuiLog } from "../diagnostics/rawTuiLog";
import { resolveCodexHome } from "../codexPaths";
import { parseRolloutFile } from "../rollout/jsonlStream";
import { resolveRolloutPath } from "./timeline";
import { openStateStore } from "../sqlite/stateStore";
import { LogStoreError, openLogStore } from "../sqlite/logStore";
import { fail, ok, writeJson } from "./http";

const levelValues = new Set<RuntimeLogLevel>(["TRACE", "DEBUG", "INFO", "WARN", "ERROR"]);

const parseInteger = (value: string | null, name: string, min: number) => {
  if (value === null || value.trim() === "") return { ok: true as const, value: undefined };
  if (!/^\d+$/.test(value)) return { ok: false as const, message: `${name} must be an integer.` };
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    return { ok: false as const, message: `${name} must be greater than or equal to ${min}.` };
  }
  return { ok: true as const, value: parsed };
};

const parseLogsQuery = (url: URL) => {
  const level = url.searchParams.get("level");
  if (level && !levelValues.has(level as RuntimeLogLevel)) {
    return { ok: false as const, message: `level has unsupported value: ${level}.` };
  }

  const limit = parseInteger(url.searchParams.get("limit"), "limit", 1);
  if (!limit.ok) return limit;

  return {
    ok: true as const,
    query: {
      level: level ? (level as RuntimeLogLevel) : undefined,
      target: url.searchParams.get("target") ?? undefined,
      threadId: url.searchParams.get("threadId") ?? undefined,
      scope: url.searchParams.get("scope") ?? undefined,
      limit: limit.value,
      cursor: url.searchParams.get("cursor") ?? undefined,
    } satisfies RuntimeLogQuery,
  };
};

const parseSummaryQuery = (url: URL) => {
  const targetLimit = parseInteger(url.searchParams.get("targetLimit"), "targetLimit", 1);
  if (!targetLimit.ok) return targetLimit;

  return {
    ok: true as const,
    threadIds: url.searchParams.getAll("threadId").filter((threadId) => threadId.trim()),
    targetLimit: targetLimit.value,
  };
};

const parseRawTailQuery = (url: URL) => {
  const fromByte = parseInteger(url.searchParams.get("fromByte"), "fromByte", 0);
  if (!fromByte.ok) return fromByte;

  const maxBytes = parseInteger(url.searchParams.get("maxBytes"), "maxBytes", 1);
  if (!maxBytes.ok) return maxBytes;

  return {
    ok: true as const,
    fromByte: fromByte.value,
    maxBytes: maxBytes.value,
  };
};

const logStoreStatus = (error: unknown) => {
  if (error instanceof LogStoreError) {
    return error.code === "LOGS_DB_MISSING" || error.code === "SCHEMA_UNSUPPORTED" ? 503 : 400;
  }
  return 500;
};

const rawTailStatus = (error: unknown) => {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") return 404;
  if (error instanceof RawTuiLogError) return 400;
  return 500;
};

const writeRawTailError = (response: ServerResponse, origin: string | undefined, error: unknown) => {
  writeJson(
    response,
    rawTailStatus(error),
    fail("raw-log", {
      code:
        error instanceof RawTuiLogError
          ? error.code
          : (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "RAW_TUI_LOG_MISSING"
            : "RAW_TUI_LOG_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unable to read raw TUI log.",
    }),
    origin,
  );
};

const writeLogStoreError = (response: ServerResponse, origin: string | undefined, error: unknown) => {
  writeJson(
    response,
    logStoreStatus(error),
    fail("logs-db", {
      code: error instanceof Error && "code" in error ? String(error.code) : "LOGS_DB_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unable to open Codex logs database.",
      detail:
        error instanceof LogStoreError && error.missing?.length
          ? error.missing.join(", ")
          : error instanceof Error
            ? error.message
            : undefined,
    }),
    origin,
  );
};

const failedCommandFromToolCall = (threadId: string, toolCall: CachedToolCall) => {
  if (!toolCall.exitCode || toolCall.exitCode === 0) return null;

  return {
    threadId,
    toolName: toolCall.toolName,
    command: toolCall.commandPreview ?? toolCall.argumentsPreview ?? "",
    exitCode: toolCall.exitCode,
    count: 1,
    lastOutputPreview: toolCall.outputPreview ?? "",
    source: "rollout-cache" as const,
  };
};

const readRolloutCacheFacts = async (codexHome: string, threadId: string) => {
  const cacheRoot = process.env.AGENTVIEW_CACHE_ROOT ?? codexHome;
  const body = await readFile(rolloutCachePath(cacheRoot, threadId), "utf8");
  return JSON.parse(body) as CachedRolloutFacts;
};

const failedCommandsFromRolloutCache = async ({
  codexHome,
  threadIds,
}: {
  codexHome: string;
  threadIds: string[];
}) => {
  const store = await openStateStore({ codexHome });
  const failedCommands: DiagnosticsSummary["failedCommands"] = [];

  try {
    for (const threadId of threadIds) {
      try {
        const thread = await store.getThread(threadId);
        if (!thread?.rolloutPath) continue;

        const rolloutPath = await resolveRolloutPath(codexHome, thread.rolloutPath);
        try {
          const cachedFacts = await readRolloutCacheFacts(codexHome, threadId);
          for (const toolCall of cachedFacts.toolCalls) {
            const failedCommand = failedCommandFromToolCall(threadId, toolCall);
            if (failedCommand) failedCommands.push(failedCommand);
          }
          continue;
        } catch {
          // Fall through to the parser-backed cache helper when no cache entry is available.
        }

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

        for (const toolCall of cached.facts.toolCalls) {
          const failedCommand = failedCommandFromToolCall(threadId, toolCall);
          if (failedCommand) failedCommands.push(failedCommand);
        }
      } catch {
        continue;
      }
    }
  } finally {
    await store.close();
  }

  return failedCommands;
};

const applyRolloutFailedCommands = (
  summary: DiagnosticsSummary,
  failedCommands: DiagnosticsSummary["failedCommands"],
): DiagnosticsSummary => {
  if (failedCommands.length === 0) return summary;

  const failedCountsByThread = new Map<string, number>();
  for (const failedCommand of failedCommands) {
    failedCountsByThread.set(failedCommand.threadId, (failedCountsByThread.get(failedCommand.threadId) ?? 0) + failedCommand.count);
  }

  return {
    ...summary,
    failedCommands: [...summary.failedCommands, ...failedCommands],
    sessionsWarningBadges: summary.sessionsWarningBadges.map((badge) => ({
      ...badge,
      failedToolCountStatus: "ready",
      failedToolCount: badge.failedToolCount + (failedCountsByThread.get(badge.threadId) ?? 0),
    })),
  };
};

const fallbackSummaryFromRolloutCache = async ({
  codexHome,
  threadIds,
}: {
  codexHome: string;
  threadIds: string[];
}) => {
  const failedCommands = await failedCommandsFromRolloutCache({ codexHome, threadIds });
  const failedCountsByThread = new Map<string, number>();
  for (const failedCommand of failedCommands) {
    failedCountsByThread.set(failedCommand.threadId, (failedCountsByThread.get(failedCommand.threadId) ?? 0) + failedCommand.count);
  }

  return {
    warningCounts: {
      total: 0,
      byThreadId: {},
      byLevel: {},
    },
    loudestTargets: [],
    failedCommands,
    sessionsWarningBadges: threadIds.map((threadId) => ({
      threadId,
      warningCountStatus: "unavailable" as const,
      warningCount: 0,
      failedToolCountStatus: "ready" as const,
      failedToolCount: failedCountsByThread.get(threadId) ?? 0,
    })),
  } satisfies DiagnosticsSummary;
};

export const handleDiagnosticsApiRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/api/logs" && url.pathname !== "/api/diagnostics/summary" && url.pathname !== "/api/diagnostics/raw-tail") {
    return false;
  }

  if (request.method !== "GET") {
    writeJson(
      response,
      405,
      fail("logs-db", {
        code: "METHOD_NOT_ALLOWED",
        message: "Diagnostics API only supports GET requests.",
      }),
      origin,
    );
    return true;
  }

  if (url.pathname === "/api/logs") {
    const parsed = parseLogsQuery(url);
    if (!parsed.ok) {
      writeJson(
        response,
        400,
        fail("logs-db", {
          code: "INVALID_FILTER",
          message: parsed.message,
        }),
        origin,
      );
      return true;
    }

    try {
      const codexHome = await resolveCodexHome();
      const store = await openLogStore({ codexHome });
      try {
        writeJson(response, 200, ok("logs-db", await store.queryLogs(parsed.query)), origin);
        return true;
      } finally {
        await store.close();
      }
    } catch (error) {
      writeLogStoreError(response, origin, error);
      return true;
    }
  }

  if (url.pathname === "/api/diagnostics/raw-tail") {
    const parsed = parseRawTailQuery(url);
    if (!parsed.ok) {
      writeJson(
        response,
        400,
        fail("raw-log", {
          code: "INVALID_RAW_TAIL_FILTER",
          message: parsed.message,
        }),
        origin,
      );
      return true;
    }

    try {
      const codexHome = await resolveCodexHome();
      writeJson(
        response,
        200,
        ok("raw-log", await tailRawTuiLog({ codexHome, fromByte: parsed.fromByte, maxBytes: parsed.maxBytes })),
        origin,
      );
      return true;
    } catch (error) {
      writeRawTailError(response, origin, error);
      return true;
    }
  }

  const parsed = parseSummaryQuery(url);
  if (!parsed.ok) {
    writeJson(
      response,
      400,
      fail("logs-db", {
        code: "INVALID_FILTER",
        message: parsed.message,
      }),
      origin,
    );
    return true;
  }

  const codexHome = await resolveCodexHome();

  try {
    const store = await openLogStore({ codexHome });
    try {
      const summary = await store.getDiagnosticsSummary({ threadIds: parsed.threadIds, targetLimit: parsed.targetLimit });
      const failedCommands =
        parsed.threadIds.length > 0
          ? await failedCommandsFromRolloutCache({ codexHome, threadIds: parsed.threadIds })
          : [];
      writeJson(
        response,
        200,
        ok("logs-db", applyRolloutFailedCommands(summary, failedCommands)),
        origin,
      );
      return true;
    } finally {
      await store.close();
    }
  } catch (error) {
    if (error instanceof LogStoreError && error.code === "LOGS_DB_MISSING") {
      const summary = await fallbackSummaryFromRolloutCache({ codexHome, threadIds: parsed.threadIds });
      writeJson(response, 200, ok("rollout-cache", summary, [error.message]), origin);
      return true;
    }

    writeLogStoreError(response, origin, error);
    return true;
  }
};
