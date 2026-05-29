import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { SessionSummary, TimelineEvent, TimelinePayload } from "../../shared/contracts";

/**
 * Dev-only synthetic insert source. Local/CI data is static, so nothing ever
 * streams into the live lists — which makes the feed-enter animation impossible
 * to see. When demo mode is on we periodically inject a new session and timeline
 * event through the real state setters, exactly as an SSE frame would, so the
 * animation is demonstrable and e2e can capture it. Fully gated behind DEV +
 * an explicit opt-in, so production builds dead-code-eliminate it.
 */

/** Builds a fresh top-level session, each in its own repo, as a new live arrival. */
export function buildDemoSession(base: SessionSummary, seq: number, nowMs: number): SessionSummary {
  return {
    ...base,
    id: `demo-session-${seq}`,
    parentId: null,
    threadSource: "user",
    agentRole: undefined,
    agentNickname: undefined,
    title: `Demo session ${seq}`,
    cwd: `~/demo/agent-${seq}`,
    childCount: 0,
    openChildCount: 0,
    archived: false,
    status: "running",
    tokensUsed: 1200 + seq * 137,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

/** Appends a single synthetic event tagged for the payload's current thread. */
export function appendDemoEvent(payload: TimelinePayload, seq: number, nowMs: number): TimelinePayload {
  const event: TimelineEvent = {
    id: `demo-event-${seq}`,
    threadId: payload.threadId,
    timestamp: new Date(nowMs).toISOString(),
    sourceLine: 0,
    kind: "assistant_message",
    severity: "info",
    previewText: `Demo event ${seq} streamed in live.`,
  };
  return { ...payload, events: [...payload.events, event] };
}

/** True only in a dev build with `?demo` in the URL or VITE_AGENTVIEW_DEMO=1. */
export function isDemoEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  const flagged = (import.meta.env.VITE_AGENTVIEW_DEMO ?? "0") === "1";
  const queried =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
  return flagged || queried;
}

interface DemoInsertsOptions {
  enabled: boolean;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setTimelinePayload: Dispatch<SetStateAction<TimelinePayload | undefined>>;
  intervalMs?: number;
}

export function useDemoInserts({
  enabled,
  setSessions,
  setTimelinePayload,
  intervalMs = 2600,
}: DemoInsertsOptions): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let seq = 0;
    const tick = () => {
      seq += 1;
      const nowMs = Date.now();
      setTimelinePayload((current) => (current ? appendDemoEvent(current, seq, nowMs) : current));
      setSessions((prev) => (prev[0] ? [buildDemoSession(prev[0], seq, nowMs), ...prev] : prev));
    };
    const timer = setInterval(tick, intervalMs);
    // Expose a manual trigger so e2e can step inserts deterministically.
    (window as unknown as { __agentviewDemoInsert?: () => void }).__agentviewDemoInsert = tick;
    return () => {
      clearInterval(timer);
      delete (window as unknown as { __agentviewDemoInsert?: () => void }).__agentviewDemoInsert;
    };
  }, [enabled, setSessions, setTimelinePayload, intervalMs]);
}
