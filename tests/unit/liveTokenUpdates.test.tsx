import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LiveStreamCallbacks } from "../../src/frontend/api/liveStream";

// Capture the live-stream callbacks so we can push a sessions event by hand.
const liveCallbacks: { current: LiveStreamCallbacks | null } = { current: null };
vi.mock("../../src/frontend/api/liveStream", () => ({
  openLiveStream: (options: { callbacks: LiveStreamCallbacks }) => {
    liveCallbacks.current = options.callbacks;
    return { close: vi.fn() };
  },
}));

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
  id: "live-token-session",
  title: "Live token session",
  tokenTotal,
  tokensUsed: tokenTotal,
});

afterEach(() => {
  liveCallbacks.current = null;
  vi.restoreAllMocks();
});

describe("live token totals over SSE", () => {
  it("updates token totals from a live sessions event without a reload", async () => {
    vi.spyOn(realApiClient, "listSessions").mockResolvedValue(ok([sessionWithTokens(100)]));

    render(<App />);

    // The initial REST load seeds the token store (100).
    await waitFor(() => expect(screen.getAllByTestId("live-token-total")[0]).toHaveTextContent("100"));
    await waitFor(() => expect(liveCallbacks.current).not.toBeNull());

    // A live "sessions" event re-seeds the store (5000 → "5K") with no reload/poll.
    act(() => {
      liveCallbacks.current!.onSessions({ sessions: [sessionWithTokens(5000)] });
    });
    expect(screen.getAllByTestId("live-token-total")[0]).toHaveTextContent("5K");
  });
});
