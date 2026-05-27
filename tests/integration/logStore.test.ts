import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeLog, RuntimeLogLevel } from "../../src/shared/contracts";
import {
  createDiagnosticsCodexHomeFixture,
  createUnsupportedLogsCodexHomeFixture,
  type DiagnosticsCodexHomeFixture,
} from "../fixtures/diagnostics";

interface LogQuery {
  level?: RuntimeLogLevel;
  target?: string;
  threadId?: string;
  scope?: string;
  limit?: number;
  cursor?: string;
}

interface LogQueryResult {
  logs: RuntimeLog[];
  nextCursor: string | null;
}

interface LogStoreHealth {
  ok: true;
  source: "logs-db";
  schema: {
    readOnly: true;
    supported: true;
    tables: string[];
  };
}

interface DiagnosticsSummary {
  warningCounts: {
    total: number;
    byThreadId: Record<string, number>;
    byLevel: Partial<Record<RuntimeLogLevel, number>>;
  };
  loudestTargets: Array<{
    target: string;
    totalCount: number;
    warningCount: number;
    errorCount: number;
  }>;
  failedCommands: Array<{
    threadId: string;
    toolName: string;
    command: string;
    exitCode: number;
    count: number;
    lastOutputPreview: string;
    source: "logs-db" | "rollout-cache";
  }>;
  sessionsWarningBadges: Array<{
    threadId: string;
    warningCountStatus: "ready" | "unavailable";
    warningCount: number;
    failedToolCountStatus: "ready" | "unavailable";
    failedToolCount: number;
  }>;
}

interface LogStore {
  getHealth(): Promise<LogStoreHealth>;
  queryLogs(query?: LogQuery): Promise<LogQueryResult>;
  getDiagnosticsSummary(options?: { threadIds?: string[]; targetLimit?: number }): Promise<DiagnosticsSummary>;
  close(): Promise<void>;
}

interface LogStoreModule {
  LogStoreError: new (code: string, message: string, missing?: string[]) => Error & { code: string; missing?: string[] };
  openLogStore(options: { codexHome: string }): Promise<LogStore>;
}

const logStoreSpecifier = ["..", "..", "src", "backend", "sqlite", "logStore"].join("/");
const loadLogStore = async () => (await import(/* @vite-ignore */ logStoreSpecifier)) as LogStoreModule;

const fixtures: DiagnosticsCodexHomeFixture[] = [];

