import { describe, expect, it } from "vitest";

import {
  ACTIVE_WINDOW_MS,
  TOKEN_HISTOGRAM_BINS,
  countActiveSessions,
  isActiveSession,
  tokensByHour,
} from "../../src/frontend/views/sessionStats";
import type { SessionSummary } from "../../src/shared/contracts";

const NOW = Date.UTC(2026, 4, 27, 12, 0, 0);

const session = (overrides: Partial<SessionSummary>): SessionSummary => ({
  id: "thread-x",
  source: "codex",
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

const HOUR_MS = 60 * 60 * 1000;

describe("tokensByHour", () => {
  it("buckets a session updated this hour into the most recent (rightmost) bin", () => {
    const result = tokensByHour([session({ updatedAt: new Date(NOW - 5 * 60 * 1000).toISOString(), tokensUsed: 100 })], NOW);

    expect(result).toHaveLength(TOKEN_HISTOGRAM_BINS);
    expect(result[TOKEN_HISTOGRAM_BINS - 1]).toBe(100);
    expect(result.slice(0, TOKEN_HISTOGRAM_BINS - 1)).toEqual(Array(TOKEN_HISTOGRAM_BINS - 1).fill(0));
  });

  it("places a session by the number of whole hours since it was last updated", () => {
    const result = tokensByHour([session({ updatedAt: new Date(NOW - 3 * HOUR_MS - 60 * 1000).toISOString(), tokensUsed: 50 })], NOW);

    expect(result[TOKEN_HISTOGRAM_BINS - 1 - 3]).toBe(50);
  });

  it("rolls over a 12h window: sessions older than 12h are excluded, not piled into the first bin", () => {
    const result = tokensByHour(
      [
        session({ id: "eleven-hours", updatedAt: new Date(NOW - 11 * HOUR_MS).toISOString(), tokensUsed: 7 }),
        session({ id: "ancient", updatedAt: new Date(NOW - 50 * HOUR_MS).toISOString(), tokensUsed: 999 }),
      ],
      NOW,
    );

    expect(result[0]).toBe(7);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(7);
  });

  it("ignores sessions with an unparseable timestamp", () => {
    expect(tokensByHour([session({ updatedAt: "not-a-date", tokensUsed: 5 })], NOW).reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  it("falls back to tokenTotal when tokensUsed is absent", () => {
    const result = tokensByHour([session({ updatedAt: new Date(NOW).toISOString(), tokenTotal: 42 })], NOW);

    expect(result[TOKEN_HISTOGRAM_BINS - 1]).toBe(42);
  });

  it("clamps future-dated updates into the most recent bin", () => {
    const result = tokensByHour([session({ updatedAt: new Date(NOW + 5 * 60 * 1000).toISOString(), tokensUsed: 9 })], NOW);

    expect(result[TOKEN_HISTOGRAM_BINS - 1]).toBe(9);
  });
});
