import type { CachedRolloutFacts, TokenSeries, TokenSnapshot } from "../../shared/contracts";

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

/**
 * Derive the token-series view (totals, cached-input ratio, context utilization,
 * rate limits, empty-state reasons) from parsed rollout facts. Pure over
 * `CachedRolloutFacts` — no api/sources dependency — so both the `/api/tokens`
 * handler and the Codex live token feed (`CodexSource.liveTokenSeries`) reuse it
 * without an import cycle.
 */
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
