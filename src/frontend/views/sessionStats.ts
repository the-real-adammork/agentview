import type { SessionSummary } from "../../shared/contracts";

/** A session counts as "active" when it was updated within this window. */
export const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * The Codex state DB has no liveness/status column, so "active" is approximated by
 * recency: a non-archived session updated within {@link ACTIVE_WINDOW_MS}.
 */
export const isActiveSession = (session: SessionSummary, nowMs: number): boolean => {
  if (session.archived) {
    return false;
  }

  const updatedMs = Date.parse(session.updatedAt);
  return Number.isFinite(updatedMs) && nowMs - updatedMs <= ACTIVE_WINDOW_MS;
};

export const countActiveSessions = (sessions: SessionSummary[], nowMs: number): number =>
  sessions.filter((session) => isActiveSession(session, nowMs)).length;
