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

const HOUR_MS = 60 * 60 * 1000;

/** Number of one-hour bins in the token-usage sparkline (a rolling 12h window). */
export const TOKEN_HISTOGRAM_BINS = 12;

/**
 * Sums each session's token usage into a one-hour bin keyed by how long ago it
 * was last updated, oldest bin first. It is a rolling window: sessions older than
 * the window are dropped entirely (never piled into the first bin), so a deep
 * history can't swamp the chart. Future-dated updates clamp into the newest bin.
 */
export const tokensByHour = (sessions: SessionSummary[], nowMs: number, bins = TOKEN_HISTOGRAM_BINS): number[] => {
  const buckets = Array.from({ length: bins }, () => 0);

  for (const session of sessions) {
    const updatedMs = Date.parse(session.updatedAt);
    if (!Number.isFinite(updatedMs)) {
      continue;
    }

    const hoursAgo = Math.floor((nowMs - updatedMs) / HOUR_MS);
    if (hoursAgo >= bins) {
      continue; // outside the rolling window
    }

    const hour = Math.max(0, hoursAgo); // clamp future / clock skew into the newest bin
    buckets[bins - 1 - hour] += session.tokensUsed ?? session.tokenTotal;
  }

  return buckets;
};
