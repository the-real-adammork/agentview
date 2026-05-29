import { access } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AgentEdgeStatus,
  PageOptions,
  SessionFilter,
  SessionSummary,
  ThreadSource,
} from "../../shared/contracts";
import { deriveRepoName } from "../../shared/repoName";
import { deriveSessionTitle } from "./threadTitle";
import { reconstructEdges, type ReconstructThread, type ReconstructedLink } from "../relationships/reconstruct";

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
  getAgentGraphRows(rootThreadId: string, scanDepth: number): Promise<AgentGraphRow[]>;
  close(): Promise<void>;
}

export interface AgentGraphRow {
  id: string | null;
  title: string | null;
  firstUserMessage: string | null;
  preview: string | null;
  tokensUsed: number | null;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
  agentNickname: string | null;
  agentRole: string | null;
  parentThreadId: string | null;
  childThreadId: string | null;
  edgeStatus: AgentEdgeStatus | null;
  edgeOrder?: number | bigint | null;
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
  parent_thread_id: string | null;
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

const normalizeThread = (row: ThreadRow, overlay?: Map<string, ReconstructedLink>): SessionSummary => {
  const createdAtMs = row.created_at_ms ?? row.created_at * 1000;
  const updatedAtMs = row.updated_at_ms ?? row.updated_at * 1000;
  const firstUserMessagePreview = trimPreview(row.first_user_message);
  const preview = trimPreview(row.preview);
  const titlePreview = deriveSessionTitle({
    id: row.id,
    title: row.title,
    firstUserMessage: row.first_user_message,
    preview: row.preview,
    threadSource: row.thread_source,
    agentRole: row.agent_role,
    agentNickname: row.agent_nickname,
  });
  const tokenTotal = toNumber(row.tokens_used);
  const branch = row.git_branch ?? "";
  const model = row.model ?? null;
  const realParentId = row.parent_thread_id ?? null;
  const reconstructed = !realParentId ? overlay?.get(row.id) : undefined;

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
    parentId: realParentId ?? reconstructed?.parentId ?? null,
    parentEdgeSource: realParentId ? "codex" : reconstructed ? "reconstructed" : undefined,
    parentEdgeConfidence: reconstructed?.confidence,
    parentEdgeVia: reconstructed?.via,
    tokenTotal,
    rolloutPath: row.rollout_path,
    createdAtMs,
    updatedAtMs,
    repoLabel: deriveRepoName(row.git_origin_url, row.cwd),
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
    gitOriginUrl: row.git_origin_url,
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
    COALESCE(edge_counts.open_child_count, 0) AS open_child_count,
    parent_edge.parent_thread_id AS parent_thread_id
  FROM threads t
  LEFT JOIN (
    SELECT
      parent_thread_id,
      COUNT(*) AS child_count,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_child_count
    FROM thread_spawn_edges
    GROUP BY parent_thread_id
  ) edge_counts ON edge_counts.parent_thread_id = t.id
  LEFT JOIN thread_spawn_edges parent_edge ON parent_edge.child_thread_id = t.id
`;

const selectReconstructInputSql = `
  SELECT
    t.id AS id,
    t.first_user_message AS firstUserMessage,
    t.preview AS preview,
    t.cwd AS cwd,
    COALESCE(t.created_at_ms, t.created_at * 1000) AS createdAtMs,
    COALESCE(t.updated_at_ms, t.updated_at * 1000) AS updatedAtMs,
    t.thread_source AS threadSource,
    CASE WHEN parent_edge.child_thread_id IS NULL THEN 0 ELSE 1 END AS hasRealParent
  FROM threads t
  LEFT JOIN thread_spawn_edges parent_edge ON parent_edge.child_thread_id = t.id
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

  // Cached for the store's lifetime; safe because the DB is opened readOnly. If the
  // store ever gains write access, invalidate this on write. Building it is a second
  // scan over `threads` (cheap at hundreds–thousands of rows); revisit if that grows.
  let overlayCache: Map<string, ReconstructedLink> | null = null;
  const getOverlay = (): Map<string, ReconstructedLink> => {
    if (overlayCache) {
      return overlayCache;
    }
    const rows = db.prepare(selectReconstructInputSql).all() as unknown as Array<{
      id: string;
      firstUserMessage: string | null;
      preview: string | null;
      cwd: string;
      createdAtMs: number | bigint | null;
      updatedAtMs: number | bigint | null;
      threadSource: ThreadSource | null;
      hasRealParent: number | bigint;
    }>;
    const threads: ReconstructThread[] = rows.map((row) => ({
      id: row.id,
      firstUserMessage: row.firstUserMessage,
      preview: row.preview,
      cwd: row.cwd,
      createdAtMs: Number(row.createdAtMs ?? 0),
      updatedAtMs: Number(row.updatedAtMs ?? 0),
      threadSource: row.threadSource,
      hasRealParent: Number(row.hasRealParent) === 1,
    }));
    overlayCache = reconstructEdges(threads);
    return overlayCache;
  };

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
      const parameters: Record<string, string | number> = {};

      if (archived === "exclude") {
        conditions.push("t.archived = 0");
      } else if (archived === "only") {
        conditions.push("t.archived = 1");
      }

      if (filter.cwd?.trim()) {
        conditions.push("t.cwd = :cwd");
        parameters.cwd = filter.cwd.trim();
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
      const orderBy = "ORDER BY COALESCE(t.updated_at_ms, t.updated_at * 1000) DESC, t.id DESC";
      const repoFilter = filter.repo?.trim();

      if (repoFilter) {
        // Repo identity is derived in JS (git origin URL -> repo name, with a cwd
        // basename fallback), so it can't be expressed in SQL. Narrow by every other
        // condition in SQL, then filter + paginate in memory so the filter always
        // agrees with the repoLabel shown in the UI.
        const rows = db
          .prepare(`${selectThreadSql} ${where} ${orderBy}`)
          .all(parameters) as unknown as ThreadRow[];

        return rows
          .map((row) => normalizeThread(row, getOverlay()))
          .filter((session) => session.repoLabel === repoFilter)
          .slice(offset, offset + limit);
      }

      const rows = db
        .prepare(`${selectThreadSql} ${where} ${orderBy} LIMIT :limit OFFSET :offset`)
        .all({ ...parameters, limit, offset }) as unknown as ThreadRow[];

      return rows.map((row) => normalizeThread(row, getOverlay()));
    },
    async getThread(threadId) {
      const row = db
        .prepare(`
          ${selectThreadSql}
          WHERE t.id = :threadId
        `)
        .get({ threadId }) as unknown as ThreadRow | undefined;

      return row ? normalizeThread(row, getOverlay()) : null;
    },
    async getAgentGraphRows(rootThreadId, scanDepth) {
      return db
        .prepare(`
          WITH RECURSIVE graph_edges(parent_thread_id, child_thread_id, status, depth, path, edge_order) AS (
            SELECT
              parent_thread_id,
              child_thread_id,
              status,
              1 AS depth,
              '|' || parent_thread_id || '|' || child_thread_id || '|' AS path,
              rowid AS edge_order
            FROM thread_spawn_edges
            WHERE parent_thread_id = :rootThreadId

            UNION ALL

            SELECT
              edge.parent_thread_id,
              edge.child_thread_id,
              edge.status,
              graph_edges.depth + 1 AS depth,
              graph_edges.path || edge.child_thread_id || '|' AS path,
              edge.rowid AS edge_order
            FROM thread_spawn_edges edge
            INNER JOIN graph_edges ON graph_edges.child_thread_id = edge.parent_thread_id
            WHERE graph_edges.depth < :scanDepth
              AND instr(graph_edges.path, '|' || edge.child_thread_id || '|') = 0
          )
          SELECT
            root.id AS id,
            root.title AS title,
            root.first_user_message AS firstUserMessage,
            root.preview AS preview,
            root.tokens_used AS tokensUsed,
            COALESCE(root.created_at_ms, root.created_at * 1000) AS createdAtMs,
            COALESCE(root.updated_at_ms, root.updated_at * 1000) AS updatedAtMs,
            root.agent_nickname AS agentNickname,
            root.agent_role AS agentRole,
            NULL AS parentThreadId,
            NULL AS childThreadId,
            NULL AS edgeStatus,
            NULL AS edgeOrder,
            0 AS sortDepth,
            0 AS sortCreatedAtMs,
            0 AS sortOrder,
            root.id AS sortChildId
          FROM threads root
          WHERE root.id = :rootThreadId

          UNION ALL

          SELECT
            child.id AS id,
            child.title AS title,
            child.first_user_message AS firstUserMessage,
            child.preview AS preview,
            child.tokens_used AS tokensUsed,
            COALESCE(child.created_at_ms, child.created_at * 1000) AS createdAtMs,
            COALESCE(child.updated_at_ms, child.updated_at * 1000) AS updatedAtMs,
            child.agent_nickname AS agentNickname,
            child.agent_role AS agentRole,
            graph_edges.parent_thread_id AS parentThreadId,
            graph_edges.child_thread_id AS childThreadId,
            graph_edges.status AS edgeStatus,
            graph_edges.edge_order AS edgeOrder,
            graph_edges.depth AS sortDepth,
            COALESCE(child.created_at_ms, child.created_at * 1000) AS sortCreatedAtMs,
            graph_edges.edge_order AS sortOrder,
            graph_edges.child_thread_id AS sortChildId
          FROM graph_edges
          LEFT JOIN threads child ON child.id = graph_edges.child_thread_id
          ORDER BY sortDepth, sortCreatedAtMs, sortOrder, sortChildId
        `)
        .all({ rootThreadId, scanDepth }) as unknown as AgentGraphRow[];
    },
    async close() {
      db.close();
    },
  };

  return store;
};
