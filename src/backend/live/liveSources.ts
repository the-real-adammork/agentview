import { open, stat } from "node:fs/promises";

import type { LiveChannel, PageOptions, RuntimeLog, SessionFilter, SourceId } from "../../shared/contracts";
import { getRolloutFactsWithCache } from "../cache/rolloutCache";
import { deriveTokenSeries } from "../api/tokens";
import { parseRolloutFile } from "../rollout/jsonlStream";
import { createCodexSource } from "../sources/codex/CodexSource";
import { createSourceRegistry, type SourceRegistry } from "../sources/registry";
import type { LiveTailSource, ResolvedSession } from "../sources/SessionSource";
import { openLogStore, type LogStore } from "../sqlite/logStore";
import { openStateStore, type StateStore } from "../sqlite/stateStore";
import type { LiveConnection, LiveHub } from "./liveHub";
import type { WatchManager } from "./watchManager";

export interface LiveSubscribeRequest {
  connection: LiveConnection;
  threadId: string | null;
  filter: SessionFilter;
  page: PageOptions;
  /**
   * Which tool's session is being streamed. Defaults to "codex" when omitted
   * (back-compat with any caller that doesn't send it). The live path dispatches
   * the timeline tail through `registry.get(source)`.
   */
  source?: SourceId;
  /** Client's current rollout byte offset (null → baseline to current EOF). */
  fromByte: number | null;
  /** Client's newest seen log id (null → baseline to newest now). */
  logCursorId: number | null;
}

export interface LiveSourcesOptions {
  /**
   * The cross-source registry the timeline tail dispatches through. When omitted,
   * a Codex-only registry is built from `codexHome` (the legacy construction), so
   * the timeline path stays byte-identical for Codex while becoming source-generic.
   */
  registry?: SourceRegistry;
  /**
   * Codex home for the Codex-backed `sessions`/`diagnostics`/`tokens` snapshots
   * (the Codex state + logs SQLite DBs). Only the `timeline` channel is
   * source-generic this phase; these snapshots remain Codex-sourced and are
   * skipped entirely when `codexHome` is absent (a pure-CC runtime).
   */
  codexHome?: string;
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

// Count complete source lines before a byte offset so the live tail can continue
// the transcript's line numbering. Without this the tail restarts sourceLine at 1,
// and the timeline's (timestamp, sourceLine) sort then misplaces same-second
// streamed events ahead of already-loaded ones instead of at the top. Shared by
// every source (the per-source `tailLive` advances by the lines it consumes).
const countLinesBefore = async (path: string, byteOffset: number): Promise<number> => {
  if (byteOffset <= 0) return 0;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(byteOffset);
    const { bytesRead } = await handle.read(buffer, 0, byteOffset, 0);
    let lines = 0;
    for (let i = 0; i < bytesRead; i += 1) {
      if (buffer[i] === 0x0a) lines += 1;
    }
    return lines;
  } finally {
    await handle.close();
  }
};

const hasLiveTail = (value: unknown): value is LiveTailSource =>
  typeof (value as LiveTailSource | undefined)?.tailLive === "function";

