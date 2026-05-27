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
        const created: WatchEntry = {
          path,
          listeners: new Set(),
          watcher: null,
          debounceTimer: null,
          pollListener: (curr, prev) => {
            if (curr.mtimeMs !== prev.mtimeMs) fire(created);
          },
        };
        entry = created;
        entries.set(key, created);
        // fs.watch is a latency optimization; on failure we lean on the poll for correctness.
        try {
          created.watcher = watch(path, () => fire(created));
        } catch (error) {
          console.warn(`watchManager: fs.watch failed for ${path}, relying on poll`, error);
        }
        watchFile(path, { interval: pollIntervalMs }, created.pollListener);
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
