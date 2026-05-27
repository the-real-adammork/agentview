import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type ThreadSource = "user" | "subagent";

export interface CodexThreadFixture {
  id: string;
  rolloutPath?: string;
  createdAtMs: number;
  updatedAtMs: number;
  source?: string;
  modelProvider?: string;
  cwd: string;
  title?: string;
  sandboxPolicy?: string;
  approvalMode?: string;
  tokensUsed?: number;
  hasUserEvent?: boolean;
  archived?: boolean;
  archivedAt?: number | null;
  gitSha?: string | null;
  gitBranch?: string | null;
  gitOriginUrl?: string | null;
  cliVersion?: string;
  firstUserMessage?: string;
  agentNickname?: string | null;
  agentRole?: string | null;
  memoryMode?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  agentPath?: string | null;
  threadSource?: ThreadSource | null;
  preview?: string;
}

export interface ThreadSpawnEdgeFixture {
  parentThreadId: string;
  childThreadId: string;
  status: "open" | "closed" | "failed";
}

export interface CodexHomeFixture {
  codexHome: string;
  stateDbPath: string;
  cleanup(): Promise<void>;
}

export interface CreateCodexHomeFixtureOptions {
  threads?: CodexThreadFixture[];
  edges?: ThreadSpawnEdgeFixture[];
}

const defaultThread = (thread: CodexThreadFixture) => ({
  rolloutPath: `sessions/${thread.id}.jsonl`,
  source: "state",
  modelProvider: "openai",
  title: "",
  sandboxPolicy: "workspace-write",
  approvalMode: "never",
  tokensUsed: 0,
  hasUserEvent: true,
  archived: false,
  archivedAt: null,
  gitSha: null,
  gitBranch: null,
  gitOriginUrl: null,
  cliVersion: "codex-test",
  firstUserMessage: "",
  agentNickname: null,
  agentRole: null,
  memoryMode: "enabled",
  model: null,
  reasoningEffort: null,
  agentPath: null,
  threadSource: "user" as ThreadSource,
  preview: "",
  ...thread,
});

export const createCodexHomeFixture = async ({
  threads = [],
  edges = [],
}: CreateCodexHomeFixtureOptions = {}): Promise<CodexHomeFixture> => {
  const codexHome = await mkdtemp(join(tmpdir(), "agentview-codex-home-"));
  const stateDbPath = join(codexHome, "state_5.sqlite");
  const db = new DatabaseSync(stateDbPath);

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

    CREATE INDEX idx_thread_spawn_edges_parent_status
      ON thread_spawn_edges(parent_thread_id, status);
  `);

  const insertThread = db.prepare(`
    INSERT INTO threads (
      id, rollout_path, created_at, updated_at, source, model_provider, cwd, title,
      sandbox_policy, approval_mode, tokens_used, has_user_event, archived, archived_at,
      git_sha, git_branch, git_origin_url, cli_version, first_user_message, agent_nickname,
      agent_role, memory_mode, model, reasoning_effort, agent_path, created_at_ms,
      updated_at_ms, thread_source, preview
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  for (const rawThread of threads) {
    const thread = defaultThread(rawThread);

    insertThread.run(
      thread.id,
      thread.rolloutPath,
      Math.floor(thread.createdAtMs / 1000),
      Math.floor(thread.updatedAtMs / 1000),
      thread.source,
      thread.modelProvider,
      thread.cwd,
      thread.title,
      thread.sandboxPolicy,
      thread.approvalMode,
      thread.tokensUsed,
      thread.hasUserEvent ? 1 : 0,
      thread.archived ? 1 : 0,
      thread.archivedAt,
      thread.gitSha,
      thread.gitBranch,
      thread.gitOriginUrl,
      thread.cliVersion,
      thread.firstUserMessage,
      thread.agentNickname,
      thread.agentRole,
      thread.memoryMode,
      thread.model,
      thread.reasoningEffort,
      thread.agentPath,
      thread.createdAtMs,
      thread.updatedAtMs,
      thread.threadSource,
      thread.preview,
    );
  }

  const insertEdge = db.prepare(`
    INSERT INTO thread_spawn_edges (parent_thread_id, child_thread_id, status)
    VALUES (?, ?, ?)
  `);

  for (const edge of edges) {
    insertEdge.run(edge.parentThreadId, edge.childThreadId, edge.status);
  }

  db.close();

  return {
    codexHome,
    stateDbPath,
    cleanup: () => rm(codexHome, { recursive: true, force: true }),
  };
};

export const createUnsupportedCodexHomeFixture = async (): Promise<CodexHomeFixture> => {
  const codexHome = await mkdtemp(join(tmpdir(), "agentview-codex-home-unsupported-"));
  const stateDbPath = join(codexHome, "state_5.sqlite");
  const db = new DatabaseSync(stateDbPath);

  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL
    );
  `);
  db.close();

  return {
    codexHome,
    stateDbPath,
    cleanup: () => rm(codexHome, { recursive: true, force: true }),
  };
};
