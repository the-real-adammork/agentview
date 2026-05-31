import { appendFile, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLiveHub, type LiveConnection } from "../../src/backend/live/liveHub";
import { createLiveSources } from "../../src/backend/live/liveSources";
import { createClaudeCodeSource } from "../../src/backend/sources/claudeCode/ClaudeCodeSource";
import { createCodexSource } from "../../src/backend/sources/codex/CodexSource";
import { createSourceRegistry } from "../../src/backend/sources/registry";
import { createClaudeProjectsFixture } from "../fixtures/claudeProjects";
import { createCodexHomeFixture } from "../fixtures/codexHome";

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

// A WatchManager test double whose signals we can fire by key (matches liveSources.test.ts).
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

const CC_ID = "44444444-4444-4444-8444-444444444444";
const CC_CWD = "/repo/cc-live-app";

const ccTranscriptPath = (projectsDir: string) =>
  join(projectsDir, CC_CWD.replace(/[/.]/g, "-"), `${CC_ID}.jsonl`);

const ccAssistantTurn = (uuid: string, text: string, timestamp: string) =>
  `${JSON.stringify({
    type: "assistant",
    uuid,
    parentUuid: `${CC_ID}-user-0`,
    sessionId: CC_ID,
    timestamp,
    cwd: CC_CWD,
    gitBranch: "main",
    version: "1.2.3",
    isSidechain: false,
    userType: "external",
    message: { role: "assistant", content: [{ type: "text", text }] },
  })}\n`;

const useCacheRoot = async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-cc-live-cache-"));
  cleanups.push(() => rm(cacheRoot, { recursive: true, force: true }));
  process.env.AGENTVIEW_CACHE_ROOT = cacheRoot;
};

const makeCcRegistry = async () => {
  const fixture = await createClaudeProjectsFixture({
    sessions: [
      {
        sessionId: CC_ID,
        cwd: CC_CWD,
        aiTitle: "Live CC session",
        firstUserMessage: "Investigate the live session",
        createdAtMs: 1_700_000_000_000,
        updatedAtMs: 1_700_000_100_000,
        assistantUsages: [{ input: 100, output: 50 }],
      },
    ],
  });
  cleanups.push(fixture.cleanup);
  const registry = createSourceRegistry([createClaudeCodeSource({ projectsDir: fixture.projectsDir })]);
  return { registry, projectsDir: fixture.projectsDir };
};

