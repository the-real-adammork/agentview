import { getRawTimeline } from "../api/client";
import type { TimelineEvent } from "../../shared/contracts";

/**
 * Export the raw original-rollout JSONL for a filtered set of timeline events.
 * The events are already filtered client-side (any combination of tool-type,
 * event-type, tab, window, scope), so this exports exactly what's on screen. Each
 * event's `sourceLine` is grouped by thread (handles +SUBS) and fetched verbatim
 * from the server, then downloaded as one `.jsonl` file.
 */
export async function exportFilteredRollout(events: TimelineEvent[], label = "filtered"): Promise<number> {
  if (events.length === 0) return 0;

  const byThread = new Map<string, number[]>();
  for (const event of events) {
    const lines = byThread.get(event.threadId);
    if (lines) lines.push(event.sourceLine);
    else byThread.set(event.threadId, [event.sourceLine]);
  }

  const parts: string[] = [];
  for (const [threadId, sourceLines] of byThread) {
    const text = (await getRawTimeline(threadId, sourceLines, true)).trimEnd();
    if (text) parts.push(text);
  }
  const ndjson = `${parts.join("\n")}\n`;

  const blob = new Blob([ndjson], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const safeLabel = label.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "filtered";
  anchor.href = url;
  anchor.download = `agentview-${events[0].threadId.slice(0, 8)}-${safeLabel}-${events.length}.jsonl`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return events.length;
}
