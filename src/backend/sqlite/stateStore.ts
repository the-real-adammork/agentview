import { access } from "node:fs/promises";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { PageOptions, SessionFilter, SessionSummary, ThreadSource } from "../../shared/contracts";

export class StateStoreError extends Error {
  code: string;
  missing?: string[];

  constructor(code: string, message: string, missing?: string[]) {
    super(message);
    this.name = "StateStoreError";
    this.code = code;
    this.missing = missing;
  }
}

export interface StateStoreHealth {
  ok: true;
  source: "state-db";
  schema: {
    readOnly: true;
    supported: true;
    tables: string[];
  };
}

export interface StateStore {
  getHealth(): Promise<StateStoreHealth>;
  listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]>;
  getThread(threadId: string): Promise<SessionSummary | null>;
  close(): Promise<void>;
}

interface ThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  cwd: string;
  title: string;
  tokens_used: number;
  archived: number;
  git_sha: string | null;
  git_branch: string | null;
  git_origin_url: string | null;
  first_user_message: string;
  agent_nickname: string | null;
  agent_role: string | null;
  model: string | null;
  reasoning_effort: string | null;
  created_at_ms: number | null;
  updated_at_ms: number | null;
  thread_source: ThreadSource | null;
  preview: string;
  child_count: number | bigint;
  open_child_count: number | bigint;
}

const requiredThreadColumns = [
  "id",
  "rollout_path",
  "created_at",
  "updated_at",
  "cwd",
  "title",
  "tokens_used",
  "archived",
  "git_sha",
  "git_branch",
  "git_origin_url",
  "first_user_message",
  "agent_nickname",
  "agent_role",
  "model",
  "reasoning_effort",
  "created_at_ms",
  "updated_at_ms",
  "thread_source",
  "preview",
];

const trimPreview = (value: string | null | undefined) => (value ?? "").trim();

const stripGitOrigin = (value: string | null) => {
  if (!value) {
    return null;
  }

  const withoutProtocol = value.replace(/^[a-z]+:\/\//i, "");
  return withoutProtocol.replace(/^[^/@]+@/, "");
};

const toNumber = (value: number | bigint | null | undefined) => Number(value ?? 0);

const normalizeThread = (row: ThreadRow): SessionSummary => {
  const createdAtMs = row.created_at_ms ?? row.created_at * 1000;
  const updatedAtMs = row.updated_at_ms ?? row.updated_at * 1000;
  const firstUserMessagePreview = trimPreview(row.first_user_message);
  const preview = trimPreview(row.preview);
  const titlePreview = trimPreview(row.title) || firstUserMessagePreview || preview || row.id;
  const tokenTotal = toNumber(row.tokens_used);
  const branch = row.git_branch ?? "";
  const model = row.model ?? null;

  return {
    id: row.id,
    title: titlePreview,
    status: "complete",
    updatedAt: new Date(updatedAtMs).toISOString(),
    branch,
    cwd: row.cwd,
    model: model ?? "",
    lastMessage: preview || firstUserMessagePreview,
    childCount: toNumber(row.child_count),
    openChildCount: toNumber(row.open_child_count),
    tokenTotal,
    rolloutPath: row.rollout_path,
    createdAtMs,
    updatedAtMs,
    repoLabel: basename(row.cwd),
    titlePreview,
    firstUserMessagePreview,
    preview,
    reasoningEffort: row.reasoning_effort,
    tokensUsed: tokenTotal,
    threadSource: row.thread_source,
    agentNickname: row.agent_nickname,
    agentRole: row.agent_role,
    gitSha: row.git_sha,
    gitBranch: row.git_branch,
    gitOriginUrlPreview: stripGitOrigin(row.git_origin_url),
    archived: row.archived === 1,
    warningCountStatus: "not_requested",
    warningCount: null,
    failedToolCountStatus: "unknown",
    failedToolCount: null,
  };
};

const collectTables = (db: DatabaseSync) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String((row as { name: unknown }).name));

const collectColumns = (db: DatabaseSync, table: string) =>
  new Set(
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  );

