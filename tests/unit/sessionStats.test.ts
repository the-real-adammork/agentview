import { describe, expect, it } from "vitest";

import { ACTIVE_WINDOW_MS, countActiveSessions, isActiveSession } from "../../src/frontend/views/sessionStats";
import type { SessionSummary } from "../../src/shared/contracts";

const NOW = Date.UTC(2026, 4, 27, 12, 0, 0);

const session = (overrides: Partial<SessionSummary>): SessionSummary => ({
  id: "thread-x",
  title: "Session",
  status: "complete",
  updatedAt: new Date(NOW).toISOString(),
  branch: "main",
  cwd: "/repo/agentview",
  model: "gpt-5-codex",
  lastMessage: "",
  childCount: 0,
  openChildCount: 0,
  tokenTotal: 0,
  ...overrides,
});

describe("isActiveSession", () => {
  it("counts a session updated within the last hour as active", () => {
    expect(isActiveSession(session({ updatedAt: new Date(NOW - 30 * 60 * 1000).toISOString() }), NOW)).toBe(true);
  });

  it("treats the one-hour boundary as still active", () => {
    expect(isActiveSession(session({ updatedAt: new Date(NOW - ACTIVE_WINDOW_MS).toISOString() }), NOW)).toBe(true);
  });

  it("excludes a session last updated more than an hour ago", () => {
    expect(isActiveSession(session({ updatedAt: new Date(NOW - 2 * ACTIVE_WINDOW_MS).toISOString() }), NOW)).toBe(false);
  });

  it("excludes archived sessions even when recently updated", () => {
    expect(isActiveSession(session({ updatedAt: new Date(NOW).toISOString(), archived: true }), NOW)).toBe(false);
  });

  it("excludes sessions with an unparseable timestamp", () => {
    expect(isActiveSession(session({ updatedAt: "not-a-date" }), NOW)).toBe(false);
  });
});

describe("countActiveSessions", () => {
  it("counts only the recently-updated, non-archived sessions", () => {
    const sessions = [
      session({ id: "recent", updatedAt: new Date(NOW - 10 * 60 * 1000).toISOString() }),
      session({ id: "stale", updatedAt: new Date(NOW - 5 * ACTIVE_WINDOW_MS).toISOString() }),
      session({ id: "archived-recent", updatedAt: new Date(NOW).toISOString(), archived: true }),
      session({ id: "also-recent", updatedAt: new Date(NOW - 59 * 60 * 1000).toISOString() }),
    ];

    expect(countActiveSessions(sessions, NOW)).toBe(2);
  });
});
