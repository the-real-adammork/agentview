import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  PageOptions,
  SessionFilter,
  SessionSummary,
  ThreadSource,
} from "../../shared/contracts";
import { deriveRepoName } from "../../shared/repoName";
import type { AgentGraphRow } from "../sources/agentGraphRow";
import { deriveSessionTitle } from "./threadTitle";
import { reconstructEdges, type ReconstructThread, type ReconstructedLink } from "../relationships/reconstruct";
import { upgradeViaTranscript } from "../relationships/transcriptRunId";
import { stripParentMarker } from "../relationships/markers";

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

// `AgentGraphRow` was relocated to `../sources/agentGraphRow` (Phase 5) so both the
// Codex `StateStore` and the Claude Code row builder import it without a cross-source
// dependency. Re-exported here so every existing import keeps resolving. The shape is
// byte-identical (verbatim move) — Codex `deriveAgentGraph` output is unchanged.
export type { AgentGraphRow };

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
  // Sanitize previews for display: strip the [av-parent:] marker and normalize whitespace.
  const firstUserMessagePreview = stripParentMarker(row.first_user_message);
  const preview = stripParentMarker(row.preview);
  const titlePreview = deriveSessionTitle({
    id: row.id,
    title: row.title,
    firstUserMessage: firstUserMessagePreview,
    preview,
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
    source: "codex",
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
    parentEdgeSource: realParentId ? "native" : reconstructed ? "reconstructed" : undefined,
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
    t.rollout_path AS rolloutPath,
    COALESCE(t.created_at_ms, t.created_at * 1000) AS createdAtMs,
    COALESCE(t.updated_at_ms, t.updated_at * 1000) AS updatedAtMs,
    t.thread_source AS threadSource,
    CASE WHEN parent_edge.child_thread_id IS NULL THEN 0 ELSE 1 END AS hasRealParent
  FROM threads t
  LEFT JOIN thread_spawn_edges parent_edge ON parent_edge.child_thread_id = t.id
`;

const graphRecursiveSql = `
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
`;

// The relationship overlay (reconstructEdges + transcript scan) is expensive — it
// reads rollout files — and the API opens a fresh store per request, so a
// per-store memo never helps. Cache it module-wide, keyed by the state-db's
// mtime/size, so concurrent and repeated requests reuse one build until the DB
// changes. Read-only, so this is safe; bump the key when the file changes.
let sharedOverlay: {
  path: string;
  key: string;
  builtAtMs: number;
  rebuilding: boolean;
  value: Promise<Map<string, ReconstructedLink>>;
} | null = null;
// Max staleness before a background refresh is triggered (stale-while-revalidate).
const OVERLAY_MIN_REBUILD_MS = 15_000;

/**
 * Build the reconstructed-edge overlay with its own short-lived read-only DB
 * handle, so a background refresh never depends on a request store that may have
 * already closed. This is the expensive part (a transcript scan over rollouts).
 */
const buildOverlay = async (stateDbPath: string, codexHome: string): Promise<Map<string, ReconstructedLink>> => {
  const db = new DatabaseSync(stateDbPath, { readOnly: true });
  try {
    const rows = db.prepare(selectReconstructInputSql).all() as unknown as Array<{
      id: string;
      firstUserMessage: string | null;
      preview: string | null;
      cwd: string;
      createdAtMs: number | bigint | null;
      updatedAtMs: number | bigint | null;
      threadSource: ThreadSource | null;
      hasRealParent: number | bigint;
      rolloutPath: string;
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
    const pure = reconstructEdges(threads);
    const rolloutPathById = new Map(
      rows.map((row) => [row.id, isAbsolute(row.rolloutPath) ? row.rolloutPath : join(codexHome, row.rolloutPath)] as const),
    );
    return await upgradeViaTranscript(threads, pure, {
      rolloutPathById,
      readText: async (path) => {
        try {
          return await readFile(path, "utf8");
        } catch {
          return "";
        }
      },
    });
  } finally {
    db.close();
  }
};

/** Warm the overlay cache (e.g. at server startup) so the first request is fast. */
export const warmStateStore = async (codexHome: string): Promise<void> => {
  try {
    const store = await openStateStore({ codexHome });
    try {
      await store.listSessions({}, { limit: 1, offset: 0 });
    } finally {
      await store.close();
    }
  } catch {
    /* Best-effort warmup; real requests will surface any error. */
  }
};

export const openStateStore = async ({ codexHome }: { codexHome: string }): Promise<StateStore> => {
  const stateDbPath = join(codexHome, "state_5.sqlite");

  let overlayKey: string;
  try {
    const dbStat = await stat(stateDbPath);
    overlayKey = `${stateDbPath}:${dbStat.mtimeMs}:${dbStat.size}`;
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

  // Stale-while-revalidate: always return the cached overlay immediately, and when
  // it's gone stale (DB changed and older than OVERLAY_MIN_REBUILD_MS) kick off a
  // background rebuild so no request ever blocks on the transcript scan. Only the
  // very first build (cold) is awaited — startup warming covers that.
  const getOverlay = (): Promise<Map<string, ReconstructedLink>> => {
    // Only reuse the cache for the *same* DB file — the TTL grace period must not
    // serve one DB's overlay for another (e.g. across tests with separate temp DBs).
    if (sharedOverlay && sharedOverlay.path === stateDbPath) {
      const fresh = sharedOverlay.key === overlayKey || Date.now() - sharedOverlay.builtAtMs < OVERLAY_MIN_REBUILD_MS;
      if (!fresh && !sharedOverlay.rebuilding) {
        sharedOverlay.rebuilding = true;
        const value = buildOverlay(stateDbPath, codexHome);
        value
          .then(() => {
            sharedOverlay = { path: stateDbPath, key: overlayKey, builtAtMs: Date.now(), rebuilding: false, value };
          })
          .catch(() => {
            if (sharedOverlay) sharedOverlay.rebuilding = false;
          });
      }
      return sharedOverlay.value;
    }
    // Cold path (first build, different DB, or after a failure cleared the cache).
    const value = buildOverlay(stateDbPath, codexHome);
    sharedOverlay = { path: stateDbPath, key: overlayKey, builtAtMs: Date.now(), rebuilding: false, value };
    value.catch(() => {
      if (sharedOverlay?.value === value) sharedOverlay = null;
    });
    return value;
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

      const overlay = await getOverlay();

      if (repoFilter) {
        // Repo identity is derived in JS (git origin URL -> repo name, with a cwd
        // basename fallback), so it can't be expressed in SQL. Narrow by every other
        // condition in SQL, then filter + paginate in memory so the filter always
        // agrees with the repoLabel shown in the UI.
        const rows = db
          .prepare(`${selectThreadSql} ${where} ${orderBy}`)
          .all(parameters) as unknown as ThreadRow[];

        return rows
          .map((row) => normalizeThread(row, overlay))
          .filter((session) => session.repoLabel === repoFilter)
          .slice(offset, offset + limit);
      }

      const rows = db
        .prepare(`${selectThreadSql} ${where} ${orderBy} LIMIT :limit OFFSET :offset`)
        .all({ ...parameters, limit, offset }) as unknown as ThreadRow[];

      return rows.map((row) => normalizeThread(row, overlay));
    },
    async getThread(threadId) {
      const row = db
        .prepare(`
          ${selectThreadSql}
          WHERE t.id = :threadId
        `)
        .get({ threadId }) as unknown as ThreadRow | undefined;

      const overlay = await getOverlay();
      return row ? normalizeThread(row, overlay) : null;
    },
    async getAgentGraphRows(rootThreadId, scanDepth) {
      // Edge rows that come straight from thread_spawn_edges are the tool's own
      // spawn records, so their origin is "native". (The reconstructed overlay
      // below stamps its synthetic rows "reconstructed".) Root metadata rows have
      // no childThreadId and carry no edge, so they stay unstamped.
      const stampNative = (rows: AgentGraphRow[]): AgentGraphRow[] =>
        rows.map((row) => (row.childThreadId && !row.edgeSource ? { ...row, edgeSource: "native" } : row));

      const baseRows = stampNative(db.prepare(graphRecursiveSql).all({ rootThreadId, scanDepth }) as unknown as AgentGraphRow[]);

      const overlay = await getOverlay();
      if (overlay.size === 0) {
        return baseRows;
      }

      const present = new Set(baseRows.map((row) => row.id).filter((id): id is string => id !== null));
      const extraRows: AgentGraphRow[] = [];
      const queue = [...present];

      const childMetaStmt = db.prepare(`
              SELECT
                id, title, first_user_message AS firstUserMessage, preview,
                tokens_used AS tokensUsed,
                COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
                COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs,
                agent_nickname AS agentNickname, agent_role AS agentRole
              FROM threads WHERE id = :childId
            `);
      const subtreeStmt = db.prepare(graphRecursiveSql);

      // For each node already in the graph, attach orchestrators reconstructed under
      // it, then pull each orchestrator's own real subtree.
      while (queue.length > 0) {
        const parentId = queue.shift() as string;
        for (const link of overlay.values()) {
          if (link.parentId !== parentId || present.has(link.childId)) {
            continue;
          }
          present.add(link.childId);

          const childMeta = childMetaStmt
            .get({ childId: link.childId }) as unknown as Partial<AgentGraphRow> | undefined;

          // Synthetic edge row: parent (supervisor) -> child (orchestrator).
          extraRows.push({
            id: link.childId,
            title: childMeta?.title ?? null,
            firstUserMessage: childMeta?.firstUserMessage ?? null,
            preview: childMeta?.preview ?? null,
            tokensUsed: childMeta?.tokensUsed ?? null,
            createdAtMs: childMeta?.createdAtMs ?? null,
            updatedAtMs: childMeta?.updatedAtMs ?? null,
            agentNickname: childMeta?.agentNickname ?? null,
            agentRole: childMeta?.agentRole ?? null,
            parentThreadId: parentId,
            childThreadId: link.childId,
            edgeStatus: "closed", // status unknown for reconstructed edges; "closed" is the least-surprising default
            edgeOrder: null,
            edgeSource: "reconstructed",
            edgeConfidence: link.confidence,
            edgeVia: link.via,
          });

          // The orchestrator's own (real) subtree — these edges are tool-native.
          const subRows = stampNative(subtreeStmt.all({ rootThreadId: link.childId, scanDepth }) as unknown as AgentGraphRow[]);
          for (const sub of subRows) {
            // The recursive query emits a root metadata row (no childThreadId) for the
            // subtree root; skip that duplicate, keep the edge rows.
            if (!sub.childThreadId) {
              continue;
            }
            extraRows.push(sub);
            if (sub.id && !present.has(sub.id)) {
              present.add(sub.id);
              queue.push(sub.id);
            }
          }
          // Enqueue the orchestrator itself so its own overlay children (a reconstructed
          // orchestrator that is itself a parent) are discovered on a later iteration.
          queue.push(link.childId);
        }
      }

      return [...baseRows, ...extraRows];
    },
    async close() {
      db.close();
    },
  };

  return store;
};
