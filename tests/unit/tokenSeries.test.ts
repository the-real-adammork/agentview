import { describe, expect, it } from "vitest";

import type { CachedRolloutFacts, TokenSeries, TokenSnapshot } from "../../src/shared/contracts";

interface TokensModule {
  deriveTokenSeries(facts: CachedRolloutFacts): TokenSeries;
}

const tokensSpecifier = ["..", "..", "src", "backend", "api", "tokens"].join("/");

const loadTokens = async () => (await import(/* @vite-ignore */ tokensSpecifier)) as TokensModule;

const factsWithSnapshots = (tokenSnapshots: TokenSnapshot[]): CachedRolloutFacts => ({
  threadId: "thread-token-series",
  rolloutPath: "/tmp/thread-token-series.jsonl",
  parserVersion: 1,
  sourceMtimeMs: 1,
  sourceSizeBytes: 1,
  parsedThroughByte: 1,
  events: [],
  toolCalls: [],
  tokenSnapshots,
  warnings: [],
});

describe("deriveTokenSeries", () => {
  it("derives aggregate totals, cache ratio, rate limits, and context utilization from cumulative snapshots", async () => {
    const { deriveTokenSeries } = await loadTokens();

    const series = deriveTokenSeries(
      factsWithSnapshots([
        {
          timestamp: "2026-05-26T18:00:00.000Z",
          input: 100,
          cachedInput: 20,
          output: 30,
          reasoningOutput: 4,
          total: 130,
          contextUtilization: 0.1,
          rateLimitPrimaryPercent: 12,
        },
        {
          timestamp: "2026-05-26T18:01:00.000Z",
          input: 500,
          cachedInput: 125,
          output: 90,
          reasoningOutput: 25,
          total: 590,
          contextUtilization: 0.42,
          rateLimitPrimaryPercent: 57,
          rateLimitSecondaryPercent: 9,
          resetAt: "2026-05-26T19:00:00.000Z",
        },
      ]),
    );

    expect(series).toMatchObject({
      snapshots: [
        expect.objectContaining({ total: 130, contextUtilization: 0.1, rateLimitPrimaryPercent: 12 }),
        expect.objectContaining({
          total: 590,
          contextUtilization: 0.42,
          rateLimitPrimaryPercent: 57,
          rateLimitSecondaryPercent: 9,
          resetAt: "2026-05-26T19:00:00.000Z",
        }),
      ],
      totals: {
        input: 500,
        cachedInput: 125,
        output: 90,
        reasoningOutput: 25,
        total: 590,
      },
      cachedInputRatio: 0.25,
      latestContextUtilization: 0.42,
      peakContextUtilization: 0.42,
      rateLimitPrimaryPercent: 57,
      rateLimitSecondaryPercent: 9,
      resetAt: "2026-05-26T19:00:00.000Z",
      emptyStateReasons: [],
    });
  });

  it("guards cached-input ratio when denominator or numerator values are invalid", async () => {
    const { deriveTokenSeries } = await loadTokens();

    const zeroDenominator = deriveTokenSeries(
      factsWithSnapshots([
        {
          timestamp: "2026-05-26T18:00:00.000Z",
          input: 0,
          cachedInput: 50,
          output: 10,
          total: 10,
        },
      ]),
    );
    const impossibleNumerator = deriveTokenSeries(
      factsWithSnapshots([
        {
          timestamp: "2026-05-26T18:00:00.000Z",
          input: 100,
          cachedInput: 150,
          output: 10,
          total: 110,
        },
      ]),
    );

    expect(zeroDenominator.cachedInputRatio).toBeUndefined();
    expect(zeroDenominator.emptyStateReasons).toContain("cached-input-ratio-unavailable");
    expect(impossibleNumerator.cachedInputRatio).toBeUndefined();
    expect(impossibleNumerator.emptyStateReasons).toContain("cached-input-ratio-unavailable");
  });

  it("returns an empty token series with display reasons when cached rollout facts contain no token snapshots", async () => {
    const { deriveTokenSeries } = await loadTokens();

    const series = deriveTokenSeries(factsWithSnapshots([]));

    expect(series).toEqual({
      snapshots: [],
      totals: {
        input: 0,
        cachedInput: 0,
        output: 0,
        reasoningOutput: 0,
        total: 0,
      },
      emptyStateReasons: [
        "token-snapshots-missing",
        "cached-input-ratio-unavailable",
        "context-utilization-unavailable",
        "rate-limits-unavailable",
      ],
    });
  });
});
