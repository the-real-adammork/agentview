import { open, stat } from "node:fs/promises";

import type { LiveChannel, PageOptions, RuntimeLog, SessionFilter } from "../../shared/contracts";
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

// Count complete source lines before a byte offset so the live tail can continue
// the rollout's line numbering. Without this the tail restarts sourceLine at 1,
// and the timeline's (timestamp, sourceLine) sort then misplaces same-second
// streamed events ahead of already-loaded ones instead of at the top.
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

  const degrade = (connection: LiveConnection, code: string, message: string, channel?: LiveChannel) => {
    hub.send(connection, "error", { code, message, channel });
  };

  return {
    async subscribe(request) {
      const { connection, threadId, filter, page } = request;
      const unwatchFns: Array<() => void> = [];

      let rolloutPath: string | null = null;
      let nextByteOffset = 0;
      // Source-line counter the live tail continues from, so streamed events keep
      // ascending line numbers (and thus sort to the top, not into the middle).
      let nextSourceLine = 1;
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
            nextSourceLine = (await countLinesBefore(rolloutPath, nextByteOffset).catch(() => 0)) + 1;
          }
        } catch {
          await dropStateStore();
        }
      }

      // Baseline the log cursor to the newest row when the client provided none.
      if (request.logCursorId === null) {
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
        if (!rolloutPath || !threadId) return;
        const path = rolloutPath;
        try {
          // On truncation the tail restarts at byte 0, so the line counter resets too.
          const startLine = nextSourceLine;
          const tail = await tailRolloutFile({ path, threadId, fromByte: nextByteOffset, sourceLine: startLine });
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
          nextSourceLine = reset ? 1 + tail.linesRead : startLine + tail.linesRead;

          const cached = await getRolloutFactsWithCache({
            codexHome,
            threadId,
            rolloutPath: path,
            parse: (sourceMtimeMs, sourceSizeBytes) =>
              parseRolloutFile(path, { threadId, rolloutPath: path, sourceMtimeMs, sourceSizeBytes }),
          });
          hub.send(connection, "tokens", { threadId, series: deriveTokenSeries(cached.facts) });
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

      // Always watch the two DBs; watch the active rollout if present. The DBs run
      // in WAL mode, so committed writes land in the `-wal` sibling and the main
      // file's mtime only changes on checkpoint (minutes apart). Watch both so a
      // push fires on every commit, not just on checkpoint.
      unwatchFns.push(watchManager.watch("state-db", `${codexHome}/${STATE_DB_FILE}`, () => void pushSessions()));
      unwatchFns.push(watchManager.watch("state-db-wal", `${codexHome}/${STATE_DB_FILE}-wal`, () => void pushSessions()));
      unwatchFns.push(watchManager.watch("logs-db", `${codexHome}/${LOGS_DB_FILE}`, () => void pushDiagnostics()));
      unwatchFns.push(watchManager.watch("logs-db-wal", `${codexHome}/${LOGS_DB_FILE}-wal`, () => void pushDiagnostics()));
      if (rolloutPath && threadId) {
        unwatchFns.push(watchManager.watch(`rollout:${threadId}`, rolloutPath, () => void pushTimelineAndTokens()));
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
