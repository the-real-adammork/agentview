import "@testing-library/jest-dom/vitest";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LiveStreamCallbacks } from "../../src/frontend/api/liveStream";
import { realApiClient } from "../../src/frontend/api/client";
import type { TimelineEvent, TimelinePayload } from "../../src/shared/contracts";

// Mock the live stream module so we can drive callbacks directly.
const liveCallbacks: { current: LiveStreamCallbacks | null } = { current: null };
vi.mock("../../src/frontend/api/liveStream", () => ({
  openLiveStream: (options: { callbacks: LiveStreamCallbacks }) => {
    liveCallbacks.current = options.callbacks;
    return { close: vi.fn() };
  },
}));

import { App } from "../../src/frontend/App";

afterEach(() => {
  liveCallbacks.current = null;
  vi.restoreAllMocks();
});

describe("App live updates", () => {
  it("applies a sessions snapshot pushed over the live stream", async () => {
    // Isolate from any real dev API server: the initial mount fetch must not
    // race the SSE push and clobber it. (Without this, a running `npm run dev`
    // on :4317 resolves listSessions with real data and overwrites the push.)
    vi.spyOn(realApiClient, "listSessions").mockRejectedValue(new Error("no server in test"));

    render(<App />);
    await waitFor(() => expect(liveCallbacks.current).not.toBeNull());

    act(() => {
      liveCallbacks.current!.onSessions({
        sessions: [
          {
            id: "live-thread",
            title: "Live pushed session",
            status: "complete",
            updatedAt: "2026-05-27T10:00:00.000Z",
            branch: "",
            cwd: "/repo",
            model: "",
            lastMessage: "",
            childCount: 0,
            openChildCount: 0,
            tokenTotal: 0,
          },
        ],
      });
    });

    // The pushed session shows in the Sessions table. (It also appears in the
    // header session square, so scope the assertion to the table to disambiguate.)
    const sessionsTable = await screen.findByRole("table", { name: /sessions/i });
    expect(within(sessionsTable).getByText("Live pushed session")).toBeInTheDocument();
  });

  it("appends a timeline delta pushed over the live stream into the open timeline", async () => {
    const threadId = "live-thread";
    const baseEvent: TimelineEvent = {
      id: "ev-initial",
      threadId,
      timestamp: "2026-05-27T10:00:00.000Z",
      sourceLine: 1,
      kind: "user_message",
      severity: "info",
      previewText: "initial event",
    };
    const session = {
      id: threadId,
      title: "Live session",
      status: "running" as const,
      updatedAt: "2026-05-27T10:00:00.000Z",
      branch: "",
      cwd: "/repo",
      model: "",
      lastMessage: "",
      childCount: 0,
      openChildCount: 0,
      tokenTotal: 0,
    };
    const payload = { threadId, events: [baseEvent], nextByteOffset: 10 } as TimelinePayload;

    vi.spyOn(realApiClient, "listSessions").mockResolvedValue({ ok: true, source: "state-db", warnings: [], data: [session] });
    vi.spyOn(realApiClient, "getTimeline").mockResolvedValue({ ok: true, source: "rollout-cache", warnings: [], data: payload });

    render(<App />);
    await waitFor(() => expect(liveCallbacks.current).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(await screen.findByText("initial event")).toBeVisible();

    // A live SSE delta for the open thread must append to the rendered stream.
    act(() => {
      liveCallbacks.current!.onTimeline({
        threadId,
        events: [{ ...baseEvent, id: "ev-streamed", timestamp: "2026-05-27T10:00:05.000Z", previewText: "streamed delta event" }],
        nextByteOffset: 42,
        reset: false,
        warnings: [],
      });
    });

    expect(await screen.findByText("streamed delta event")).toBeVisible();
  });
});
