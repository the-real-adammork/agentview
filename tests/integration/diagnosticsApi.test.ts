import { afterEach, describe, expect, it } from "vitest";

import { stopRunningApis, withApi, requestJson } from "../helpers/apiServer";
import {
  createCodexHomeWithoutLogsFixture,
  createDiagnosticsCodexHomeFixture,
  createObservedDiagnosticsCodexHomeFixture,
  createUnsupportedLogsCodexHomeFixture,
  writeRolloutFixture,
  writeWarmRolloutCacheFixture,
} from "../fixtures/diagnostics";

afterEach(async () => {
  await stopRunningApis();
});

describe("diagnostics API routes", () => {
  it("serves filtered log rows from logs_2.sqlite with cursor pagination", async () => {
    const fixture = await createDiagnosticsCodexHomeFixture({
      logs: [
        {
          timestampMs: 5_000,
          level: "WARN",
          target: "codex_core::exec",
          body: "old warning",
          threadId: "thread-api",
          scope: "task-1",
        },
        {
          timestampMs: 5_100,
          level: "WARN",
          target: "codex_core::exec",
          body: "middle warning",
          threadId: "thread-api",
          scope: "task-1",
        },
        {
          timestampMs: 5_200,
          level: "WARN",
          target: "codex_core::exec",
          body: "new warning",
          threadId: "thread-api",
          scope: "task-1",
        },
        {
          timestampMs: 5_300,
          level: "ERROR",
          target: "codex_core::exec",
          body: "wrong level",
          threadId: "thread-api",
          scope: "task-1",
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const firstPage = await requestJson(
        baseUrl,
        "/api/logs?level=WARN&target=codex_core%3A%3Aexec&threadId=thread-api&scope=task-1&limit=2",
      );

      expect(firstPage.status).toBe(200);
      expect(firstPage.body).toMatchObject({
        ok: true,
        source: "logs-db",
        warnings: [],
        data: {
          logs: [
            expect.objectContaining({ level: "WARN", bodyPreview: "new warning", threadId: "thread-api" }),
            expect.objectContaining({ level: "WARN", bodyPreview: "middle warning", threadId: "thread-api" }),
          ],
          nextCursor: expect.any(String),
        },
      });

      const cursor = (firstPage.body as { data: { nextCursor: string } }).data.nextCursor;
      const secondPage = await requestJson(
        baseUrl,
        `/api/logs?level=WARN&target=codex_core%3A%3Aexec&threadId=thread-api&scope=task-1&limit=2&cursor=${encodeURIComponent(cursor)}`,
      );

      expect(secondPage.status).toBe(200);
      expect(secondPage.body).toMatchObject({
        ok: true,
        source: "logs-db",
        data: {
          logs: [expect.objectContaining({ bodyPreview: "old warning" })],
          nextCursor: null,
        },
      });
    });
  });

  it("serves observed-schema log rows with redacted previews and nanosecond cursor pagination", async () => {
    const fixture = await createObservedDiagnosticsCodexHomeFixture({
      logs: [
        {
          timestampMs: 11_000,
          timestampNanos: 100,
          level: "WARN",
          target: "codex_core::exec",
          body: "old observed warning",
          threadId: "thread-observed-api",
          modulePath: "codex_core::exec",
          file: "exec.rs",
          line: 101,
          processUuid: "process-observed-api",
          estimatedBytes: 20,
        },
        {
          timestampMs: 11_000,
          timestampNanos: 200,
          level: "WARN",
          target: "codex_core::exec",
          body: "OPENAI_API_KEY=sk-proj-observed-api newest warning",
          threadId: "thread-observed-api",
          modulePath: "codex_core::exec",
          file: "exec.rs",
          line: 102,
          processUuid: "process-observed-api",
          estimatedBytes: 51,
        },
        {
          timestampMs: 11_000,
          timestampNanos: 300,
          level: "ERROR",
          target: "codex_core::exec",
          body: "wrong level observed",
          threadId: "thread-observed-api",
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const firstPage = await requestJson(
        baseUrl,
        "/api/logs?level=WARN&target=codex_core%3A%3Aexec&threadId=thread-observed-api&limit=1",
      );

      expect(firstPage.status).toBe(200);
      expect(firstPage.body).toMatchObject({
        ok: true,
        source: "logs-db",
        warnings: [],
        data: {
          logs: [
            expect.objectContaining({
              timestampMs: 11_000,
              level: "WARN",
              bodyPreview: "OPENAI_API_KEY=[REDACTED] newest warning",
              threadId: "thread-observed-api",
              modulePath: "codex_core::exec",
              file: "exec.rs",
              line: 102,
              processUuid: "process-observed-api",
              estimatedBytes: 51,
              redactionApplied: true,
            }),
          ],
          nextCursor: expect.any(String),
        },
      });

      const cursor = (firstPage.body as { data: { nextCursor: string } }).data.nextCursor;
      const secondPage = await requestJson(
        baseUrl,
        `/api/logs?level=WARN&target=codex_core%3A%3Aexec&threadId=thread-observed-api&limit=1&cursor=${encodeURIComponent(cursor)}`,
      );

      expect(secondPage.status).toBe(200);
      expect(secondPage.body).toMatchObject({
        ok: true,
        source: "logs-db",
        data: {
          logs: [expect.objectContaining({ bodyPreview: "old observed warning" })],
          nextCursor: null,
        },
      });
    });
  });

  it("returns typed unsupported-schema errors for malformed logs_2.sqlite files", async () => {
    const fixture = await createUnsupportedLogsCodexHomeFixture();

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/logs?limit=1");

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        ok: false,
        source: "logs-db",
        error: {
          code: "SCHEMA_UNSUPPORTED",
          detail: expect.stringContaining("logs.timestamp_ms"),
        },
      });
    });
  });

  it("returns warning counts, loudest targets, failed commands, and warning badge summaries", async () => {
    const fixture = await createDiagnosticsCodexHomeFixture({
      logs: [
        {
          timestampMs: 6_000,
          level: "WARN",
          target: "codex_core::exec",
          body: "shell warning",
          threadId: "thread-summary-api",
          toolName: "shell",
          command: "npm run test -- --run diagnostics",
          exitCode: 1,
          outputPreview: "diagnostics implementation missing",
        },
        {
          timestampMs: 6_100,
          level: "ERROR",
          target: "codex_core::exec",
          body: "shell failed",
          threadId: "thread-summary-api",
          toolName: "shell",
          command: "npm run test -- --run diagnostics",
          exitCode: 1,
          outputPreview: "diagnostics implementation missing",
        },
        {
          timestampMs: 6_200,
          level: "WARN",
          target: "agentview::diagnostics",
          body: "summary warning",
          threadId: "thread-summary-api",
        },
        {
          timestampMs: 6_300,
          level: "WARN",
          target: "agentview::sessions",
          body: "badge warning",
          threadId: "thread-badge-api",
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(
        baseUrl,
        "/api/diagnostics/summary?threadId=thread-summary-api&threadId=thread-badge-api&targetLimit=2",
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        source: "logs-db",
        warnings: [],
        data: {
          warningCounts: {
            total: 4,
            byThreadId: {
              "thread-summary-api": 3,
              "thread-badge-api": 1,
            },
            byLevel: {
              WARN: 3,
              ERROR: 1,
            },
          },
          loudestTargets: [
            expect.objectContaining({
              target: "codex_core::exec",
              totalCount: 2,
              warningCount: 1,
              errorCount: 1,
            }),
            expect.objectContaining({
              target: "agentview::diagnostics",
              totalCount: 1,
              warningCount: 1,
              errorCount: 0,
            }),
          ],
          failedCommands: [
            expect.objectContaining({
              threadId: "thread-summary-api",
              toolName: "shell",
              command: "npm run test -- --run diagnostics",
              exitCode: 1,
              count: 1,
              lastOutputPreview: "diagnostics implementation missing",
              source: "logs-db",
            }),
          ],
          sessionsWarningBadges: [
            expect.objectContaining({
              threadId: "thread-summary-api",
              warningCountStatus: "ready",
              warningCount: 3,
              failedToolCountStatus: "ready",
              failedToolCount: 1,
            }),
            expect.objectContaining({
              threadId: "thread-badge-api",
              warningCountStatus: "ready",
              warningCount: 1,
              failedToolCountStatus: "ready",
              failedToolCount: 0,
            }),
          ],
        },
      });
    });
  });

  it("combines observed-schema warning summaries with rollout-cache failed-command facts", async () => {
    const fixture = await createObservedDiagnosticsCodexHomeFixture({
      threads: [
        {
          id: "thread-observed-cache-api",
          rolloutPath: "sessions/2026/observed-cache-fallback.jsonl",
          createdAtMs: 12_000,
          updatedAtMs: 12_500,
          cwd: "/repo/agentview",
          title: "Observed cache fallback",
        },
      ],
      logs: [
        {
          timestampMs: 12_000,
          level: "WARN",
          target: "codex_core::exec",
          body: "runtime warning from observed logs",
          threadId: "thread-observed-cache-api",
        },
        {
          timestampMs: 12_100,
          level: "ERROR",
          target: "agentview::diagnostics",
          body: "runtime error from observed logs",
          threadId: "thread-observed-cache-api",
        },
      ],
    });
    const rolloutPath = await writeRolloutFixture(fixture.codexHome, "sessions/2026/observed-cache-fallback.jsonl", [
      {
        timestamp: "2026-05-27T12:00:00.000Z",
        type: "tool_result",
        toolName: "shell",
        callId: "call-observed-failed",
        exitCode: 2,
        output: "observed schema cached failure",
      },
    ]);
    await writeWarmRolloutCacheFixture({
      codexHome: fixture.codexHome,
      threadId: "thread-observed-cache-api",
      rolloutPath,
      toolCalls: [
        {
          callId: "call-observed-failed",
          toolName: "shell",
          completedAt: "2026-05-27T12:00:00.000Z",
          argumentsPreview: "npm run test -- --run diagnostics",
          outputPreview: "observed schema cached failure",
          outputBytes: 30,
          exitCode: 2,
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/diagnostics/summary?threadId=thread-observed-cache-api&targetLimit=2");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        source: "logs-db",
        warnings: [],
        data: {
          warningCounts: {
            total: 2,
            byThreadId: {
              "thread-observed-cache-api": 2,
            },
            byLevel: {
              WARN: 1,
              ERROR: 1,
            },
          },
          loudestTargets: [
            expect.objectContaining({
              target: "agentview::diagnostics",
              totalCount: 1,
              warningCount: 0,
              errorCount: 1,
            }),
            expect.objectContaining({
              target: "codex_core::exec",
              totalCount: 1,
              warningCount: 1,
              errorCount: 0,
            }),
          ],
          failedCommands: [
            expect.objectContaining({
              threadId: "thread-observed-cache-api",
              toolName: "shell",
              command: "npm run test -- --run diagnostics",
              exitCode: 2,
              count: 1,
              lastOutputPreview: "observed schema cached failure",
              source: "rollout-cache",
            }),
          ],
          sessionsWarningBadges: [
            expect.objectContaining({
              threadId: "thread-observed-cache-api",
              warningCountStatus: "ready",
              warningCount: 2,
              failedToolCountStatus: "ready",
              failedToolCount: 1,
            }),
          ],
        },
      });
    });
  });

  it("falls back to cached rollout failed-tool facts when logs_2.sqlite is unavailable", async () => {
    const fixture = await createCodexHomeWithoutLogsFixture({
      threads: [
        {
          id: "thread-cache-fallback",
          rolloutPath: "sessions/2026/cache-fallback.jsonl",
          createdAtMs: 7_000,
          updatedAtMs: 7_500,
          cwd: "/repo/agentview",
          title: "Cache fallback",
        },
      ],
    });
    const rolloutPath = await writeRolloutFixture(fixture.codexHome, "sessions/2026/cache-fallback.jsonl", [
      {
        timestamp: "2026-05-27T06:08:21.000Z",
        type: "tool_result",
        toolName: "shell",
        callId: "call-failed",
        exitCode: 2,
        output: "cached failed command output",
      },
    ]);
    await writeWarmRolloutCacheFixture({
      codexHome: fixture.codexHome,
      threadId: "thread-cache-fallback",
      rolloutPath,
      toolCalls: [
        {
          callId: "call-failed",
          toolName: "shell",
          completedAt: "2026-05-27T06:08:21.000Z",
          argumentsPreview: "npm run test",
          outputPreview: "cached failed command output",
          outputBytes: 28,
          exitCode: 2,
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/diagnostics/summary?threadId=thread-cache-fallback");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        source: "rollout-cache",
        warnings: [expect.stringContaining("logs_2.sqlite")],
        data: {
          warningCounts: {
            total: 0,
          },
          failedCommands: [
            expect.objectContaining({
              threadId: "thread-cache-fallback",
              toolName: "shell",
              exitCode: 2,
              count: 1,
              lastOutputPreview: "cached failed command output",
              source: "rollout-cache",
            }),
          ],
          sessionsWarningBadges: [
            expect.objectContaining({
              threadId: "thread-cache-fallback",
              warningCountStatus: "unavailable",
              failedToolCountStatus: "ready",
              failedToolCount: 1,
            }),
          ],
        },
      });
    });
  });
});