const validateSchema = (db: DatabaseSync) => {
  const tables = collectTables(db);
  const missing: string[] = [];

  if (!tables.includes("threads")) {
    missing.push("threads");
  }

  if (!tables.includes("thread_spawn_edges")) {
    missing.push("thread_spawn_edges");
  }

  if (tables.includes("threads")) {
    const columns = collectColumns(db, "threads");
    for (const column of requiredThreadColumns) {
      if (!columns.has(column)) {
        missing.push(`threads.${column}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new StateStoreError(
      "SCHEMA_UNSUPPORTED",
      `Unsupported state_5.sqlite schema: missing ${missing.join(", ")}`,
      missing,
    );
  }

  return tables;
};

const selectThreadSql = `
  SELECT
    t.id,
    t.rollout_path,
    t.created_at,
    t.updated_at,
    t.cwd,
    t.title,
    t.tokens_used,
    t.archived,
    t.git_sha,
    t.git_branch,
    t.git_origin_url,
    t.first_user_message,
    t.agent_nickname,
    t.agent_role,
    t.model,
    t.reasoning_effort,
    t.created_at_ms,
    t.updated_at_ms,
    t.thread_source,
    t.preview,
    COALESCE(edge_counts.child_count, 0) AS child_count,
    COALESCE(edge_counts.open_child_count, 0) AS open_child_count
  FROM threads t
  LEFT JOIN (
    SELECT
      parent_thread_id,
      COUNT(*) AS child_count,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_child_count
    FROM thread_spawn_edges
    GROUP BY parent_thread_id
  ) edge_counts ON edge_counts.parent_thread_id = t.id
`;

export const openStateStore = async ({ codexHome }: { codexHome: string }): Promise<StateStore> => {
  const stateDbPath = join(codexHome, "state_5.sqlite");

  try {
    await access(stateDbPath);
  } catch (error) {
    throw new StateStoreError(
      "STATE_DB_MISSING",
      `Unable to access state_5.sqlite at ${stateDbPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const db = new DatabaseSync(stateDbPath, { readOnly: true });
  let tables: string[];

  try {
    tables = validateSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }

  const store: StateStore = {
    async getHealth() {
      return {
        ok: true,
        source: "state-db",
        schema: {
          readOnly: true,
          supported: true,
          tables,
        },
      };
    },
    async listSessions(filter = {}, page = {}) {
      const archived = filter.archived ?? "exclude";
      const limit = page.limit ?? 100;
      const offset = page.offset ?? 0;
      const conditions: string[] = [];
      const parameters: Record<string, string | number> = {
        limit,
        offset,
      };

      if (archived === "exclude") {
        conditions.push("t.archived = 0");
      } else if (archived === "only") {
        conditions.push("t.archived = 1");
      }

      if (filter.cwd) {
        conditions.push("t.cwd = :cwd");
        parameters.cwd = filter.cwd;
      }

      if (filter.threadSource) {
        conditions.push("t.thread_source = :threadSource");
        parameters.threadSource = filter.threadSource;
      }

      if (filter.agentRole) {
        conditions.push("t.agent_role = :agentRole");
        parameters.agentRole = filter.agentRole;
      }

      if (filter.model) {
        conditions.push("t.model = :model");
        parameters.model = filter.model;
      }

      if (filter.minTokens !== undefined) {
        conditions.push("t.tokens_used >= :minTokens");
        parameters.minTokens = filter.minTokens;
      }

      if (filter.maxTokens !== undefined) {
        conditions.push("t.tokens_used <= :maxTokens");
        parameters.maxTokens = filter.maxTokens;
      }

      if (filter.warningCountStatus && filter.warningCountStatus !== "not_requested") {
        conditions.push("1 = 0");
      }

      if (filter.failedToolCountStatus && filter.failedToolCountStatus !== "unknown") {
        conditions.push("1 = 0");
      }

      if (filter.updatedAfterMs !== undefined) {
        conditions.push("COALESCE(t.updated_at_ms, t.updated_at * 1000) >= :updatedAfterMs");
        parameters.updatedAfterMs = filter.updatedAfterMs;
      }

      if (filter.updatedBeforeMs !== undefined) {
        conditions.push("COALESCE(t.updated_at_ms, t.updated_at * 1000) <= :updatedBeforeMs");
        parameters.updatedBeforeMs = filter.updatedBeforeMs;
      }

      if (filter.createdAfterMs !== undefined) {
        conditions.push("COALESCE(t.created_at_ms, t.created_at * 1000) >= :createdAfterMs");
        parameters.createdAfterMs = filter.createdAfterMs;
      }

      if (filter.createdBeforeMs !== undefined) {
        conditions.push("COALESCE(t.created_at_ms, t.created_at * 1000) <= :createdBeforeMs");
        parameters.createdBeforeMs = filter.createdBeforeMs;
      }

      if (filter.search?.trim()) {
        conditions.push(
          "(t.title LIKE :search OR t.first_user_message LIKE :search OR t.preview LIKE :search OR t.id LIKE :search)",
        );
        parameters.search = `%${filter.search.trim()}%`;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = db
        .prepare(`
          ${selectThreadSql}
          ${where}
          ORDER BY COALESCE(t.updated_at_ms, t.updated_at * 1000) DESC, t.id DESC
          LIMIT :limit OFFSET :offset
        `)
        .all(parameters) as unknown as ThreadRow[];

      return rows.map(normalizeThread);
    },
    async getThread(threadId) {
      const row = db
        .prepare(`
          ${selectThreadSql}
          WHERE t.id = :threadId
        `)
        .get({ threadId }) as unknown as ThreadRow | undefined;

      return row ? normalizeThread(row) : null;
    },
    async close() {
      db.close();
    },
  };

  return store;
};
