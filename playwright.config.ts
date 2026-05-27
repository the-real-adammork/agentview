import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const appPort = Number.parseInt(process.env.AGENTVIEW_APP_PORT ?? "4173", 10);
const apiPort = Number.parseInt(process.env.AGENTVIEW_API_PORT ?? "4317", 10);

const appBaseUrl = `http://127.0.0.1:${appPort}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

process.env.AGENTVIEW_API_BASE_URL = apiBaseUrl;

const createE2eCodexHome = () => {
  const codexHome = mkdtempSync(join(tmpdir(), "agentview-e2e-codex-home-"));
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

    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT NOT NULL,
      child_thread_id TEXT NOT NULL PRIMARY KEY,
      status TEXT NOT NULL
    );
  `);

  const insertThread = db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
      git_sha, git_branch, git_origin_url, cli_version, first_user_message, agent_nickname,
      agent_role, memory_mode, model, reasoning_effort, agent_path, created_at_ms,
      updated_at_ms, thread_source, preview
    ) VALUES (?, ?, ?, ?, 'state', 'openai', ?, ?, 'workspace-write', 'never', ?, 1, ?, NULL,
      NULL, ?, NULL, 'codex-test', ?, ?, ?, 'enabled', ?, 'high', NULL, ?, ?, ?, ?)
  `);

  insertThread.run(
    "thread-parent-real",
    "sessions/parent.jsonl",
    1000,
    1000,
    "/repo/agentview",
    "Parent real sessions work",
    52_000,
    0,
    "impl/phase-2",
    "Parent prompt",
    null,
    null,
    "gpt-5-codex",
    1_000_000,
    1_000_000,
    "user",
    "Parent preview",
  );
  insertThread.run(
    "thread-subagent-implementation",
    "sessions/subagent.jsonl",
    1100,
    1100,
    "/repo/agentview",
    "Subagent implementation lane",
    25_000,
    0,
    "impl/phase-2",
    "Implementation prompt",
    "ui-worker",
    "implementation",
    "gpt-5-codex",
    1_100_000,
    1_100_000,
    "subagent",
    "Implementation preview",
  );
  insertThread.run(
    "thread-archived-ui",
    "sessions/archived.jsonl",
    1200,
    1200,
    "/repo/agentview",
    "UI fixture archived",
    5_000,
    1,
    "impl/phase-2",
    "Archived prompt",
    null,
    null,
    "gpt-5-codex-mini",
    1_200_000,
    1_200_000,
    "user",
    "Archived preview",
  );

  const insertEdge = db.prepare("INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status) VALUES (?, ?, ?)");
  insertEdge.run("thread-subagent-implementation", "child-open", "open");
  insertEdge.run("thread-subagent-implementation", "child-closed", "closed");
  db.close();

  return codexHome;
};

const codexHome = process.env.CODEX_HOME ?? createE2eCodexHome();
const quotedCodexHome = JSON.stringify(codexHome);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: appBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `CODEX_HOME=${quotedCodexHome} AGENTVIEW_API_PORT=${apiPort} npm run api`,
      url: `${apiBaseUrl}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `VITE_AGENTVIEW_API_BASE_URL=${apiBaseUrl} npm run dev -- --port ${appPort} --strictPort`,
      url: appBaseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
