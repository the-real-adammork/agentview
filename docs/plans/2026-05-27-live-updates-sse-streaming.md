# Live Updates via File-Watch + SSE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push live session/timeline/token/diagnostics updates to the AgentView UI with <300ms latency via server-side `fs.watch` → SSE incremental deltas, with fetch-on-navigate remaining the fallback.

**Architecture:** Three new server modules with strict responsibilities — `watchManager` (filesystem only), `liveHub` (subscribers/fan-out only), `liveSources` (glue: re-query + build payloads, owns per-connection cursors) — plus an SSE handler `api/stream.ts` and a client `EventSource` wrapper `frontend/api/liveStream.ts`. The live layer is never load-bearing: `AGENTVIEW_LIVE=0` disables it and the existing `fetch` path is the source of truth and initial load.

**Tech Stack:** Node `node:http` + `node:fs` (`watch`/`watchFile`), browser `EventSource`, React 19, TypeScript, vitest (jsdom), `@testing-library/react`.

Source design: `docs/design/2026-05-27-live-updates-sse-streaming-design.md`.

---

## File Structure

**New (server)**
- `src/backend/live/liveHub.ts` — subscriber registry + SSE frame formatting + backpressure policy. No files, no DB.
- `src/backend/live/watchManager.ts` — ref-counted `fs.watch` + `fs.watchFile` safety-net poll, debounced signals keyed `state-db` / `logs-db` / `rollout:<threadId>`. No SQLite, no SSE.
- `src/backend/live/liveSources.ts` — glue. Long-lived read-only `StateStore`/`LogStore`, reuses `tailRolloutFile` + `getRolloutFactsWithCache` + `deriveTokenSeries`. Owns per-connection cursor state. Translates watch signals → `liveHub` sends.
- `src/backend/live/liveRuntime.ts` — lazily-constructed process singleton binding `{ hub, watchManager, sources }` to a resolved `codexHome`, so `stream.ts` stays a thin handler and `server.ts`'s change is one line.
- `src/backend/api/stream.ts` — `handleStreamApiRequest` for `GET /api/stream`. SSE headers, connection wrapper, heartbeat, subscribe, cleanup on socket close. Honors `AGENTVIEW_LIVE`.

**New (client)**
- `src/frontend/api/liveStream.ts` — `EventSource` wrapper: opens `/api/stream`, routes named events to typed callbacks, tracks cursors, manual capped reconnect with cursor resync.

**Modified**
- `src/shared/contracts.ts` — SSE channel payload types + `LiveChannel` union.
- `src/backend/server.ts` — register `handleStreamApiRequest` in the handler chain.
- `src/backend/api/tokens.ts` — no change required (`deriveTokenSeries` already exported); confirm import path.
- `src/frontend/App.tsx` — open the live stream for the active session; route deltas into existing `setSessions` / `setTimelinePayload` / `setTokenSeries` / `setSessionDiagnostics`.
- `eslint.config.js` — add `setInterval` / `clearInterval` to `nodeGlobals` (heartbeat + poll) **only if** `npm run lint` flags them.

**Tests**
- `tests/unit/liveHub.test.ts`
- `tests/unit/watchManager.test.ts`
- `tests/integration/liveSources.test.ts`
- `tests/integration/streamApi.test.ts`
- `tests/unit/liveStream.test.ts`
- `tests/unit/app-live.test.tsx`

---

## Shared Type Contract (used across tasks)

Added to `src/shared/contracts.ts` in Task 1. Referenced by every later task — names are fixed here:

```ts
export type LiveChannel = "sessions" | "timeline" | "tokens" | "diagnostics" | "ready" | "error";

export interface LiveSessionsPayload {
  sessions: SessionSummary[];
}

export interface LiveTimelinePayload {
  threadId: string;
  events: TimelineEvent[];
  nextByteOffset: number;
  /** true when the rollout was truncated/rotated — client replaces events instead of appending. */
  reset: boolean;
  warnings: string[];
}

export interface LiveTokensPayload {
  threadId: string;
  series: TokenSeries;
}

export interface LiveDiagnosticsPayload {
  summary: DiagnosticsSummary;
  /** Log rows newer than the connection's last cursor (may be empty). */
  logs: RuntimeLog[];
}

export interface LiveReadyPayload {
  threadId: string | null;
  nextByteOffset: number | null;
  logCursorId: number | null;
}

export interface LiveErrorPayload {
  code: string;
  message: string;
  channel?: LiveChannel;
}
```

---

## Task 1: SSE channel payload contracts

**Files:**
- Modify: `src/shared/contracts.ts` (append after `ObservatoryApi`)
- Test: `tests/unit/contracts.test.ts` (existing file — append a block)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/contracts.test.ts`:

```ts
import type {
  LiveChannel,
  LiveTimelinePayload,
  LiveReadyPayload,
} from "../../src/shared/contracts";

