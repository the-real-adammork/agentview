import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { tailRawTuiLog } from "../../src/backend/diagnostics/rawTuiLog";
import { openLogStore } from "../../src/backend/sqlite/logStore";

const tempRoots: string[] = [];

const createRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentview-full-dashboard-perf-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("full dashboard performance guards", () => {
  it("keeps diagnostics paging bounded for large log fixtures", async () => {
    const codexHome = await createRoot();
    const logsDbPath = join(codexHome, "logs_2.sqlite");
    const db = new DatabaseSync(logsDbPath);

    db.exec(`
      CREATE TABLE logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp_ms INTEGER NOT NULL,
        level TEXT NOT NULL,
        target TEXT NOT NULL,
        body TEXT NOT NULL,
        module_path TEXT,
        file TEXT,
        line INTEGER,
        thread_id TEXT,
        scope TEXT,
        process_uuid TEXT,
        tool_name TEXT,
        command TEXT,
        exit_code INTEGER,
        output_preview TEXT
      );
      CREATE INDEX idx_logs_timestamp ON logs(timestamp_ms DESC, id DESC);
      CREATE INDEX idx_logs_filters ON logs(level, target, thread_id, scope);
    `);

    const insert = db.prepare(`
      INSERT INTO logs (timestamp_ms, level, target, body, thread_id, scope)
      VALUES (?, 'WARN', 'agentview::diagnostics', ?, 'thread-perf', 'perf')
    `);
    for (let index = 0; index < 2_000; index += 1) {
      insert.run(index, `diagnostics row ${index}`);
    }
    db.close();

    const store = await openLogStore({ codexHome });
    try {
      const startedAt = performance.now();
      const page = await store.queryLogs({ limit: 100, target: "agentview::diagnostics" });
      const elapsedMs = performance.now() - startedAt;

      expect(page.logs).toHaveLength(100);
      expect(page.nextCursor).toEqual(expect.any(String));
      expect(elapsedMs).toBeLessThan(250);
    } finally {
      await store.close();
    }
  });

  it("caps raw TUI tail reads for large local log files", async () => {
    const codexHome = await createRoot();
    const rawPath = join(codexHome, "log", "codex-tui.log");
    await mkdir(dirname(rawPath), { recursive: true });
    await writeFile(rawPath, `${"raw line\n".repeat(20_000)}OPENAI_API_KEY=sk-secret\n`, "utf8");

    const tail = await tailRawTuiLog({ codexHome, fromByte: 0, maxBytes: 1024 });

    expect(tail.textPreview.length).toBeLessThanOrEqual(1024);
    expect(tail.nextByteOffset).toBe(1024);
    expect(tail.truncated).toBe(true);
  });
});
