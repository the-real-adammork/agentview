import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWatchManager } from "../../src/backend/live/watchManager";

type PollListener = (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void;

describe("watchManager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const makeDeps = () => {
    const fsWatchers: Array<{ key: string; close: ReturnType<typeof vi.fn> }> = [];
    const watchListeners = new Map<string, () => void>();
    const polled = new Map<string, PollListener>();
    return {
      fsWatchers,
      watchListeners,
      polled,
      deps: {
        watch: (path: string, listener: () => void) => {
          watchListeners.set(path, listener);
          const watcher = { key: path, close: vi.fn() };
          fsWatchers.push(watcher);
          return { close: watcher.close };
        },
        watchFile: (path: string, _options: { interval: number }, listener: PollListener) => {
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
    const polled = new Map<string, PollListener>();
    const manager = createWatchManager({
      debounceMs: 75,
      pollIntervalMs: 2000,
      watch: () => {
        throw new Error("ENOSPC watchers exhausted");
      },
      watchFile: (path: string, _options: { interval: number }, listener: PollListener) => {
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
