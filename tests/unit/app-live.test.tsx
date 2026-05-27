import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LiveStreamCallbacks } from "../../src/frontend/api/liveStream";

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
});

describe("App live updates", () => {
  it("applies a sessions snapshot pushed over the live stream", async () => {
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

    expect(await screen.findByText("Live pushed session")).toBeInTheDocument();
  });
});
