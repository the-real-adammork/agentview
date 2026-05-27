import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CachedRolloutFacts, CachedToolCall, RuntimeLogLevel, TimelineEvent } from "../../src/shared/contracts";
import { createCodexHomeFixture, type CodexHomeFixture, type CodexThreadFixture } from "./codexHome";

export interface DiagnosticLogFixture {
  timestampMs: number;
  level: RuntimeLogLevel;
  target: string;
  body: string;
  threadId?: string | null;
  scope?: string | null;
  modulePath?: string | null;
  file?: string | null;
  line?: number | null;
  processUuid?: string | null;
  toolName?: string | null;
  command?: string | null;
  exitCode?: number | null;
  outputPreview?: string | null;
}

export interface DiagnosticsCodexHomeFixture extends CodexHomeFixture {
  logsDbPath: string;
}

export const createDiagnosticsCodexHomeFixture = async ({
  threads = [],
  logs = [],
}: {
  threads?: CodexThreadFixture[];
  logs?: DiagnosticLogFixture[];
} = {}): Promise<DiagnosticsCodexHomeFixture> => {
  const fixture = await createCodexHomeFixture({ threads });
  const logsDbPath = join(fixture.codexHome, "logs_2.sqlite");
  await writeLogsDb(logsDbPath, logs);

  return {
    ...fixture,
    logsDbPath,
  };
};

export const createUnsupportedLogsCodexHomeFixture = async (): Promise<DiagnosticsCodexHomeFixture> => {
  const codexHome = await mkdtemp(join(tmpdir(), "agentview-logs-unsupported-"));
  const logsDbPath = join(codexHome, "logs_2.sqlite");
  const db = new DatabaseSync(logsDbPath);

  db.exec(`
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY,
      message TEXT NOT NULL
    );
  `);
  db.close();

  return {
    codexHome,
    stateDbPath: join(codexHome, "state_5.sqlite"),
    logsDbPath,
    cleanup: () => rm(codexHome, { recursive: true, force: true }),
  };
};

export const createCodexHomeWithoutLogsFixture = async ({
  threads = [],
}: {
  threads?: CodexThreadFixture[];
} = {}): Promise<CodexHomeFixture> => createCodexHomeFixture({ threads });

export const writeRolloutFixture = async (
  codexHome: string,
  rolloutPath: string,
  lines: Array<Record<string, unknown>>,
) => {
  const absolutePath = join(codexHome, rolloutPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return absolutePath;
};

export const writeWarmRolloutCacheFixture = async ({
  codexHome,
  threadId,
  rolloutPath,
  toolCalls,
  warnings = [],
}: {
  codexHome: string;
  threadId: string;
  rolloutPath: string;
  toolCalls: CachedToolCall[];
  warnings?: string[];
}) => {
  const sourceStat = await stat(rolloutPath);
  const events: TimelineEvent[] = [];
  const facts: CachedRolloutFacts = {
    threadId,
    rolloutPath,
    parserVersion: 1,
    sourceMtimeMs: sourceStat.mtimeMs,
    sourceSizeBytes: sourceStat.size,
    parsedThroughByte: sourceStat.size,
    events,
    toolCalls,
    tokenSnapshots: [],
    warnings,
  };

  const cachePath = join(codexHome, ".observatory", "cache", "v1", "rollouts", `${safeCacheSegment(threadId)}.json`);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(facts)}\n`, "utf8");
  return { cachePath, facts };
};

const writeLogsDb = async (logsDbPath: string, logs: DiagnosticLogFixture[]) => {
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
    INSERT INTO logs (
      timestamp_ms, level, target, body, module_path, file, line, thread_id, scope,
      process_uuid, tool_name, command, exit_code, output_preview
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  for (const log of logs) {
    insert.run(
      log.timestampMs,
      log.level,
      log.target,
      log.body,
      log.modulePath ?? null,
      log.file ?? null,
      log.line ?? null,
      log.threadId ?? null,
      log.scope ?? null,
      log.processUuid ?? null,
      log.toolName ?? null,
      log.command ?? null,
      log.exitCode ?? null,
      log.outputPreview ?? null,
    );
  }

  db.close();
};

const safeCacheSegment = (value: string) => value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 180);
