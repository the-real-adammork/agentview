import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "@playwright/test";

const sessionCount = 500;
const thresholdMs = Number.parseInt(process.env.AGENTVIEW_SESSIONS_FIRST_PAINT_THRESHOLD_MS ?? "3500", 10);

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate a free port.")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

const waitForHttp = async (url, timeoutMs = 30_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status >= 200 && response.status < 600) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
};

const createCodexHome = () => {
  const codexHome = mkdtempSync(join(tmpdir(), "agentview-perf-codex-home-"));
  const db = new DatabaseSync(join(codexHome, "state_5.sqlite"));

  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      model_provider TEXT NOT NULL,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL,
      sandbox_policy TEXT NOT NULL,
      approval_mode TEXT NOT NULL,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      has_user_event INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      archived_at INTEGER,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT,
      cli_version TEXT NOT NULL DEFAULT '',
      first_user_message TEXT NOT NULL DEFAULT '',
      agent_nickname TEXT,
      agent_role TEXT,
      memory_mode TEXT NOT NULL DEFAULT 'enabled',
      model TEXT,
      reasoning_effort TEXT,
      agent_path TEXT,
      created_at_ms INTEGER,
      updated_at_ms INTEGER,
      thread_source TEXT,
      preview TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX idx_threads_updated_at_ms ON threads(updated_at_ms DESC, id DESC);

    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT NOT NULL,
      child_thread_id TEXT NOT NULL PRIMARY KEY,
      status TEXT NOT NULL
    );
  `);

  const insert = db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
      git_sha, git_branch, git_origin_url, cli_version, first_user_message, agent_nickname,
      agent_role, memory_mode, model, reasoning_effort, agent_path, created_at_ms,
      updated_at_ms, thread_source, preview
    ) VALUES (?, ?, ?, ?, 'state', 'openai', ?, ?, 'workspace-write', 'never', ?, 1, 0, NULL,
      NULL, 'impl/perf', NULL, 'codex-perf', ?, NULL, NULL, 'enabled', 'gpt-5-codex', 'high', NULL, ?, ?, 'user', ?)
  `);

  for (let index = 0; index < sessionCount; index += 1) {
    const updatedAtMs = 1_800_000 + index;
    insert.run(
      `perf-thread-${String(index).padStart(3, "0")}`,
      `sessions/perf-${index}.jsonl`,
      Math.floor(updatedAtMs / 1000),
      Math.floor(updatedAtMs / 1000),
      "/repo/agentview",
      `Perf session ${index}`,
      10_000 + index,
      `Open perf session ${index}`,
      updatedAtMs,
      updatedAtMs,
      `Preview ${index}`,
    );
  }

  db.close();
  return codexHome;
};

const startProcess = (command, args, env) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${command}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${command}] ${chunk}`));
  return child;
};

const stopProcess = async (child) => {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

const codexHome = createCodexHome();
const apiPort = await getFreePort();
const appPort = await getFreePort();
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const appBaseUrl = `http://127.0.0.1:${appPort}`;
const api = startProcess("npm", ["run", "api"], {
  CODEX_HOME: codexHome,
  AGENTVIEW_API_PORT: String(apiPort),
});
const web = startProcess("npm", ["run", "dev", "--", "--port", String(appPort), "--strictPort"], {
  VITE_AGENTVIEW_API_BASE_URL: apiBaseUrl,
});

let browser;

try {
  await waitForHttp(`${apiBaseUrl}/api/health`);
  await waitForHttp(appBaseUrl);

  browser = await chromium.launch();
  const page = await browser.newPage();
  const startedAt = performance.now();
  await page.goto(appBaseUrl);
  await page.getByRole("table", { name: /sessions/i }).locator("tbody tr").first().waitFor();
  try {
    await page.waitForFunction(
      (expected) => document.querySelectorAll('table[aria-label="Sessions"] tbody tr').length === expected,
      sessionCount,
    );
  } catch (error) {
    const observedRows = await page.locator('table[aria-label="Sessions"] tbody tr').count();
    const statusText = await page.locator('[role="status"]').innerText().catch(() => "status unavailable");
    throw new Error(
      `Timed out waiting for ${sessionCount} rows; observed ${observedRows}. Status: ${statusText}. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const elapsedMs = Math.round(performance.now() - startedAt);
  const firstTitle = await page.locator('table[aria-label="Sessions"] tbody tr').first().innerText();

  console.log(
    JSON.stringify(
      {
        result: elapsedMs <= thresholdMs ? "pass" : "fail",
        elapsedMs,
        thresholdMs,
        renderedRows: sessionCount,
        firstRowIncludesNewestSession: firstTitle.includes("Perf session 499"),
        codexHome,
      },
      null,
      2,
    ),
  );

  if (elapsedMs > thresholdMs) {
    throw new Error(`Sessions first paint took ${elapsedMs}ms, above ${thresholdMs}ms threshold.`);
  }

  if (!firstTitle.includes("Perf session 499")) {
    throw new Error("Sessions first paint did not render rows sorted by updated_at_ms desc.");
  }
} finally {
  await browser?.close();
  await Promise.all([stopProcess(api), stopProcess(web)]);
  rmSync(codexHome, { recursive: true, force: true });
}
