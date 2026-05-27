import { appendFile, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { CachedRolloutFacts, CachedToolCall, RuntimeLogLevel } from "../../src/shared/contracts";

interface DiagnosticLogSeed {
  timestampMs: number;
  level: RuntimeLogLevel;
  target: string;
  body: string;
  threadId?: string | null;
  scope?: string | null;
  toolName?: string | null;
  command?: string | null;
  exitCode?: number | null;
  outputPreview?: string | null;
}

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

function e2eCodexHome() {
  const codexHome = process.env.AGENTVIEW_E2E_CODEX_HOME;
  if (!codexHome) {
    throw new Error("Playwright config must provide AGENTVIEW_E2E_CODEX_HOME.");
  }
  return codexHome;
}

async function resetDiagnosticsSources() {
  const codexHome = e2eCodexHome();
  await rm(join(codexHome, "logs_2.sqlite"), { force: true });
  await rm(join(codexHome, "log", "codex-tui.log"), { force: true });
  await rm(join(codexHome, ".observatory", "cache", "v1", "rollouts"), { recursive: true, force: true });
}

async function writeLogsDb(logs: DiagnosticLogSeed[]) {
  const logsDbPath = join(e2eCodexHome(), "logs_2.sqlite");
  await rm(logsDbPath, { force: true });

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
      ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?, ?, ?
    )
  `);

  for (const log of logs) {
    insert.run(
      log.timestampMs,
      log.level,
      log.target,
      log.body,
      log.threadId ?? null,
      log.scope ?? null,
      log.toolName ?? null,
      log.command ?? null,
      log.exitCode ?? null,
      log.outputPreview ?? null,
    );
  }

  db.close();
}

async function writeRawTuiLog(text: string) {
  const logPath = join(e2eCodexHome(), "log", "codex-tui.log");
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(logPath, text, "utf8");
  return logPath;
}

async function writeWarmFailedCommandCache(threadId: string, toolCalls: CachedToolCall[]) {
  const codexHome = e2eCodexHome();
  const rolloutPath = await realpath(join(codexHome, "sessions", "subagent.jsonl"));
  const sourceStat = await stat(rolloutPath);
  const facts: CachedRolloutFacts = {
    threadId,
    rolloutPath,
    parserVersion: 1,
    sourceMtimeMs: sourceStat.mtimeMs,
    sourceSizeBytes: sourceStat.size,
    parsedThroughByte: sourceStat.size,
    events: [],
    toolCalls,
    tokenSnapshots: [],
    warnings: [],
  };
  const cachePath = join(codexHome, ".observatory", "cache", "v1", "rollouts", `${threadId}.json`);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(facts)}\n`, "utf8");
}

async function openDiagnostics(page: Page, testInfo: TestInfo) {
  await page.goto(appBaseUrl(testInfo));
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(page.getByRole("heading", { name: /diagnostics/i })).toBeVisible();
}

