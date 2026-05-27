import { mkdir, writeFile, appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodexHomeFixture } from "../fixtures/codexHome";
import { createLiveHub, type LiveConnection } from "../../src/backend/live/liveHub";
import { createLiveSources } from "../../src/backend/live/liveSources";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  delete process.env.AGENTVIEW_CACHE_ROOT;
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

interface CapturedFrame {
  channel: string;
  payload: Record<string, unknown>;
}

const makeCapturingConn = (id: string, threadId: string | null) => {
  const sent: CapturedFrame[] = [];
  const connection: LiveConnection = {
    id,
    threadId,
    write: (frame) => {
      const match = /^event: (.+)\ndata: (.+)\n\n$/s.exec(frame);
      if (match) sent.push({ channel: match[1], payload: JSON.parse(match[2]) });
      return true;
    },
    close: () => undefined,
  };
  return { connection, sent };
};

// A WatchManager test double whose signals we can fire by key.
const makeFakeWatch = () => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    fire: (key: string) => listeners.get(key)?.forEach((fn) => fn()),
    watchManager: {
      watch(key: string, _path: string, listener: () => void) {
        const set = listeners.get(key) ?? new Set<() => void>();
        set.add(listener);
        listeners.set(key, set);
        return () => set.delete(listener);
      },
      close() {
        listeners.clear();
      },
    },
  };
};

const rolloutLine = (line: Record<string, unknown>) => `${JSON.stringify(line)}\n`;

const useCacheRoot = async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-live-cache-"));
  cleanups.push(() => rm(cacheRoot, { recursive: true, force: true }));
  process.env.AGENTVIEW_CACHE_ROOT = cacheRoot;
};

describe("liveSources", () => {
  it("pushes a timeline delta with the correct nextByteOffset and only new events", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "t1", rolloutPath: "sessions/t1.jsonl", createdAtMs: 1000, updatedAtMs: 2000, cwd: "/repo", title: "T1" },
      ],
    });
    cleanups.push(fixture.cleanup);
    await useCacheRoot();

    const rolloutPath = join(fixture.codexHome, "sessions/t1.jsonl");
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(
      rolloutPath,
      rolloutLine({ timestamp: "2026-05-27T10:00:00.000Z", type: "message", role: "user", text: "hi" }),
    );

    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ codexHome: fixture.codexHome, hub, watchManager });
    const { connection, sent } = makeCapturingConn("c1", "t1");
    hub.add(connection);

    const teardown = await sources.subscribe({
      connection,
      threadId: "t1",
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: null, // baseline to current EOF
      logCursorId: null,
    });

    const ready = sent.find((s) => s.channel === "ready");
    expect(ready).toBeDefined();
    const baseline = ready!.payload.nextByteOffset as number;
    expect(baseline).toBeGreaterThan(0);

    await appendFile(
      rolloutPath,
      rolloutLine({ timestamp: "2026-05-27T10:01:00.000Z", type: "message", role: "assistant", text: "yo" }),
    );
    fire("rollout:t1");
    await vi.waitFor(() => expect(sent.some((s) => s.channel === "timeline")).toBe(true));

    const timeline = sent.filter((s) => s.channel === "timeline").at(-1)!;
    const events = timeline.payload.events as Array<{ previewText: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].previewText).toContain("yo");
    expect(timeline.payload.nextByteOffset as number).toBeGreaterThan(baseline);
    expect(timeline.payload.reset).toBe(false);
    expect(sent.some((s) => s.channel === "tokens")).toBe(true);

    await teardown();
    await sources.close();
  });

  it("pushes a full sessions snapshot on a state-db signal", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "t1", rolloutPath: "sessions/t1.jsonl", createdAtMs: 1000, updatedAtMs: 2000, cwd: "/repo", title: "T1" },
      ],
    });
    cleanups.push(fixture.cleanup);

    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ codexHome: fixture.codexHome, hub, watchManager });
    const { connection, sent } = makeCapturingConn("c1", null);
    hub.add(connection);

    const teardown = await sources.subscribe({
      connection,
      threadId: null,
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: null,
      logCursorId: null,
    });

    fire("state-db");
    await vi.waitFor(() => expect(sent.some((s) => s.channel === "sessions")).toBe(true));
    const sessions = sent.filter((s) => s.channel === "sessions").at(-1)!;
    const list = sessions.payload.sessions as Array<{ id: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("t1");

    await teardown();
    await sources.close();
  });

  it("resets the client when the rollout is truncated", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "t1", rolloutPath: "sessions/t1.jsonl", createdAtMs: 1000, updatedAtMs: 2000, cwd: "/repo", title: "T1" },
      ],
    });
    cleanups.push(fixture.cleanup);
    await useCacheRoot();

    const rolloutPath = join(fixture.codexHome, "sessions/t1.jsonl");
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(
      rolloutPath,
      rolloutLine({ timestamp: "2026-05-27T10:00:00.000Z", type: "message", role: "user", text: "a long first message" }),
    );

    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ codexHome: fixture.codexHome, hub, watchManager });
    const { connection, sent } = makeCapturingConn("c1", "t1");
    hub.add(connection);

    await sources.subscribe({
      connection,
      threadId: "t1",
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: 99999, // pretend client is past EOF → truncation
      logCursorId: null,
    });

    fire("rollout:t1");
    await vi.waitFor(() => expect(sent.some((s) => s.channel === "timeline")).toBe(true));
    const timeline = sent.filter((s) => s.channel === "timeline").at(-1)!;
    expect(timeline.payload.reset).toBe(true);

    await sources.close();
  });
});
