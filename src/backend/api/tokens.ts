import type { IncomingMessage, ServerResponse } from "node:http";

import type { CachedRolloutFacts, TokenSeries, TokenSnapshot } from "../../shared/contracts";
import { getRolloutFactsWithCache } from "../cache/rolloutCache";
import { resolveCodexHome } from "../codexPaths";
import { parseRolloutFile } from "../rollout/jsonlStream";
import { openStateStore, StateStoreError } from "../sqlite/stateStore";
import { fail, ok, writeJson } from "./http";
import { resolveRolloutPath } from "./timeline";

const emptyTotals = {
  input: 0,
  cachedInput: 0,
  output: 0,
  reasoningOutput: 0,
  total: 0,
};

const lastValue = (snapshots: TokenSnapshot[], select: (snapshot: TokenSnapshot) => number | undefined) => {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const value = select(snapshots[index]);
    if (value !== undefined && Number.isFinite(value)) return value;
  }
  return undefined;
};

const lastString = (snapshots: TokenSnapshot[], select: (snapshot: TokenSnapshot) => string | undefined) => {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const value = select(snapshots[index]);
    if (value?.trim()) return value;
  }
  return undefined;
};

const cachedInputRatio = (snapshot: TokenSnapshot | undefined) => {
  if (!snapshot) return undefined;
  if (snapshot.input <= 0) return undefined;
  if (snapshot.cachedInput < 0 || snapshot.cachedInput > snapshot.input) return undefined;
  return snapshot.cachedInput / snapshot.input;
};

export const deriveTokenSeries = (facts: CachedRolloutFacts): TokenSeries => {
  const snapshots = facts.tokenSnapshots;
  const latest = snapshots.at(-1);
  const ratio = cachedInputRatio(latest);
  const latestContextUtilization = lastValue(snapshots, (snapshot) => snapshot.contextUtilization);
  const contextValues = snapshots
    .map((snapshot) => snapshot.contextUtilization)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  const rateLimitPrimaryPercent = lastValue(snapshots, (snapshot) => snapshot.rateLimitPrimaryPercent);
  const rateLimitSecondaryPercent = lastValue(snapshots, (snapshot) => snapshot.rateLimitSecondaryPercent);
  const resetAt = lastString(snapshots, (snapshot) => snapshot.resetAt);
  const emptyStateReasons: string[] = [];

  if (snapshots.length === 0) {
    emptyStateReasons.push("token-snapshots-missing");
  }

  if (ratio === undefined) {
    emptyStateReasons.push("cached-input-ratio-unavailable");
  }

  if (contextValues.length === 0) {
    emptyStateReasons.push("context-utilization-unavailable");
  }

  if (rateLimitPrimaryPercent === undefined && rateLimitSecondaryPercent === undefined && resetAt === undefined) {
    emptyStateReasons.push("rate-limits-unavailable");
  }

  return {
    snapshots,
    totals: latest
      ? {
          input: latest.input,
          cachedInput: latest.cachedInput,
          output: latest.output,
          reasoningOutput: latest.reasoningOutput ?? 0,
          total: latest.total,
        }
      : emptyTotals,
    cachedInputRatio: ratio,
    latestContextUtilization,
    peakContextUtilization: contextValues.length > 0 ? Math.max(...contextValues) : undefined,
    rateLimitPrimaryPercent,
    rateLimitSecondaryPercent,
    resetAt,
    emptyStateReasons,
  };
};

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