describe("live stream contracts", () => {
  it("types a timeline delta payload with append/reset semantics", () => {
    const payload: LiveTimelinePayload = {
      threadId: "thread-1",
      events: [],
      nextByteOffset: 42,
      reset: false,
      warnings: [],
    };
    expect(payload.nextByteOffset).toBe(42);
    expect(payload.reset).toBe(false);
  });

  it("types a ready control payload and channel union", () => {
    const channels: LiveChannel[] = ["sessions", "timeline", "tokens", "diagnostics", "ready", "error"];
    const ready: LiveReadyPayload = { threadId: null, nextByteOffset: null, logCursorId: null };
    expect(channels).toContain("ready");
    expect(ready.threadId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/contracts.test.ts`
Expected: FAIL — `LiveChannel` / `LiveTimelinePayload` / `LiveReadyPayload` not exported (TS error in test).

- [ ] **Step 3: Implement the types**

Append the full "Shared Type Contract" block above to `src/shared/contracts.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts.ts tests/unit/contracts.test.ts
git commit -m "feat(contracts): add SSE live channel payload types"
```

---

## Task 2: `liveHub` — subscriber registry, frame formatting, backpressure

**Responsibility:** Hold open SSE connections; format named SSE frames; apply the backpressure policy (snapshot channels drop on backpressure; `timeline` deltas force a close; control channels are best-effort). Knows nothing about files or DBs.

**Files:**
- Create: `src/backend/live/liveHub.ts`
- Test: `tests/unit/liveHub.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import { createLiveHub, formatSseFrame } from "../../src/backend/live/liveHub";
import type { LiveConnection } from "../../src/backend/live/liveHub";

const makeConn = (id: string, threadId: string | null, writeReturns = true): LiveConnection & {
  frames: string[];
  closed: boolean;
} => {
  const frames: string[] = [];
  return {
    id,
    threadId,
    frames,
    closed: false,
    write(frame: string) {
      frames.push(frame);
      return writeReturns;
    },
    close() {
      (this as { closed: boolean }).closed = true;
    },
  };
};

describe("formatSseFrame", () => {
  it("emits a named event with JSON data terminated by a blank line", () => {
    const frame = formatSseFrame("sessions", { sessions: [] });
    expect(frame).toBe('event: sessions\ndata: {"sessions":[]}\n\n');
  });
});

describe("liveHub", () => {
  it("routes thread-scoped sends only to matching connections", () => {
    const hub = createLiveHub();
    const a = makeConn("a", "thread-1");
    const b = makeConn("b", "thread-2");
    hub.add(a);
    hub.add(b);

    for (const conn of hub.connectionsForThread("thread-1")) {
      hub.send(conn, "timeline", { threadId: "thread-1", events: [], nextByteOffset: 1, reset: false, warnings: [] });
    }

    expect(a.frames).toHaveLength(1);
    expect(b.frames).toHaveLength(0);
  });

  it("delivers different per-connection payloads without cross-talk", () => {
    const hub = createLiveHub();
    const a = makeConn("a", "thread-1");
    const b = makeConn("b", "thread-1");
    hub.add(a);
    hub.add(b);

    hub.send(a, "timeline", { threadId: "thread-1", events: [], nextByteOffset: 10, reset: false, warnings: [] });
    hub.send(b, "timeline", { threadId: "thread-1", events: [], nextByteOffset: 20, reset: false, warnings: [] });

    expect(a.frames[0]).toContain('"nextByteOffset":10');
    expect(b.frames[0]).toContain('"nextByteOffset":20');
  });

  it("stops delivery after remove()", () => {
    const hub = createLiveHub();
    const a = makeConn("a", null);
    hub.add(a);
    hub.remove("a");
    expect(hub.connections()).toHaveLength(0);
  });

  it("drops coalescable snapshots on backpressure but never closes", () => {
    const hub = createLiveHub();
    const a = makeConn("a", "thread-1", /* writeReturns */ false);
    hub.add(a);
    hub.send(a, "sessions", { sessions: [] });
    expect(a.frames).toHaveLength(1); // attempted once
    expect(a.closed).toBe(false);
  });

  it("closes the connection when a timeline delta hits backpressure", () => {
    const hub = createLiveHub();
    const a = makeConn("a", "thread-1", /* writeReturns */ false);
    hub.add(a);
    hub.send(a, "timeline", { threadId: "thread-1", events: [], nextByteOffset: 1, reset: false, warnings: [] });
    expect(a.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/liveHub.test.ts`
Expected: FAIL — module `liveHub` not found.

- [ ] **Step 3: Implement `liveHub.ts`**

```ts
import type { LiveChannel } from "../../shared/contracts";

export interface LiveConnection {
  /** Stable id for this SSE connection. */
  id: string;
  /** The active thread this connection follows, or null. */
  threadId: string | null;
  /** Writes a preformatted SSE frame. Returns false when the socket buffer is full. */
  write(frame: string): boolean;
  /** Forcibly closes the connection (backpressure on a delta channel). */
  close(): void;
}

export interface LiveHub {
  add(connection: LiveConnection): void;
  remove(id: string): void;
  connections(): LiveConnection[];
  connectionsForThread(threadId: string): LiveConnection[];
  send(connection: LiveConnection, channel: LiveChannel, payload: unknown): void;
}

/** Snapshot channels: the next push supersedes them, so they are safe to drop under backpressure. */
const COALESCABLE = new Set<LiveChannel>(["sessions", "tokens", "diagnostics"]);
/** Delta channels: append-only, gaps corrupt client state — close instead of dropping. */
const CRITICAL = new Set<LiveChannel>(["timeline"]);

export const formatSseFrame = (channel: LiveChannel, payload: unknown): string =>
  `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`;

export const createLiveHub = (): LiveHub => {
  const byId = new Map<string, LiveConnection>();

  return {
    add(connection) {
      byId.set(connection.id, connection);
    },
    remove(id) {
      byId.delete(id);
    },
    connections() {
      return [...byId.values()];
    },
    connectionsForThread(threadId) {
      return [...byId.values()].filter((connection) => connection.threadId === threadId);
    },
    send(connection, channel, payload) {
      const ok = connection.write(formatSseFrame(channel, payload));
      if (ok) return;
      if (CRITICAL.has(channel)) {
        connection.close();
        byId.delete(connection.id);
      }
      // COALESCABLE + control channels: best-effort, drop silently.
    },
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/liveHub.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/backend/live/liveHub.ts tests/unit/liveHub.test.ts
git commit -m "feat(live): add liveHub subscriber registry and SSE fan-out"
```

---

## Task 3: `watchManager` — debounced, ref-counted file watching

**Responsibility:** Watch a path via `fs.watch` (latency) plus an `fs.watchFile` poll (correctness safety net). Coalesce bursts with a debounce. Emit to all listeners registered under a signal key. Ref-count so the last unwatch tears down the OS watcher. Knows nothing about SQLite or SSE.

**Files:**
- Create: `src/backend/live/watchManager.ts`
- Test: `tests/unit/watchManager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWatchManager } from "../../src/backend/live/watchManager";

describe("watchManager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const makeDeps = () => {
    const fsWatchers: Array<{ key: string; close: () => void }> = [];
    const watchListeners = new Map<string, () => void>();
    const polled = new Map<string, (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void>();
    return {
      fsWatchers,
      watchListeners,
      polled,
      deps: {
        watch: (path: string, listener: () => void) => {
          watchListeners.set(path, listener);
          const watcher = { key: path, close: vi.fn() };
          fsWatchers.push(watcher);
          return { close: watcher.close } as unknown as ReturnType<typeof import("node:fs").watch>;
        },
        watchFile: (
          path: string,
          _options: unknown,
          listener: (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void,
        ) => {
          polled.set(path, listener);
        },
        unwatchFile: (path: string) => {
          polled.delete(path);
        },
      },
    };
  };

  it("coalesces a burst into a single debounced signal", () => {
    const { watchListeners, deps } = makeDeps();
    const manager = createWatchManager({ debounceMs: 75, pollIntervalMs: 2000, ...deps });
    const listener = vi.fn();
    manager.watch("state-db", "/tmp/state_5.sqlite", listener);

    const raw = watchListeners.get("/tmp/state_5.sqlite")!;
    raw();
    raw();
    raw();
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(75);
    expect(listener).toHaveBeenCalledTimes(1);

    manager.close();
  });

  it("fires via the safety-net poll when fs.watch never emits", () => {
    const { polled, deps } = makeDeps();
    const manager = createWatchManager({ debounceMs: 75, pollIntervalMs: 2000, ...deps });
    const listener = vi.fn();
    manager.watch("logs-db", "/tmp/logs_2.sqlite", listener);

    const poll = polled.get("/tmp/logs_2.sqlite")!;
    poll({ mtimeMs: 2 }, { mtimeMs: 1 }); // changed
    vi.advanceTimersByTime(75);
    expect(listener).toHaveBeenCalledTimes(1);

    poll({ mtimeMs: 2 }, { mtimeMs: 2 }); // unchanged → ignored
    vi.advanceTimersByTime(75);
    expect(listener).toHaveBeenCalledTimes(1);

    manager.close();
  });

  it("ref-counts and tears down the OS watcher on last unwatch", () => {
    const { fsWatchers, polled, deps } = makeDeps();
    const manager = createWatchManager({ debounceMs: 75, pollIntervalMs: 2000, ...deps });
    const unwatchA = manager.watch("rollout:t1", "/tmp/t1.jsonl", vi.fn());
    const unwatchB = manager.watch("rollout:t1", "/tmp/t1.jsonl", vi.fn());
    expect(fsWatchers).toHaveLength(1);

    unwatchA();
    expect(polled.has("/tmp/t1.jsonl")).toBe(true); // still watched
    unwatchB();
    expect(polled.has("/tmp/t1.jsonl")).toBe(false); // torn down
    expect(fsWatchers[0].close).toHaveBeenCalledTimes(1);

    manager.close();
  });

  it("survives an fs.watch that throws and still polls", () => {
    const { polled } = makeDeps();
    const manager = createWatchManager({
      debounceMs: 75,
      pollIntervalMs: 2000,
      watch: () => {
        throw new Error("ENOSPC watchers exhausted");
      },
      watchFile: (path: string, _o: unknown, listener: (c: { mtimeMs: number }, p: { mtimeMs: number }) => void) => {
        polled.set(path, listener);
      },
      unwatchFile: (path: string) => polled.delete(path),
    });
    const listener = vi.fn();
    expect(() => manager.watch("state-db", "/tmp/state_5.sqlite", listener)).not.toThrow();

    polled.get("/tmp/state_5.sqlite")!({ mtimeMs: 5 }, { mtimeMs: 4 });
    vi.advanceTimersByTime(75);
    expect(listener).toHaveBeenCalledTimes(1);

    manager.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/watchManager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `watchManager.ts`**

```ts
import { watch as fsWatch, watchFile as fsWatchFile, unwatchFile as fsUnwatchFile, type FSWatcher } from "node:fs";

export type WatchSignalKey = "state-db" | "logs-db" | `rollout:${string}`;

type WatchFn = (path: string, listener: () => void) => Pick<FSWatcher, "close">;
type WatchFileFn = (
  path: string,
  options: { interval: number },
  listener: (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void,
) => void;
type UnwatchFileFn = (path: string) => void;

export interface WatchManagerOptions {
  debounceMs?: number;
  pollIntervalMs?: number;
  watch?: WatchFn;
  watchFile?: WatchFileFn;
  unwatchFile?: UnwatchFileFn;
}

export interface WatchManager {
  /** Register a listener for a key/path. Returns an unwatch fn. Multiple watchers per key are ref-counted. */
  watch(key: WatchSignalKey, path: string, listener: () => void): () => void;
  /** Tear down every watcher (process shutdown). */
  close(): void;
}

interface WatchEntry {
  path: string;
  listeners: Set<() => void>;
  watcher: Pick<FSWatcher, "close"> | null;
  pollListener: (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const defaultWatch: WatchFn = (path, listener) => fsWatch(path, { persistent: false }, () => listener());
const defaultWatchFile: WatchFileFn = (path, options, listener) =>
  fsWatchFile(path, { interval: options.interval, persistent: false }, (curr, prev) =>
    listener({ mtimeMs: curr.mtimeMs }, { mtimeMs: prev.mtimeMs }),
  );

export const createWatchManager = ({
  debounceMs = 75,
  pollIntervalMs = 2000,
  watch = defaultWatch,
  watchFile = defaultWatchFile,
  unwatchFile = fsUnwatchFile,
}: WatchManagerOptions = {}): WatchManager => {
  const entries = new Map<WatchSignalKey, WatchEntry>();

  const fire = (entry: WatchEntry) => {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null;
      for (const listener of [...entry.listeners]) listener();
    }, debounceMs);
  };

  const teardown = (key: WatchSignalKey, entry: WatchEntry) => {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
    entry.watcher?.close();
    unwatchFile(entry.path);
    entries.delete(key);
  };

  return {
    watch(key, path, listener) {
      let entry = entries.get(key);
      if (!entry) {
        entry = {
          path,
          listeners: new Set(),
          watcher: null,
          debounceTimer: null,
          pollListener: (curr, prev) => {
            if (curr.mtimeMs !== prev.mtimeMs) fire(entry!);
          },
        };
        entries.set(key, entry);
        // fs.watch is a latency optimization; on failure we lean on the poll.
        try {
          entry.watcher = watch(path, () => fire(entry!));
        } catch (error) {
          console.warn(`watchManager: fs.watch failed for ${path}, relying on poll`, error);
        }
        watchFile(path, { interval: pollIntervalMs }, entry.pollListener);
      }
      entry.listeners.add(listener);

      let unwatched = false;
      return () => {
        if (unwatched) return;
        unwatched = true;
        const current = entries.get(key);
        if (!current) return;
        current.listeners.delete(listener);
        if (current.listeners.size === 0) teardown(key, current);
      };
    },
    close() {
      for (const [key, entry] of [...entries.entries()]) teardown(key, entry);
    },
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/watchManager.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/backend/live/watchManager.ts tests/unit/watchManager.test.ts
git commit -m "feat(live): add ref-counted debounced watchManager"
```

---

## Task 4: `liveSources` — re-query and build per-connection payloads

**Responsibility:** On a watch signal, re-query through long-lived read-only stores + existing rollout primitives, build payloads, and hand them to `liveHub`. Owns per-connection cursor state (rollout byte offset, newest log id). Degrades on errors instead of crashing.

**Files:**
- Create: `src/backend/live/liveSources.ts`
- Test: `tests/integration/liveSources.test.ts`

**Dependencies reused (import, do not reimplement):**
- `resolveCodexHome` from `../codexPaths`
- `openStateStore`, `type StateStore` from `../sqlite/stateStore`
- `openLogStore`, `type LogStore` from `../sqlite/logStore`
- `resolveRolloutPath` from `../api/timeline`
- `tailRolloutFile` from `../tail/liveTail`
- `getRolloutFactsWithCache` from `../cache/rolloutCache`
- `parseRolloutFile` from `../rollout/jsonlStream`
- `deriveTokenSeries` from `../api/tokens`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, writeFile, appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodexHomeFixture, type CodexHomeFixture } from "../fixtures/codexHome";
import { createLiveHub, type LiveConnection } from "../../src/backend/live/liveHub";
import { createLiveSources } from "../../src/backend/live/liveSources";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

// A WatchManager test double whose signals we can fire by key.
const makeFakeWatch = () => {
  const listeners = new Map<string, Set<() => void>>();
  return {
    fire: (key: string) => listeners.get(key)?.forEach((fn) => fn()),
    watchManager: {
      watch(key: string, _path: string, listener: () => void) {
        const set = listeners.get(key) ?? new Set();
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

const captureConn = (id: string, threadId: string | null) => {
  const events: Array<{ channel: string; payload: unknown }> = [];
  const conn: LiveConnection = {
    id,
    threadId,
    write: () => true,
    close: () => undefined,
  };
  return { conn, events };
};

const rolloutLine = (line: Record<string, unknown>) => `${JSON.stringify(line)}\n`;

describe("liveSources", () => {
  it("pushes a timeline delta with the correct nextByteOffset and only new events", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "t1", rolloutPath: "sessions/t1.jsonl", createdAtMs: 1000, updatedAtMs: 2000, cwd: "/repo", title: "T1" },
      ],
    });
    cleanups.push(fixture.cleanup);
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-live-cache-"));
    cleanups.push(() => rm(cacheRoot, { recursive: true, force: true }));
    process.env.AGENTVIEW_CACHE_ROOT = cacheRoot;

    const rolloutPath = join(fixture.codexHome, "sessions/t1.jsonl");
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, rolloutLine({ timestamp: "2026-05-27T10:00:00.000Z", type: "message", role: "user", text: "hi" }));

    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ codexHome: fixture.codexHome, hub, watchManager });

    const sent: Array<{ channel: string; payload: any }> = [];
    const conn: LiveConnection = {
      id: "c1",
      threadId: "t1",
      write: (frame) => {
        const match = /^event: (.+)\ndata: (.+)\n\n$/s.exec(frame);
        if (match) sent.push({ channel: match[1], payload: JSON.parse(match[2]) });
        return true;
      },
      close: () => undefined,
    };
    hub.add(conn);

    const teardown = await sources.subscribe({
      connection: conn,
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

    // Append a new event, then fire the rollout signal.
    await appendFile(rolloutPath, rolloutLine({ timestamp: "2026-05-27T10:01:00.000Z", type: "message", role: "assistant", text: "yo" }));
    fire("rollout:t1");
    await vi.waitFor(() => expect(sent.some((s) => s.channel === "timeline")).toBe(true));

    const timeline = sent.filter((s) => s.channel === "timeline").at(-1)!;
    expect(timeline.payload.events).toHaveLength(1);
    expect(timeline.payload.events[0].previewText).toContain("yo");
    expect(timeline.payload.nextByteOffset).toBeGreaterThan(baseline);
    expect(timeline.payload.reset).toBe(false);
    // tokens snapshot also rides the rollout signal
    expect(sent.some((s) => s.channel === "tokens")).toBe(true);

    await teardown();
    await sources.close();
    delete process.env.AGENTVIEW_CACHE_ROOT;
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

    const sent: Array<{ channel: string; payload: any }> = [];
    const conn: LiveConnection = {
      id: "c1",
      threadId: null,
      write: (frame) => {
        const m = /^event: (.+)\ndata: (.+)\n\n$/s.exec(frame);
        if (m) sent.push({ channel: m[1], payload: JSON.parse(m[2]) });
        return true;
      },
      close: () => undefined,
    };
    hub.add(conn);

    const teardown = await sources.subscribe({
      connection: conn,
      threadId: null,
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: null,
      logCursorId: null,
    });

    fire("state-db");
    await vi.waitFor(() => expect(sent.some((s) => s.channel === "sessions")).toBe(true));
    const sessions = sent.filter((s) => s.channel === "sessions").at(-1)!;
    expect(sessions.payload.sessions).toHaveLength(1);
    expect(sessions.payload.sessions[0].id).toBe("t1");

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
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-live-cache-"));
    cleanups.push(() => rm(cacheRoot, { recursive: true, force: true }));
    process.env.AGENTVIEW_CACHE_ROOT = cacheRoot;

    const rolloutPath = join(fixture.codexHome, "sessions/t1.jsonl");
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, rolloutLine({ timestamp: "2026-05-27T10:00:00.000Z", type: "message", role: "user", text: "first message that is long" }));

    const hub = createLiveHub();
    const { fire, watchManager } = makeFakeWatch();
    const sources = createLiveSources({ codexHome: fixture.codexHome, hub, watchManager });
    const sent: Array<{ channel: string; payload: any }> = [];
    const conn: LiveConnection = {
      id: "c1",
      threadId: "t1",
      write: (frame) => {
        const m = /^event: (.+)\ndata: (.+)\n\n$/s.exec(frame);
        if (m) sent.push({ channel: m[1], payload: JSON.parse(m[2]) });
        return true;
      },
      close: () => undefined,
    };
    hub.add(conn);
    await sources.subscribe({
      connection: conn,
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
    delete process.env.AGENTVIEW_CACHE_ROOT;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/integration/liveSources.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `liveSources.ts`**

```ts
import { stat } from "node:fs/promises";

import type {
  PageOptions,
  RuntimeLog,
  SessionFilter,
} from "../../shared/contracts";
import { getRolloutFactsWithCache } from "../cache/rolloutCache";
import { resolveRolloutPath } from "../api/timeline";
import { deriveTokenSeries } from "../api/tokens";
import { parseRolloutFile } from "../rollout/jsonlStream";
import { openLogStore, type LogStore } from "../sqlite/logStore";
import { openStateStore, type StateStore } from "../sqlite/stateStore";
import { tailRolloutFile } from "../tail/liveTail";
import type { LiveConnection, LiveHub } from "./liveHub";
import type { WatchManager } from "./watchManager";

export interface LiveSubscribeRequest {
  connection: LiveConnection;
  threadId: string | null;
  filter: SessionFilter;
  page: PageOptions;
  /** Client's current rollout byte offset (null → baseline to current EOF). */
  fromByte: number | null;
  /** Client's newest seen log id (null → baseline to newest now). */
  logCursorId: number | null;
}

export interface LiveSourcesOptions {
  codexHome: string;
  hub: LiveHub;
  watchManager: WatchManager;
  /** Bounded number of new log rows fetched per diagnostics signal. */
  logFetchLimit?: number;
}

export interface LiveSources {
  subscribe(request: LiveSubscribeRequest): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

const STATE_DB_FILE = "state_5.sqlite";
const LOGS_DB_FILE = "logs_2.sqlite";

const logIdNumber = (log: RuntimeLog) => {
  const parsed = Number.parseInt(log.id.replace(/^log-/, ""), 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
};

export const createLiveSources = ({
  codexHome,
  hub,
  watchManager,
  logFetchLimit = 100,
}: LiveSourcesOptions): LiveSources => {
  // Long-lived read-only stores, opened lazily and reused. Reopened on failure.
  let stateStore: StateStore | null = null;
  let logStore: LogStore | null = null;

  const getStateStore = async () => {
    if (!stateStore) stateStore = await openStateStore({ codexHome });
    return stateStore;
  };
  const getLogStore = async () => {
    if (!logStore) logStore = await openLogStore({ codexHome });
    return logStore;
  };
  const dropStateStore = async () => {
    const store = stateStore;
    stateStore = null;
    await store?.close().catch(() => undefined);
  };
  const dropLogStore = async () => {
    const store = logStore;
    logStore = null;
    await store?.close().catch(() => undefined);
  };

  const degrade = (connection: LiveConnection, code: string, message: string, channel?: string) => {
    hub.send(connection, "error", { code, message, channel });
  };

  return {
    async subscribe(request) {
      const { connection, threadId, filter, page } = request;
      const unwatchFns: Array<() => void> = [];

      let rolloutPath: string | null = null;
      let nextByteOffset = 0;
      let logCursorId = request.logCursorId ?? 0;

      // Resolve the active thread's rollout + baseline its cursor.
      if (threadId) {
        try {
          const store = await getStateStore();
          const thread = await store.getThread(threadId);
          if (thread?.rolloutPath) {
            rolloutPath = await resolveRolloutPath(codexHome, thread.rolloutPath);
            if (request.fromByte !== null) {
              nextByteOffset = request.fromByte;
            } else {
              const sourceStat = await stat(rolloutPath);
              nextByteOffset = sourceStat.size;
            }
          }
        } catch {
          await dropStateStore();
        }
      }

      // Baseline the log cursor to the newest row when the client provided none.
      if (request.logCursorId === null) {
        try {
          const store = await getLogStore();
          const page = await store.queryLogs({ threadId: threadId ?? undefined, limit: 1 });
          logCursorId = page.logs[0] ? logIdNumber(page.logs[0]) : 0;
        } catch {
          await dropLogStore();
        }
      }

      const pushSessions = async () => {
        try {
          const store = await getStateStore();
          const sessions = await store.listSessions(filter, page);
          hub.send(connection, "sessions", { sessions });
        } catch {
          await dropStateStore();
          degrade(connection, "SESSIONS_UNAVAILABLE", "Session list feed degraded.", "sessions");
        }
      };

      const pushTimelineAndTokens = async () => {
        if (!rolloutPath || !threadId) return;
        try {
          const tail = await tailRolloutFile({ path: rolloutPath, threadId, fromByte: nextByteOffset });
          const reset = tail.truncated;
          const advanced = tail.payload.nextByteOffset;
          if (tail.payload.events.length > 0 || reset) {
            hub.send(connection, "timeline", {
              threadId,
              events: tail.payload.events,
              nextByteOffset: advanced,
              reset,
              warnings: tail.warnings,
            });
          }
          nextByteOffset = advanced;

          const cached = await getRolloutFactsWithCache({
            codexHome,
            threadId,
            rolloutPath,
            parse: (sourceMtimeMs, sourceSizeBytes) =>
              parseRolloutFile(rolloutPath!, { threadId, rolloutPath: rolloutPath!, sourceMtimeMs, sourceSizeBytes }),
          });
          hub.send(connection, "tokens", { threadId, series: deriveTokenSeries(cached.facts) });
        } catch {
          // DB-locked / transient: skip this push; the next signal retries.
        }
      };

      const pushDiagnostics = async () => {
        try {
          const store = await getLogStore();
          const summary = await store.getDiagnosticsSummary({
            threadIds: threadId ? [threadId] : [],
            targetLimit: 5,
          });
          const page = await store.queryLogs({ threadId: threadId ?? undefined, limit: logFetchLimit });
          const fresh = page.logs.filter((log) => logIdNumber(log) > logCursorId);
          if (fresh.length > 0) logCursorId = Math.max(logCursorId, ...fresh.map(logIdNumber));
          hub.send(connection, "diagnostics", { summary, logs: fresh });
        } catch {
          await dropLogStore();
        }
      };

      // Always watch the two DBs; watch the active rollout if present.
      unwatchFns.push(watchManager.watch("state-db", `${codexHome}/${STATE_DB_FILE}`, () => void pushSessions()));
      unwatchFns.push(watchManager.watch("logs-db", `${codexHome}/${LOGS_DB_FILE}`, () => void pushDiagnostics()));
      if (rolloutPath && threadId) {
        unwatchFns.push(
          watchManager.watch(`rollout:${threadId}`, rolloutPath, () => void pushTimelineAndTokens()),
        );
      }

      // Baseline established → ready.
      hub.send(connection, "ready", {
        threadId,
        nextByteOffset: rolloutPath ? nextByteOffset : null,
        logCursorId,
      });

      return async () => {
        for (const unwatch of unwatchFns) unwatch();
      };
    },
    async close() {
      await dropStateStore();
      await dropLogStore();
    },
  };
};
```

> **Implementer note on `getRolloutFactsWithCache` cache root:** the cache helper reads `AGENTVIEW_CACHE_ROOT` internally (see `tokens.ts`/`diagnostics.ts`); tests set it. No extra wiring needed here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/integration/liveSources.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/backend/live/liveSources.ts tests/integration/liveSources.test.ts
git commit -m "feat(live): add liveSources delta/snapshot builder with cursors"
```

---

## Task 5: `liveRuntime` singleton

**Responsibility:** Build and memoize one `{ hub, watchManager, sources }` bound to the resolved `codexHome`, so the stateless handler chain can share them. Lets `stream.ts` stay thin.

**Files:**
- Create: `src/backend/live/liveRuntime.ts`
- Test: covered indirectly by Task 6 integration test (no separate unit test — it is a 20-line memoizer with no branching logic worth isolating).

- [ ] **Step 1: Implement `liveRuntime.ts`**

```ts
import { resolveCodexHome } from "../codexPaths";
import { createLiveHub, type LiveHub } from "./liveHub";
import { createLiveSources, type LiveSources } from "./liveSources";
import { createWatchManager, type WatchManager } from "./watchManager";

export interface LiveRuntime {
  hub: LiveHub;
  watchManager: WatchManager;
  sources: LiveSources;
}

let runtime: LiveRuntime | null = null;

export const getLiveRuntime = async (): Promise<LiveRuntime> => {
  if (runtime) return runtime;
  const codexHome = await resolveCodexHome();
  const hub = createLiveHub();
  const watchManager = createWatchManager();
  const sources = createLiveSources({ codexHome, hub, watchManager });
  runtime = { hub, watchManager, sources };
  return runtime;
};

/** Test/shutdown helper: tear everything down and clear the singleton. */
export const resetLiveRuntime = async (): Promise<void> => {
  if (!runtime) return;
  runtime.watchManager.close();
  await runtime.sources.close();
  runtime = null;
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/backend/live/liveRuntime.ts
git commit -m "feat(live): add memoized live runtime singleton"
```

---

## Task 6: `api/stream.ts` — SSE endpoint + heartbeat + lifecycle

**Responsibility:** Handle `GET /api/stream?threadId=&fromByte=&logCursorId=`. Set SSE headers, wrap the response as a `LiveConnection`, register with the hub, subscribe via `liveSources`, emit a heartbeat comment ~every 20s, and tear everything down on socket close. Honor `AGENTVIEW_LIVE`.

**Files:**
- Create: `src/backend/api/stream.ts`
- Test: `tests/integration/streamApi.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCodexHomeFixture, type CodexHomeFixture } from "../fixtures/codexHome";
import { startApi, stopRunningApis } from "../helpers/apiServer";

afterEach(async () => {
  await stopRunningApis();
});

// Minimal SSE reader: resolves with collected named events until `predicate` is satisfied.
const readSse = async (
  url: string,
  predicate: (events: Array<{ event: string; data: any }>) => boolean,
  timeoutMs = 6000,
) => {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { accept: "text/event-stream" }, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ event: string; data: any }> = [];
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
    controller.abort();
  }
  return { events, headers: response.headers, status: response.status };
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
    await writeFile(rolloutPath, `${JSON.stringify({ timestamp: "2026-05-27T10:00:00.000Z", type: "message", role: "user", text: "hi" })}\n`);

    const api = await startApi({ codexHome: fixture.codexHome });
    try {
      const streamUrl = `${api.baseUrl}/api/stream?threadId=t1`;
      // Append shortly after connecting so the watcher fires.
      setTimeout(() => {
        void appendFile(rolloutPath, `${JSON.stringify({ timestamp: "2026-05-27T10:01:00.000Z", type: "message", role: "assistant", text: "delta-event" })}\n`);
      }, 400);

      const { events, headers } = await readSse(streamUrl, (e) => e.some((x) => x.event === "timeline"));
      expect(headers.get("content-type")).toContain("text/event-stream");
      expect(events.some((e) => e.event === "ready")).toBe(true);
      const timeline = events.find((e) => e.event === "timeline");
      expect(timeline?.data.events.at(-1)?.previewText).toContain("delta-event");
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });

  it("returns 404 when AGENTVIEW_LIVE=0", async () => {
    const fixture = await createCodexHomeFixture({ threads: [] });
    const api = await startApi({ codexHome: fixture.codexHome, env: { AGENTVIEW_LIVE: "0" } });
    try {
      const response = await fetch(`${api.baseUrl}/api/stream?threadId=t1`, { headers: { accept: "text/event-stream" } });
      expect(response.status).toBe(404);
      await response.body?.cancel();
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/integration/streamApi.test.ts`
Expected: FAIL — route not registered (404 for both) / module missing.

- [ ] **Step 3: Implement `stream.ts`**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { corsHeadersForOrigin } from "./http";
import type { LiveConnection } from "../live/liveHub";
import { getLiveRuntime } from "../live/liveRuntime";

const HEARTBEAT_MS = 20_000;

const liveEnabled = () => (process.env.AGENTVIEW_LIVE ?? "1") !== "0";

const parseIntParam = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const handleStreamApiRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/api/stream") return false;

  // Kill switch / method guard fall through to the 404 path so the client drops to fetch-only.
  if (!liveEnabled() || request.method !== "GET") return false;

  const threadId = url.searchParams.get("threadId")?.trim() || null;
  const fromByte = parseIntParam(url.searchParams.get("fromByte"));
  const logCursorId = parseIntParam(url.searchParams.get("logCursorId"));

  response.writeHead(200, {
    ...corsHeadersForOrigin(origin),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // Open the stream immediately so proxies/browsers commit to the connection.
  response.write(":ok\n\n");

  const connection: LiveConnection = {
    id: randomUUID(),
    threadId,
    write: (frame) => response.write(frame),
    close: () => response.end(),
  };

  const runtime = await getLiveRuntime();
  runtime.hub.add(connection);

  const heartbeat = setInterval(() => {
    response.write(": keep-alive\n\n");
  }, HEARTBEAT_MS);

  const teardown = await runtime.sources.subscribe({
    connection,
    threadId,
    filter: { archived: "include" },
    page: { limit: 500, offset: 0 },
    fromByte,
    logCursorId,
  });

  const cleanup = () => {
    clearInterval(heartbeat);
    runtime.hub.remove(connection.id);
    void teardown();
  };
  request.on("close", cleanup);
  response.on("close", cleanup);

  return true;
};
```

> **Implementer note:** `setInterval`/`clearInterval` are runtime globals. If `npm run lint` reports `no-undef`, add `clearInterval: "readonly"` and `setInterval: "readonly"` to `nodeGlobals` in `eslint.config.js`. (TypeScript already resolves them via `@types/node`.)

- [ ] **Step 4: Register the handler in `server.ts`**

In `src/backend/server.ts`, add the import and insert the handler into the chain before the 404 fallthrough:

```ts
import { handleStreamApiRequest } from "./api/stream";
```

```ts
    if (await handleStreamApiRequest(request, response)) {
      return;
    }
```

(Place it after `handleDiagnosticsApiRequest` and before `handleFixtureApiRequest`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run tests/integration/streamApi.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/backend/api/stream.ts src/backend/server.ts
git commit -m "feat(live): add SSE /api/stream endpoint and register handler"
```

---

## Task 7: `frontend/api/liveStream.ts` — EventSource wrapper

**Responsibility:** Open `/api/stream` with cursor query params, route named events to typed callbacks, track the latest cursor, and manually reconnect (capped) with cursor resync. `EventSource` is injectable for tests.

**Files:**
- Create: `src/frontend/api/liveStream.ts`
- Test: `tests/unit/liveStream.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import { openLiveStream } from "../../src/frontend/api/liveStream";

// Minimal EventSource fake.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, (event: { data: string }) => void>();
  onerror: ((event: unknown) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

describe("openLiveStream", () => {
  it("routes named events to typed callbacks and tracks the timeline cursor", () => {
    FakeEventSource.instances = [];
    const onTimeline = vi.fn();
    const onReady = vi.fn();
    openLiveStream({
      baseUrl: "http://127.0.0.1:4317",
      threadId: "t1",
      fromByte: 10,
      logCursorId: null,
      callbacks: {
        onSessions: vi.fn(),
        onTimeline,
        onTokens: vi.fn(),
        onDiagnostics: vi.fn(),
        onReady,
        onError: vi.fn(),
      },
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });

    const es = FakeEventSource.instances[0];
    expect(es.url).toContain("threadId=t1");
    expect(es.url).toContain("fromByte=10");

    es.emit("ready", { threadId: "t1", nextByteOffset: 10, logCursorId: null });
    es.emit("timeline", { threadId: "t1", events: [{ id: "e1" }], nextByteOffset: 50, reset: false, warnings: [] });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onTimeline).toHaveBeenCalledWith(expect.objectContaining({ nextByteOffset: 50 }));
  });

  it("reconnects with the latest cursor and stops after maxRetries without ready", () => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    const handle = openLiveStream({
      baseUrl: "http://127.0.0.1:4317",
      threadId: "t1",
      fromByte: 0,
      logCursorId: null,
      maxRetries: 2,
      callbacks: {
        onSessions: vi.fn(),
        onTimeline: vi.fn(),
        onTokens: vi.fn(),
        onDiagnostics: vi.fn(),
        onReady: vi.fn(),
        onError: vi.fn(),
      },
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });

    // First connection advances the cursor, then errors → reconnect uses new cursor.
    FakeEventSource.instances[0].emit("timeline", { threadId: "t1", events: [], nextByteOffset: 77, reset: false, warnings: [] });
    FakeEventSource.instances[0].onerror?.({});
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances[1].url).toContain("fromByte=77");

    // Two consecutive errors without ready → give up (no third instance).
    FakeEventSource.instances[1].onerror?.({});
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(2);

    handle.close();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/liveStream.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `liveStream.ts`**

```ts
import type {
  LiveDiagnosticsPayload,
  LiveErrorPayload,
  LiveReadyPayload,
  LiveSessionsPayload,
  LiveTimelinePayload,
  LiveTokensPayload,
} from "../../shared/contracts";

export interface LiveStreamCallbacks {
  onSessions(payload: LiveSessionsPayload): void;
  onTimeline(payload: LiveTimelinePayload): void;
  onTokens(payload: LiveTokensPayload): void;
  onDiagnostics(payload: LiveDiagnosticsPayload): void;
  onReady(payload: LiveReadyPayload): void;
  onError(payload: LiveErrorPayload): void;
}

export interface OpenLiveStreamOptions {
  baseUrl?: string;
  threadId: string | null;
  fromByte: number | null;
  logCursorId: number | null;
  callbacks: LiveStreamCallbacks;
  EventSourceImpl?: typeof EventSource;
  /** Max consecutive failed reconnects (without a `ready`) before giving up. */
  maxRetries?: number;
  reconnectDelayMs?: number;
}

export interface LiveStreamHandle {
  close(): void;
}

const defaultBaseUrl = (import.meta.env.VITE_AGENTVIEW_API_BASE_URL ?? "http://127.0.0.1:4317").replace(/\/$/, "");

export const openLiveStream = ({
  baseUrl = defaultBaseUrl,
  threadId,
  fromByte,
  logCursorId,
  callbacks,
  EventSourceImpl = EventSource,
  maxRetries = 5,
  reconnectDelayMs = 3000,
}: OpenLiveStreamOptions): LiveStreamHandle => {
  let source: EventSource | null = null;
  let closed = false;
  let consecutiveFailures = 0;
  let currentFromByte = fromByte;
  let currentLogCursorId = logCursorId;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (threadId) params.set("threadId", threadId);
    if (currentFromByte !== null) params.set("fromByte", String(currentFromByte));
    if (currentLogCursorId !== null) params.set("logCursorId", String(currentLogCursorId));
    const query = params.toString();
    return `${baseUrl}/api/stream${query ? `?${query}` : ""}`;
  };

  const parse = <T>(handler: (payload: T) => void) => (event: MessageEvent) => {
    try {
      handler(JSON.parse(event.data) as T);
    } catch {
      // Ignore malformed frames.
    }
  };

  const connect = () => {
    if (closed) return;
    const es = new EventSourceImpl(buildUrl());
    source = es;

    es.addEventListener("sessions", parse<LiveSessionsPayload>(callbacks.onSessions));
    es.addEventListener("tokens", parse<LiveTokensPayload>(callbacks.onTokens));
    es.addEventListener("diagnostics", parse<LiveDiagnosticsPayload>(callbacks.onDiagnostics));
    es.addEventListener("error", parse<LiveErrorPayload>(callbacks.onError));
    es.addEventListener(
      "ready",
      parse<LiveReadyPayload>((payload) => {
        consecutiveFailures = 0; // a clean baseline resets the retry budget
        if (payload.nextByteOffset !== null) currentFromByte = payload.nextByteOffset;
        if (payload.logCursorId !== null) currentLogCursorId = payload.logCursorId;
        callbacks.onReady(payload);
      }),
    );
    es.addEventListener(
      "timeline",
      parse<LiveTimelinePayload>((payload) => {
        currentFromByte = payload.nextByteOffset;
        callbacks.onTimeline(payload);
      }),
    );

    es.onerror = () => {
      es.close();
      source = null;
      consecutiveFailures += 1;
      if (closed || consecutiveFailures > maxRetries) return; // give up → stay on fetch
      reconnectTimer = setTimeout(connect, reconnectDelayMs);
    };
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      source = null;
    },
  };
};
```

> **Implementer note:** `EventSource` may not be a declared eslint browser global. If `npm run lint` flags it, add `EventSource: "readonly"` and `MessageEvent: "readonly"` to `browserGlobals` in `eslint.config.js`. jsdom does not define `EventSource`, which is why the test injects `EventSourceImpl`; production uses the real browser global.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/liveStream.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/frontend/api/liveStream.ts tests/unit/liveStream.test.ts
git commit -m "feat(live): add EventSource client wrapper with cursor resync"
```

---

## Task 8: Wire the live stream into `App.tsx`

**Responsibility:** After initial fetch, open the live stream for the active session and route deltas into the existing state setters. Reopen on active-session change. Gate on `VITE_AGENTVIEW_LIVE`.

**Files:**
- Modify: `src/frontend/App.tsx`
- Test: `tests/unit/app-live.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
import "@testing-library/jest-dom/vitest";

import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the live stream module so we can drive callbacks directly.
const liveCallbacks: { current: any } = { current: null };
vi.mock("../../src/frontend/api/liveStream", () => ({
  openLiveStream: (options: any) => {
    liveCallbacks.current = options.callbacks;
    return { close: vi.fn() };
  },
}));

import { App } from "../../src/frontend/App";

afterEach(() => {
  liveCallbacks.current = null;
});

describe("App live updates", () => {
  it("applies a sessions snapshot pushed over the live stream", async () => {
    render(<App />);
    // Wait for the stream to be opened (effect after mount).
    await vi.waitFor(() => expect(liveCallbacks.current).not.toBeNull());

    act(() => {
      liveCallbacks.current.onSessions({
        sessions: [
          {
            id: "live-thread",
            title: "Live pushed session",
            status: "complete",
            updatedAt: "2026-05-27T10:00:00.000Z",
            branch: "",
            cwd: "/repo",
            model: "",
            lastMessage: "",
            childCount: 0,
            openChildCount: 0,
            tokenTotal: 0,
          },
        ],
      });
    });

    expect(await screen.findByText("Live pushed session")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/app-live.test.tsx`
Expected: FAIL — App does not call `openLiveStream`, so `liveCallbacks.current` stays null.

- [ ] **Step 3: Wire `App.tsx`**

Add the import near the other imports:

```ts
import { openLiveStream } from "./api/liveStream";
```

Add this effect after the existing token-series effect (around `App.tsx:237`):

```ts
  const liveEnabled = (import.meta.env.VITE_AGENTVIEW_LIVE ?? "1") !== "0";

  useEffect(() => {
    if (!liveEnabled) return undefined;

    const handle = openLiveStream({
      threadId: activeSession?.id ?? null,
      fromByte:
        timelinePayload && timelinePayload.threadId === activeSession?.id
          ? timelinePayload.nextByteOffset
          : null,
      logCursorId: null,
      callbacks: {
        onSessions: ({ sessions: nextSessions }) => {
          setSessions(nextSessions);
          setActiveSessionId((current) => nextSessions.find((s) => s.id === current)?.id ?? current);
        },
        onTimeline: (payload) => {
          if (payload.threadId !== activeSession?.id) return;
          setTimelinePayload((current) =>
            payload.reset || !current
              ? { ...current, ...payload, facts: current?.facts ?? payload as never } as never
              : { ...current, nextByteOffset: payload.nextByteOffset, events: [...current.events, ...payload.events] },
          );
        },
        onTokens: (payload) => {
          if (payload.threadId === activeSession?.id) setTokenSeries(payload.series);
        },
        onDiagnostics: ({ summary }) => {
          setSessionDiagnostics(
            Object.fromEntries(summary.sessionsWarningBadges.map((badge) => [badge.threadId, badge])),
          );
        },
        onReady: () => undefined,
        onError: () => undefined,
      },
    });

    return () => handle.close();
    // Reopen when the followed session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.id, liveEnabled]);
```

> **Implementer note on the `onTimeline` reset branch:** the live `timeline` payload has no `facts`. On `reset`/first-apply, preserve the existing `facts` if present; otherwise the next Timeline-view fetch repopulates `facts`. Keep the append branch identical to the existing tail merge at `App.tsx:157`. If the `as never` casts are awkward under strict TS, prefer guarding: only apply timeline deltas when `current` exists (i.e. Timeline view has been loaded), since `facts` is required by `TimelinePayload`. Adjust the test if you choose the guard approach.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run tests/unit/app-live.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full app-shell test to confirm no regression**

Run: `npm test -- --run tests/unit/app-shell.test.tsx`
Expected: PASS (the mock is per-file; app-shell does not mock liveStream, so confirm `openLiveStream` tolerates jsdom's missing `EventSource`). If app-shell fails because real `openLiveStream` runs with no `EventSource`, wrap the `new EventSourceImpl(...)` call in `connect()` in a `try/catch` that no-ops when `EventSource` is undefined, OR mock the module in app-shell too. Prefer the try/catch guard so production stays resilient.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/App.tsx tests/unit/app-live.test.tsx
git commit -m "feat(live): route SSE deltas into App state setters"
```

---

## Task 9: Full verification + lint/typecheck cleanup

**Files:** none (verification + any lint global additions surfaced earlier).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS for both `tsconfig.json` and `tsconfig.node.json`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS. If `setInterval`/`clearInterval`/`EventSource`/`MessageEvent` are flagged as `no-undef`, add them to the appropriate globals map in `eslint.config.js` and re-run.

- [ ] **Step 3: Full test suite**

Run: `npm test -- --run`
Expected: PASS — all pre-existing 88 tests plus the new live tests, 0 failures.

- [ ] **Step 4: Commit any lint fixes**

```bash
git add eslint.config.js
git commit -m "chore(live): declare runtime globals for SSE timers and EventSource"
```

(Skip if no changes were needed.)

---

## Self-Review (spec coverage)

| Design requirement | Task |
|---|---|
| `watchManager` (fs.watch + debounce + 2s poll + ref-count + signal keys) | Task 3 |
| `liveHub` (registry, fan-out, per-connection isolation, backpressure: drop snapshots, never timeline) | Task 2 |
| `liveSources` (long-lived stores, tail delta, token recompute, diagnostics summary + new rows, per-connection cursors, baseline + `ready`, truncation reset, degrade-not-crash, lazy reopen) | Task 4 |
| `api/stream.ts` (SSE headers, CORS reuse, register with hub, watch via manager, named events, heartbeat ~20s, cleanup on close, slots into handler chain) | Task 6 + server.ts |
| Kill switch `AGENTVIEW_LIVE=0` | Task 6 |
| `frontend/api/liveStream.ts` (EventSource wrapper, named events → callbacks, reconnect + cursor resync, no `Last-Event-ID`) | Task 7 |
| `App.tsx` wiring (initial fetch unchanged; deltas via existing setters; reopen on thread switch) | Task 8 |
| SSE channels: sessions/timeline/tokens/diagnostics/ready/heartbeat/error | Tasks 2,4,6 (heartbeat = comment; others named events) |
| Cursor model: per-connection, seeded at subscribe, query-param resync | Tasks 4,6,7 |
| Switching active session = close+reopen EventSource; ref-count drops old rollout watch | Tasks 7 (close/reopen) + 3 (ref-count) + 8 (effect dep) |
| Testing: watchManager/liveHub unit; liveSources fixtures; integration http+SSE; client mock EventSource; React delta merge | Tasks 2,3,4,6,7,8 |

**Non-goals respected:** no WebSockets, no multi-user scaling, no new Playwright e2e, no change to how Codex writes data.

**Known simplifications (acceptable per design / YAGNI):**
- Diagnostics live updates feed `sessionDiagnostics` badges (the data `App` actually consumes today); the Diagnostics view's log list still renders fixtures, matching current fetch-mode behavior. Out of scope to re-wire here.
- Token recompute uses `getRolloutFactsWithCache` (bounded, cached) rather than an incremental token parse — same primitive the `/api/tokens` route uses.