describe("ccLiveTail", () => {
  it("subscribes a CC session and streams an appended turn over the timeline channel", async () => {
    const { registry, projectsDir } = await makeCcRegistry();
    const transcriptPath = ccTranscriptPath(projectsDir);

    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ registry, hub, watchManager });
    const { connection, sent } = makeCapturingConn("cc1", CC_ID);
    hub.add(connection);

    const teardown = await sources.subscribe({
      connection,
      threadId: CC_ID,
      source: "claude-code",
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: null, // baseline to current EOF
      logCursorId: null,
    });

    const ready = sent.find((s) => s.channel === "ready");
    expect(ready).toBeDefined();
    const baseline = ready!.payload.nextByteOffset as number;
    expect(baseline).toBeGreaterThan(0);
    expect(baseline).toBe((await stat(transcriptPath)).size);

    await appendFile(transcriptPath, ccAssistantTurn("a-new", "A freshly appended live turn.", "2026-05-30T11:00:00.000Z"));
    fire(`rollout:${CC_ID}`);
    await vi.waitFor(() => expect(sent.some((s) => s.channel === "timeline")).toBe(true));

    const timeline = sent.filter((s) => s.channel === "timeline").at(-1)!;
    const events = timeline.payload.events as Array<{ previewText: string; kind: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("assistant_message");
    expect(events[0].previewText).toContain("freshly appended live turn");
    expect(timeline.payload.nextByteOffset as number).toBeGreaterThan(baseline);
    expect(timeline.payload.reset).toBe(false);

    await teardown();
    await sources.close();
  });

  it("holds a half-written CC line: no timeline frame until the newline lands", async () => {
    const { registry, projectsDir } = await makeCcRegistry();
    const transcriptPath = ccTranscriptPath(projectsDir);

    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ registry, hub, watchManager });
    const { connection, sent } = makeCapturingConn("cc2", CC_ID);
    hub.add(connection);

    await sources.subscribe({
      connection,
      threadId: CC_ID,
      source: "claude-code",
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: null,
      logCursorId: null,
    });

    const timelineCountBefore = sent.filter((s) => s.channel === "timeline").length;

    // Append a complete turn WITHOUT its terminating newline, fire → no frame.
    const fullLine = ccAssistantTurn("a-partial", "Partial CC turn must wait.", "2026-05-30T11:05:00.000Z");
    const partial = fullLine.slice(0, -1); // strip the trailing "\n"
    await appendFile(transcriptPath, partial);
    fire(`rollout:${CC_ID}`);
    // Give the async push a chance to (not) emit.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent.filter((s) => s.channel === "timeline").length).toBe(timelineCountBefore);

    // Complete the line, fire → the now-complete event is delivered.
    await appendFile(transcriptPath, "\n");
    fire(`rollout:${CC_ID}`);
    await vi.waitFor(() => expect(sent.filter((s) => s.channel === "timeline").length).toBeGreaterThan(timelineCountBefore));
    const timeline = sent.filter((s) => s.channel === "timeline").at(-1)!;
    const events = timeline.payload.events as Array<{ previewText: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].previewText).toContain("Partial CC turn must wait");

    await sources.close();
  });

  it("Codex parity: source 'codex' streams the same delta as before", async () => {
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
      `${JSON.stringify({ timestamp: "2026-05-27T10:00:00.000Z", type: "message", role: "user", text: "hi" })}\n`,
    );

    const registry = createSourceRegistry([createCodexSource({ codexHome: fixture.codexHome })]);
    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ codexHome: fixture.codexHome, registry, hub, watchManager });
    const { connection, sent } = makeCapturingConn("cx1", "t1");
    hub.add(connection);

    const teardown = await sources.subscribe({
      connection,
      threadId: "t1",
      source: "codex",
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: null,
      logCursorId: null,
    });

    const ready = sent.find((s) => s.channel === "ready");
    const baseline = ready!.payload.nextByteOffset as number;
    expect(baseline).toBeGreaterThan(0);

    await appendFile(
      rolloutPath,
      `${JSON.stringify({ timestamp: "2026-05-27T10:01:00.000Z", type: "message", role: "assistant", text: "yo" })}\n`,
    );
    fire("rollout:t1");
    await vi.waitFor(() => expect(sent.some((s) => s.channel === "timeline")).toBe(true));

    const timeline = sent.filter((s) => s.channel === "timeline").at(-1)!;
    const events = timeline.payload.events as Array<{ previewText: string }>;
    expect(events).toHaveLength(1);
    expect(events[0].previewText).toContain("yo");
    expect(timeline.payload.nextByteOffset as number).toBeGreaterThan(baseline);
    expect(timeline.payload.reset).toBe(false);
    // Codex still gets a tokens push (CC does not — tokens stays Codex-only this phase).
    expect(sent.some((s) => s.channel === "tokens")).toBe(true);

    await teardown();
    await sources.close();
  });

  it("Codex parity: an omitted source defaults to codex", async () => {
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
      `${JSON.stringify({ timestamp: "2026-05-27T10:00:00.000Z", type: "message", role: "user", text: "hi" })}\n`,
    );

    const registry = createSourceRegistry([createCodexSource({ codexHome: fixture.codexHome })]);
    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ codexHome: fixture.codexHome, registry, hub, watchManager });
    const { connection, sent } = makeCapturingConn("cx2", "t1");
    hub.add(connection);

    await sources.subscribe({
      connection,
      threadId: "t1",
      // source intentionally omitted → defaults to "codex".
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: null,
      logCursorId: null,
    });

    await appendFile(
      rolloutPath,
      `${JSON.stringify({ timestamp: "2026-05-27T10:01:00.000Z", type: "message", role: "assistant", text: "default-yo" })}\n`,
    );
    fire("rollout:t1");
    await vi.waitFor(() => expect(sent.some((s) => s.channel === "timeline")).toBe(true));
    const timeline = sent.filter((s) => s.channel === "timeline").at(-1)!;
    const events = timeline.payload.events as Array<{ previewText: string }>;
    expect(events[0].previewText).toContain("default-yo");

    await sources.close();
  });
});
