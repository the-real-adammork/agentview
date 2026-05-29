import "@testing-library/jest-dom/vitest";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LiveStreamCallbacks } from "../../src/frontend/api/liveStream";
import { realApiClient } from "../../src/frontend/api/client";
import type { SessionSummary } from "../../src/shared/contracts";

const liveCallbacks: { current: LiveStreamCallbacks | null } = { current: null };
vi.mock("../../src/frontend/api/liveStream", () => ({
  openLiveStream: (options: { callbacks: LiveStreamCallbacks }) => {
    liveCallbacks.current = options.callbacks;
    return { close: vi.fn() };
  },
}));

import { App } from "../../src/frontend/App";

const session = (id: string, title: string, tokenTotal = 0): SessionSummary =>
  ({
    id,
    title,
    status: "running",
    updatedAt: "2026-05-29T10:00:00.000Z",
    branch: "",
    cwd: "/repo",
    model: "",
    lastMessage: "",
    childCount: 0,
    openChildCount: 0,
    tokenTotal,
  }) as SessionSummary;

const A = session("thread-a", "Alpha session");
const B = session("thread-b", "Bravo session");

const rowFor = (table: HTMLElement, title: string) =>
  within(table).getByText(title).closest("tr") as HTMLElement;

const push = (sessions: SessionSummary[]) =>
  act(() => {
    liveCallbacks.current!.onSessions({ sessions });
  });

afterEach(() => {
  liveCallbacks.current = null;
  vi.restoreAllMocks();
});

describe("App live updates · feed-enter under SSE bursts", () => {
  it("animates a genuinely-new session and survives a burst of token-tick frames", async () => {
    // Baseline from the initial fetch so the fixture→real swap re-baselines cleanly.
    vi.spyOn(realApiClient, "listSessions").mockResolvedValue({ ok: true, data: [A, B], source: "state-db", warnings: [] });

    render(<App />);
    await waitFor(() => expect(liveCallbacks.current).not.toBeNull());

    const table = await screen.findByRole("table", { name: /sessions/i });
    await waitFor(() => expect(within(table).getByText("Alpha session")).toBeInTheDocument());

    // The first SSE frame mirrors the fetched list: nothing should animate.
    push([A, B]);
    expect(table.querySelectorAll("tr.session-row.feed-enter")).toHaveLength(0);

    // A new session arrives. It — and only it — animates.
    const C = session("thread-c", "Charlie session", 100);
    push([C, A, B]);
    expect(rowFor(table, "Charlie session")).toHaveClass("feed-enter");
    expect(rowFor(table, "Alpha session")).not.toHaveClass("feed-enter");

    // A burst of token-tick frames now arrives at once: same ids, reordered,
    // changing token totals. None of this must cancel Charlie's animation or
    // spuriously animate the existing rows.
    push([A, C, B]);
    push([B, A, C]);
    push([C, B, A]);
    expect(rowFor(table, "Charlie session")).toHaveClass("feed-enter");
    expect(rowFor(table, "Alpha session")).not.toHaveClass("feed-enter");
    expect(rowFor(table, "Bravo session")).not.toHaveClass("feed-enter");
  });

  it("animates every new session when several arrive in a single frame", async () => {
    vi.spyOn(realApiClient, "listSessions").mockResolvedValue({ ok: true, data: [A, B], source: "state-db", warnings: [] });

    render(<App />);
    await waitFor(() => expect(liveCallbacks.current).not.toBeNull());
    const table = await screen.findByRole("table", { name: /sessions/i });
    await waitFor(() => expect(within(table).getByText("Alpha session")).toBeInTheDocument());
    push([A, B]);

    // Two brand-new sessions delivered together (a coalesced frame).
    const C = session("thread-c", "Charlie session");
    const D = session("thread-d", "Delta session");
    push([C, D, A, B]);
    expect(rowFor(table, "Charlie session")).toHaveClass("feed-enter");
    expect(rowFor(table, "Delta session")).toHaveClass("feed-enter");
    expect(rowFor(table, "Alpha session")).not.toHaveClass("feed-enter");
  });
});