test.describe("Diagnostics UI @diagnostics", () => {
  test.beforeEach(async () => {
    await resetDiagnosticsSources();
  });

  test("filters structured diagnostics by level, target, and scope against local API logs", async ({ page }, testInfo) => {
    await writeLogsDb([
      {
        timestampMs: 10_000,
        level: "WARN",
        target: "codex_core::exec",
        scope: "phase-5-task-2",
        threadId: "thread-subagent-implementation",
        body: "matching task warning",
      },
      {
        timestampMs: 10_100,
        level: "ERROR",
        target: "codex_core::exec",
        scope: "phase-5-task-2",
        threadId: "thread-subagent-implementation",
        body: "wrong level error",
      },
      {
        timestampMs: 10_200,
        level: "WARN",
        target: "agentview::tokens",
        scope: "phase-5-task-4",
        threadId: "thread-parent-real",
        body: "wrong target warning",
      },
    ]);

    await openDiagnostics(page, testInfo);

    const levelFilter = page.getByRole("combobox", { name: /level/i });
    const targetFilter = page.getByRole("textbox", { name: /target/i });
    const scopeFilter = page.getByRole("textbox", { name: /scope/i });
    await expect(levelFilter).toBeVisible({ timeout: 1_000 });
    await expect(targetFilter).toBeVisible({ timeout: 1_000 });
    await expect(scopeFilter).toBeVisible({ timeout: 1_000 });

    await levelFilter.selectOption("WARN");
    await targetFilter.fill("codex_core::exec");
    await scopeFilter.fill("phase-5-task-2");
    await page.getByRole("button", { name: /apply filters/i }).click();

    const logsTable = page.getByRole("table", { name: /diagnostics logs/i });
    await expect(logsTable).toContainText("matching task warning");
    await expect(logsTable).toContainText("codex_core::exec");
    await expect(logsTable).toContainText("phase-5-task-2");
    await expect(logsTable).not.toContainText("wrong level error");
    await expect(logsTable).not.toContainText("wrong target warning");
  });

  test("renders failed-command summaries and uses loudest-target links to filter logs", async ({ page }, testInfo) => {
    await writeLogsDb([
      {
        timestampMs: 11_000,
        level: "ERROR",
        target: "codex_core::exec",
        scope: "phase-5-task-2",
        threadId: "thread-subagent-implementation",
        body: "shell command failed",
        toolName: "shell",
        command: "npm run e2e -- --grep @diagnostics",
        exitCode: 1,
        outputPreview: "Diagnostics panel has not been implemented",
      },
      {
        timestampMs: 11_100,
        level: "WARN",
        target: "agentview::diagnostics",
        scope: "phase-5-task-2",
        threadId: "thread-parent-real",
        body: "diagnostics warning",
      },
    ]);

    await openDiagnostics(page, testInfo);

    const failedPanel = page.getByRole("region", { name: /failed commands/i });
    await expect(failedPanel).toContainText("npm run e2e -- --grep @diagnostics");
    await expect(failedPanel).toContainText("exit 1");
    await expect(failedPanel).toContainText("Diagnostics panel has not been implemented");

    await page.getByRole("link", { name: /codex_core::exec/i }).click();
    await expect(page.getByRole("textbox", { name: /target/i })).toHaveValue("codex_core::exec");
    await expect(page.getByRole("table", { name: /diagnostics logs/i })).toContainText("shell command failed");
  });

  test("shows rollout-cache failed-command fallback when logs_2.sqlite is missing", async ({ page }, testInfo) => {
    await rm(join(e2eCodexHome(), "logs_2.sqlite"), { force: true });
    await writeWarmFailedCommandCache("thread-subagent-implementation", [
      {
        callId: "call-cache-failed",
        toolName: "shell",
        completedAt: "2026-05-27T06:28:19.000Z",
        argumentsPreview: "npm run test -- --run diagnostics",
        outputPreview: "cached failed command output",
        outputBytes: 28,
        exitCode: 2,
      },
    ]);

    await openDiagnostics(page, testInfo);

    await expect(page.getByRole("alert")).toContainText(/logs_2\.sqlite/i);
    const failedPanel = page.getByRole("region", { name: /failed commands/i });
    await expect(failedPanel).toContainText("rollout cache");
    await expect(failedPanel).toContainText("npm run test -- --run diagnostics");
    await expect(failedPanel).toContainText("cached failed command output");
  });

  test("hydrates Sessions warning badges after first paint without blocking rows", async ({ page }, testInfo) => {
    await writeLogsDb([
      {
        timestampMs: 12_000,
        level: "WARN",
        target: "agentview::sessions",
        threadId: "thread-subagent-implementation",
        scope: "sessions",
        body: "badge warning one",
      },
      {
        timestampMs: 12_100,
        level: "ERROR",
        target: "agentview::sessions",
        threadId: "thread-subagent-implementation",
        scope: "sessions",
        body: "badge warning two",
        toolName: "shell",
        command: "npm run e2e -- --grep @diagnostics",
        exitCode: 1,
        outputPreview: "sessions badge command failed",
      },
    ]);

    let releaseSummary: (() => void) | undefined;
    const summaryGate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    await page.route("**/api/diagnostics/summary**", async (route) => {
      await summaryGate;
      await route.continue();
    });

    await page.goto(appBaseUrl(testInfo));

    const rows = page.getByRole("table", { name: /sessions/i }).locator("tbody tr");
    await expect(rows, "session rows should paint before diagnostics badge hydration resolves").toHaveCount(3, {
      timeout: 1_000,
    });
    await expect(rows.filter({ hasText: "Subagent implementation lane" })).not.toContainText(/warning|failed command/i);

    releaseSummary?.();

    const subagentRow = rows.filter({ hasText: "Subagent implementation lane" });
    await expect(subagentRow).toContainText("2 warnings");
    await expect(subagentRow).toContainText("1 failed command");
  });

  test("keeps raw TUI tail hidden until advanced reveal, redacts previews, and appends from next offset", async ({
    page,
  }, testInfo) => {
    const rawLogPath = await writeRawTuiLog(
      [
        "2026-05-27T06:28:19.000Z WARN startup raw warning",
        "2026-05-27T06:28:20.000Z INFO Authorization: Bearer raw-secret-token",
      ].join("\n") + "\n",
    );

    await openDiagnostics(page, testInfo);

    await expect(page.getByText("startup raw warning")).toBeHidden();
    await expect(page.getByText("raw-secret-token")).toHaveCount(0);

    const showRawTail = page.getByRole("button", { name: /show advanced raw tui log/i });
    await expect(showRawTail).toBeVisible({ timeout: 1_000 });
    await showRawTail.click();

    const rawRegion = page.getByRole("region", { name: /raw tui log/i });
    await expect(rawRegion).toContainText("startup raw warning");
    await expect(rawRegion).toContainText("Authorization: Bearer [REDACTED]");
    await expect(rawRegion).not.toContainText("raw-secret-token");
    await expect(rawRegion).toContainText(/next offset/i);

    await appendFile(rawLogPath, "2026-05-27T06:28:21.000Z ERROR appended tail line\n", "utf8");
    await page.getByRole("button", { name: /load raw tail/i }).click();

    await expect(rawRegion).toContainText("appended tail line");
  });
});