const track = <T extends DiagnosticsCodexHomeFixture>(fixture: T) => {
  fixtures.push(fixture);
  return fixture;
};

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe("read-only diagnostics log store", () => {
  it("opens a temp logs_2.sqlite database read-only and reports supported schema health", async () => {
    const fixture = track(
      await createDiagnosticsCodexHomeFixture({
        logs: [
          {
            timestampMs: 1_000,
            level: "INFO",
            target: "codex_core::session",
            body: "session started",
            threadId: "thread-health",
            scope: "task-1",
          },
        ],
      }),
    );
    const { openLogStore } = await loadLogStore();
    const store = await openLogStore({ codexHome: fixture.codexHome });

    try {
      await expect(store.getHealth()).resolves.toMatchObject({
        ok: true,
        source: "logs-db",
        schema: {
          readOnly: true,
          supported: true,
          tables: expect.arrayContaining(["logs"]),
        },
      });
      await expect(store.queryLogs({ limit: 1 })).resolves.toMatchObject({
        logs: [
          expect.objectContaining({
            timestampMs: 1_000,
            level: "INFO",
            target: "codex_core::session",
            bodyPreview: "session started",
            threadId: "thread-health",
          }),
        ],
        nextCursor: null,
      });
    } finally {
      await store.close();
    }
  });

  it("rejects unsupported logs schemas with a typed SCHEMA_UNSUPPORTED error", async () => {
    const fixture = track(await createUnsupportedLogsCodexHomeFixture());
    const { LogStoreError, openLogStore } = await loadLogStore();

    await expect(openLogStore({ codexHome: fixture.codexHome })).rejects.toMatchObject({
      name: LogStoreError.name,
      code: "SCHEMA_UNSUPPORTED",
      missing: expect.arrayContaining(["logs.timestamp_ms", "logs.level", "logs.target", "logs.body"]),
    });
  });

  it("applies level, target, thread, and scope filters as exact parameterized predicates", async () => {
    const fixture = track(
      await createDiagnosticsCodexHomeFixture({
        logs: [
          {
            timestampMs: 2_000,
            level: "WARN",
            target: "codex_core::exec",
            body: "real warning",
            threadId: "thread-a",
            scope: "task-1",
          },
          {
            timestampMs: 2_100,
            level: "WARN",
            target: "codex_core::exec' OR 1=1 --",
            body: "literal injection-shaped target",
            threadId: "thread-a' OR 1=1 --",
            scope: "task-1' OR 1=1 --",
          },
          {
            timestampMs: 2_200,
            level: "ERROR",
            target: "codex_core::exec",
            body: "wrong level",
            threadId: "thread-a",
            scope: "task-1",
          },
        ],
      }),
    );
    const { openLogStore } = await loadLogStore();
    const store = await openLogStore({ codexHome: fixture.codexHome });

    try {
      await expect(
        store.queryLogs({
          level: "WARN",
          target: "codex_core::exec' OR 1=1 --",
          threadId: "thread-a' OR 1=1 --",
          scope: "task-1' OR 1=1 --",
        }),
      ).resolves.toMatchObject({
        logs: [
          expect.objectContaining({
            level: "WARN",
            target: "codex_core::exec' OR 1=1 --",
            bodyPreview: "literal injection-shaped target",
            threadId: "thread-a' OR 1=1 --",
            scope: "task-1' OR 1=1 --",
          }),
        ],
        nextCursor: null,
      });
    } finally {
      await store.close();
    }
  });

  it("returns deterministic cursor pages ordered by newest log first", async () => {
    const fixture = track(
      await createDiagnosticsCodexHomeFixture({
        logs: [
          { timestampMs: 3_000, level: "WARN", target: "codex_core::exec", body: "oldest", threadId: "thread-page" },
          { timestampMs: 3_100, level: "WARN", target: "codex_core::exec", body: "middle", threadId: "thread-page" },
          { timestampMs: 3_200, level: "WARN", target: "codex_core::exec", body: "newest", threadId: "thread-page" },
        ],
      }),
    );
    const { openLogStore } = await loadLogStore();
    const store = await openLogStore({ codexHome: fixture.codexHome });

    try {
      const firstPage = await store.queryLogs({ threadId: "thread-page", limit: 2 });
      expect(firstPage.logs.map((log) => log.bodyPreview)).toEqual(["newest", "middle"]);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const secondPage = await store.queryLogs({ threadId: "thread-page", limit: 2, cursor: firstPage.nextCursor ?? "" });
      expect(secondPage.logs.map((log) => log.bodyPreview)).toEqual(["oldest"]);
      expect(secondPage.nextCursor).toBeNull();
    } finally {
      await store.close();
    }
  });

  it("summarizes warning counts, loudest targets, failed commands, and session badge counts", async () => {
    const fixture = track(
      await createDiagnosticsCodexHomeFixture({
        logs: [
          {
            timestampMs: 4_000,
            level: "WARN",
            target: "codex_core::exec",
            body: "command stderr warning",
            threadId: "thread-summary",
            toolName: "shell",
            command: "npm test",
            exitCode: 1,
            outputPreview: "expected failing tests",
          },
          {
            timestampMs: 4_100,
            level: "ERROR",
            target: "codex_core::exec",
            body: "command failed",
            threadId: "thread-summary",
            toolName: "shell",
            command: "npm test",
            exitCode: 1,
            outputPreview: "expected failing tests",
          },
          {
            timestampMs: 4_200,
            level: "WARN",
            target: "agentview::diagnostics",
            body: "source missing",
            threadId: "thread-other",
          },
        ],
      }),
    );
    const { openLogStore } = await loadLogStore();
    const store = await openLogStore({ codexHome: fixture.codexHome });

    try {
      await expect(store.getDiagnosticsSummary({ threadIds: ["thread-summary", "thread-other"] })).resolves.toMatchObject({
        warningCounts: {
          total: 3,
          byThreadId: {
            "thread-summary": 2,
            "thread-other": 1,
          },
          byLevel: {
            WARN: 2,
            ERROR: 1,
          },
        },
        loudestTargets: [
          {
            target: "codex_core::exec",
            totalCount: 2,
            warningCount: 1,
            errorCount: 1,
          },
          {
            target: "agentview::diagnostics",
            totalCount: 1,
            warningCount: 1,
            errorCount: 0,
          },
        ],
        failedCommands: [
          {
            threadId: "thread-summary",
            toolName: "shell",
            command: "npm test",
            exitCode: 1,
            count: 1,
            lastOutputPreview: "expected failing tests",
            source: "logs-db",
          },
        ],
        sessionsWarningBadges: [
          {
            threadId: "thread-summary",
            warningCountStatus: "ready",
            warningCount: 2,
            failedToolCountStatus: "ready",
            failedToolCount: 1,
          },
          {
            threadId: "thread-other",
            warningCountStatus: "ready",
            warningCount: 1,
            failedToolCountStatus: "ready",
            failedToolCount: 0,
          },
        ],
      });
    } finally {
      await store.close();
    }
  });
});
