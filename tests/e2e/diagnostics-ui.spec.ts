import { appendFile, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { CachedRolloutFacts, CachedToolCall } from "../../src/shared/contracts";
import { writeObservedLogsDb, writeObservedRolloutFixtures } from "./observedSourceFixture";

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
    turns: [],
    agentLaunches: [],
    agentWaits: [],
    summary: {
      eventCount: 0,
      turnCount: 0,
      toolCallCount: toolCalls.length,
      failedToolCallCount: toolCalls.filter((call) => (call.exitCode ?? 0) !== 0).length,
      tokenSnapshotCount: 0,
      agentLaunchCount: 0,
      agentWaitCount: 0,
      warningCount: 0,
      parsedThroughByte: sourceStat.size,
    },
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
    await writeObservedLogsDb([
      {
        ts: 1_764_096_000,
        tsNanos: 100_000_000,
        level: "WARN",
        target: "codex_core::exec",
        threadId: "thread-subagent-implementation",
        body: "matching observed schema warning",
      },
      {
        ts: 1_764_096_000,
        tsNanos: 200_000_000,
        level: "ERROR",
        target: "codex_core::exec",
        threadId: "thread-subagent-implementation",
        body: "wrong level error",
      },
      {
        ts: 1_764_096_000,
        tsNanos: 300_000_000,
        level: "WARN",
        target: "agentview::tokens",
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
    await page.getByRole("button", { name: /apply filters/i }).click();

    const logsTable = page.getByRole("table", { name: /diagnostics logs/i });
    await expect(logsTable).toContainText("matching observed schema warning");
    await expect(logsTable).toContainText("codex_core::exec");
    await expect(logsTable).not.toContainText("wrong level error");
    await expect(logsTable).not.toContainText("wrong target warning");
    await expect.soft(logsTable).toContainText("thread-subagent-implementation");
    await expect.soft(logsTable).toContainText("observed");
  });

  test("renders failed-command summaries and uses loudest-target links to filter logs", async ({ page }, testInfo) => {
    await writeObservedRolloutFixtures();
    await writeObservedLogsDb([
      {
        ts: 1_764_096_100,
        tsNanos: 100_000_000,
        level: "ERROR",
        target: "codex_core::exec",
        threadId: "thread-subagent-implementation",
        body: "observed shell command failed without derived command columns",
      },
      {
        ts: 1_764_096_100,
        tsNanos: 200_000_000,
        level: "WARN",
        target: "agentview::diagnostics",
        threadId: "thread-parent-real",
        body: "diagnostics warning",
      },
    ]);

    await openDiagnostics(page, testInfo);

    const failedPanel = page.getByRole("region", { name: /failed commands/i });
    await expect(failedPanel).toContainText("npm run e2e -- observed-schema");
    await expect(failedPanel).toContainText("exit 2");
    await expect(failedPanel).toContainText("observed schema failed command summary");
    await expect(failedPanel).toContainText("rollout cache");

    await page.getByRole("link", { name: /codex_core::exec/i }).click();
    await expect(page.getByRole("textbox", { name: /target/i })).toHaveValue("codex_core::exec");
    await expect(page.getByRole("table", { name: /diagnostics logs/i })).toContainText(
      "observed shell command failed without derived command columns",
    );
    await expect.soft(page.getByRole("table", { name: /diagnostics logs/i })).toContainText(
      "thread-subagent-implementation",
    );
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
    await writeObservedRolloutFixtures();
    await writeObservedLogsDb([
      {
        ts: 1_764_096_200,
        tsNanos: 100_000_000,
        level: "WARN",
        target: "agentview::sessions",
        threadId: "thread-subagent-implementation",
        body: "observed badge warning one",
      },
      {
        ts: 1_764_096_200,
        tsNanos: 200_000_000,
        level: "ERROR",
        target: "agentview::sessions",
        threadId: "thread-subagent-implementation",
        body: "observed badge warning two",
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
    // Default flag is "Active": the archived fixture session is hidden, leaving the
    // user root + its active sub-agent.
    await expect(rows, "session rows should paint before diagnostics badge hydration resolves").toHaveCount(2, {
      timeout: 1_000,
    });
    await expect(rows.filter({ hasText: "ui-worker" })).not.toContainText(/warning|failed command/i);

    releaseSummary?.();

    const subagentRow = rows.filter({ hasText: "ui-worker" });
    await expect(subagentRow).toContainText("2 warnings");
    await expect(subagentRow).toContainText("1 failed command");
    await expect.soft(subagentRow).toContainText("observed schema");
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