export const createLiveSources = ({
  registry,
  codexHome,
  hub,
  watchManager,
  logFetchLimit = 100,
}: LiveSourcesOptions): LiveSources => {
  // The timeline tail dispatches through the registry. With no explicit registry,
  // fall back to a Codex-only registry built from `codexHome` (legacy path) so the
  // timeline tail still routes through `source.tailLive` with identical behavior.
  const sourceRegistry: SourceRegistry =
    registry ?? createSourceRegistry(codexHome ? [createCodexSource({ codexHome })] : []);

  // Long-lived read-only Codex stores for the sessions/diagnostics snapshots,
  // opened lazily and reused. Only used when `codexHome` is set.
  let stateStore: StateStore | null = null;
  let logStore: LogStore | null = null;

  const getStateStore = async () => {
    if (!codexHome) throw new Error("No codexHome configured for the Codex sessions feed.");
    if (!stateStore) stateStore = await openStateStore({ codexHome });
    return stateStore;
  };
  const getLogStore = async () => {
    if (!codexHome) throw new Error("No codexHome configured for the Codex diagnostics feed.");
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

  const degrade = (connection: LiveConnection, code: string, message: string, channel?: LiveChannel) => {
    hub.send(connection, "error", { code, message, channel });
  };

  return {
    async subscribe(request) {
      const { connection, threadId, filter, page } = request;
      // Dispatch discriminator (default "codex"). Routes the timeline tail.
      const source: SourceId = request.source ?? "codex";
      const unwatchFns: Array<() => void> = [];

      let resolved: ResolvedSession | null = null;
      let tailSource: LiveTailSource | null = null;
      let watchPath: string | null = null;
      let nextByteOffset = 0;
      // Source-line counter the live tail continues from, so streamed events keep
      // ascending line numbers (and thus sort to the top, not into the middle).
      let nextSourceLine = 1;
      let logCursorId = request.logCursorId ?? 0;

      // Resolve the active session's transcript + baseline its cursor, dispatching
      // by source through the registry (CC → CC transcript; Codex → rollout).
      if (threadId && sourceRegistry.has(source)) {
        try {
          const dispatched = sourceRegistry.get(source);
          if (hasLiveTail(dispatched)) {
            resolved = await dispatched.resolveSession(threadId);
            tailSource = dispatched;
            watchPath = resolved.rawLogPath;
            if (request.fromByte !== null) {
              nextByteOffset = request.fromByte;
            } else {
              const sourceStat = await stat(resolved.rawLogPath);
              nextByteOffset = sourceStat.size;
            }
            nextSourceLine = (await countLinesBefore(resolved.rawLogPath, nextByteOffset).catch(() => 0)) + 1;
          }
        } catch {
          // No resolvable transcript (unknown id / unreadable): no timeline feed.
          resolved = null;
          tailSource = null;
          watchPath = null;
        }
      }

      // Baseline the log cursor to the newest row when the client provided none.
      if (request.logCursorId === null && codexHome) {
        try {
          const store = await getLogStore();
          const logPage = await store.queryLogs({ threadId: threadId ?? undefined, limit: 1 });
          logCursorId = logPage.logs[0] ? logIdNumber(logPage.logs[0]) : 0;
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
        if (!resolved || !tailSource || !threadId) return;
        const activeResolved = resolved;
        const activeTail = tailSource;
        try {
          // On truncation the tail restarts at byte 0, so the line counter resets too.
          const startLine = nextSourceLine;
          const tail = await activeTail.tailLive(activeResolved, nextByteOffset, startLine);
          const reset = tail.truncated;
          if (tail.events.length > 0 || reset) {
            hub.send(connection, "timeline", {
              threadId,
              events: tail.events,
              nextByteOffset: tail.nextByte,
              reset,
              warnings: tail.warnings,
            });
          }
          nextByteOffset = tail.nextByte;
          nextSourceLine = tail.nextLine;

          // Tokens stay Codex-only this phase (CC has no Codex tokens DB; its cold
          // facts already carry token snapshots). Skipped for any non-Codex source.
          if (source === "codex" && codexHome) {
            const path = activeResolved.rawLogPath;
            const cached = await getRolloutFactsWithCache({
              codexHome,
              threadId,
              rolloutPath: path,
              parse: (sourceMtimeMs, sourceSizeBytes) =>
                parseRolloutFile(path, { threadId, rolloutPath: path, sourceMtimeMs, sourceSizeBytes }),
            });
            hub.send(connection, "tokens", { threadId, series: deriveTokenSeries(cached.facts) });
          }
        } catch {
          // DB-locked / transient: skip this push; the next signal or poll retries.
        }
      };

      const pushDiagnostics = async () => {
        try {
          const store = await getLogStore();
          const summary = await store.getDiagnosticsSummary({
            threadIds: threadId ? [threadId] : [],
            targetLimit: 5,
          });
          const logPage = await store.queryLogs({ threadId: threadId ?? undefined, limit: logFetchLimit });
          const fresh = logPage.logs.filter((log) => logIdNumber(log) > logCursorId);
          if (fresh.length > 0) logCursorId = Math.max(logCursorId, ...fresh.map(logIdNumber));
          hub.send(connection, "diagnostics", { summary, logs: fresh });
        } catch {
          await dropLogStore();
        }
      };

      // Watch the Codex DBs (sessions/diagnostics) only when a Codex home is set.
      // They run in WAL mode, so committed writes land in the `-wal` sibling and the
      // main file's mtime only changes on checkpoint — watch both so a push fires on
      // every commit, not just on checkpoint.
      if (codexHome) {
        unwatchFns.push(watchManager.watch("state-db", `${codexHome}/${STATE_DB_FILE}`, () => void pushSessions()));
        unwatchFns.push(watchManager.watch("state-db-wal", `${codexHome}/${STATE_DB_FILE}-wal`, () => void pushSessions()));
        unwatchFns.push(watchManager.watch("logs-db", `${codexHome}/${LOGS_DB_FILE}`, () => void pushDiagnostics()));
        unwatchFns.push(watchManager.watch("logs-db-wal", `${codexHome}/${LOGS_DB_FILE}-wal`, () => void pushDiagnostics()));
      }
      // Watch the active session's transcript (CC transcript or Codex rollout — both
      // plain JSONL the WatchManager already handles). The key stays `rollout:<id>`.
      if (watchPath && threadId) {
        unwatchFns.push(watchManager.watch(`rollout:${threadId}`, watchPath, () => void pushTimelineAndTokens()));
      }

      // Baseline established → ready.
      hub.send(connection, "ready", {
        threadId,
        nextByteOffset: resolved ? nextByteOffset : null,
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
