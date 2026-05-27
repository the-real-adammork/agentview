import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCodexHomeFixture } from "../fixtures/codexHome";
import { startApi, stopRunningApis } from "../helpers/apiServer";

afterEach(async () => {
  await stopRunningApis();
});

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

// Minimal SSE reader: collects named events until `predicate` is satisfied or timeout.
const readSse = async (
  url: string,
  predicate: (events: SseEvent[]) => boolean,
  timeoutMs = 6000,
): Promise<{ events: SseEvent[]; headers: Headers }> => {
  const response = await fetch(url, { headers: { accept: "text/event-stream" } });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const eventMatch = /^event: (.+)$/m.exec(chunk);
        const dataMatch = /^data: (.+)$/m.exec(chunk);
        if (eventMatch && dataMatch) events.push({ event: eventMatch[1], data: JSON.parse(dataMatch[1]) });
      }
      if (predicate(events)) break;
    }
  } finally {
    // Cancelling the reader closes the underlying connection so the server tears down.
    await reader.cancel().catch(() => undefined);
  }
  return { events, headers: response.headers };
};

describe("stream API", () => {
  it("streams ready then a timeline delta when the rollout grows", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "t1", rolloutPath: "sessions/t1.jsonl", createdAtMs: 1000, updatedAtMs: 2000, cwd: "/repo", title: "T1" },
      ],
    });
    const rolloutPath = join(fixture.codexHome, "sessions/t1.jsonl");
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(
      rolloutPath,
      `${JSON.stringify({ timestamp: "2026-05-27T10:00:00.000Z", type: "message", role: "user", text: "hi" })}\n`,
    );

    const api = await startApi({ codexHome: fixture.codexHome });
    try {
      const streamUrl = `${api.baseUrl}/api/stream?threadId=t1`;
      setTimeout(() => {
        void appendFile(
          rolloutPath,
          `${JSON.stringify({ timestamp: "2026-05-27T10:01:00.000Z", type: "message", role: "assistant", text: "delta-event" })}\n`,
        );
      }, 500);

      const { events, headers } = await readSse(streamUrl, (e) => e.some((x) => x.event === "timeline"));
      expect(headers.get("content-type")).toContain("text/event-stream");
      expect(events.some((e) => e.event === "ready")).toBe(true);
      const timeline = events.find((e) => e.event === "timeline");
      const timelineEvents = timeline?.data.events as Array<{ previewText: string }> | undefined;
      expect(timelineEvents?.at(-1)?.previewText).toContain("delta-event");
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });

  it("returns 404 when AGENTVIEW_LIVE=0", async () => {
    const fixture = await createCodexHomeFixture({ threads: [] });
    const api = await startApi({ codexHome: fixture.codexHome, env: { AGENTVIEW_LIVE: "0" } });
    try {
      const response = await fetch(`${api.baseUrl}/api/stream?threadId=t1`, {
        headers: { accept: "text/event-stream" },
      });
      expect(response.status).toBe(404);
      await response.body?.cancel();
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });
});
