import { describe, expect, it } from "vitest";

import type { LiveConnection, LiveHub } from "../../src/backend/live/liveHub";
import { createLiveSources } from "../../src/backend/live/liveSources";
import type { WatchManager, WatchSignalKey } from "../../src/backend/live/watchManager";

const noopHub = (): LiveHub => ({
  add: () => undefined,
  remove: () => undefined,
  connections: () => [],
  connectionsForThread: () => [],
  send: () => undefined,
});

const recordingWatchManager = () => {
  const watched: Array<{ key: WatchSignalKey; path: string }> = [];
  const manager: WatchManager = {
    watch: (key, path) => {
      watched.push({ key, path });
      return () => undefined;
    },
    close: () => undefined,
  };
  return { manager, watched };
};

const connection = (): LiveConnection => ({
  id: "c1",
  threadId: null,
  write: () => true,
  close: () => undefined,
});

describe("createLiveSources subscribe", () => {
  it("watches the state/logs DB WAL files, not just the main files", async () => {
    // SQLite runs in WAL mode: writes land in the `-wal` sibling and the main
    // file's mtime only changes on checkpoint. Watching only the main file means
    // the sessions/diagnostics pushes (and live token counts) almost never fire.
    const codexHome = "/codex";
    const { manager, watched } = recordingWatchManager();
    const sources = createLiveSources({ codexHome, hub: noopHub(), watchManager: manager });

    // threadId null + logCursorId 0 → no DB access, just watch registration.
    await sources.subscribe({
      connection: connection(),
      threadId: null,
      filter: { archived: "include" },
      page: { limit: 500, offset: 0 },
      fromByte: null,
      logCursorId: 0,
    });

    const paths = watched.map((entry) => entry.path);
    expect(paths).toContain(`${codexHome}/state_5.sqlite`);
    expect(paths).toContain(`${codexHome}/state_5.sqlite-wal`);
    expect(paths).toContain(`${codexHome}/logs_2.sqlite`);
    expect(paths).toContain(`${codexHome}/logs_2.sqlite-wal`);
  });
});
