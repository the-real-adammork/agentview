import "@testing-library/jest-dom/vitest";

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/frontend/App";
import { realApiClient } from "../../src/frontend/api/client";
import { sessionSummariesFixture } from "../../src/fixtures/observatoryFixtures";
import type { ApiResult, SessionSummary } from "../../src/shared/contracts";

const ok = (data: SessionSummary[]): ApiResult<SessionSummary[]> => ({
  ok: true,
  data,
  source: "fixture",
  warnings: [],
});

const sessionWithTokens = (tokenTotal: number): SessionSummary => ({
  ...sessionSummariesFixture[0],
  id: "live-poll-session",
  title: "Live poll session",
  tokenTotal,
  tokensUsed: tokenTotal,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("live token polling in the app shell", () => {
  it("refreshes token totals on the poll interval without a reload", async () => {
    vi.useFakeTimers();
    let call = 0;
    vi.spyOn(realApiClient, "listSessions").mockImplementation(async () => {
      call += 1;
      return ok([sessionWithTokens(call === 1 ? 100 : 5000)]);
    });

    render(<App />);

    // Flush the initial filter-driven fetch (call #1 → 100 tokens).
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getAllByTestId("live-token-total")[0]).toHaveTextContent("100");

    // Advance past one poll interval (call #2 → 5000 tokens) and let it settle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getAllByTestId("live-token-total")[0]).toHaveTextContent("5K");
  });
});
