import type { IncomingMessage, ServerResponse } from "node:http";

import type { AgentGraphRow, AgentGraphRowSource } from "../sources/agentGraphRow";
import { StateStoreError } from "../sqlite/stateStore";
import { createDefaultRegistry } from "../sources/defaultRegistry";
import type { SessionSource } from "../sources/SessionSource";
import { parseSourceId } from "../sources/sourceQuery";
import type { AgentEdge, AgentEdgeStatus, AgentGraph, AgentNode, EdgeConfidence, EdgeSource, EdgeVia, SessionStatus } from "../../shared/contracts";
import { fail, ok, writeJson } from "./http";

export interface AgentGraphOptions {
  maxDepth?: number;
}

export class AgentGraphError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AgentGraphError";
    this.code = code;
    this.status = status;
  }
}

const defaultMaxDepth = 2;
const maxAllowedDepth = 10;

/**
 * Narrow a dispatched `SessionSource` to the `AgentGraphRowSource` capability without
 * a source literal. Both `CodexSource` (via its wrapped `StateStore`) and
 * `ClaudeCodeSource` (via `subagents.ts`) satisfy it structurally — the handler stays
 * source-generic (no `if (codex)`).
 */
const asAgentGraphRowSource = (source: SessionSource): AgentGraphRowSource => {
  if (typeof (source as Partial<AgentGraphRowSource>).getAgentGraphRows !== "function") {
    throw new AgentGraphError(
      "AGENT_GRAPH_UNSUPPORTED",
      `Source does not support agent-graph rows: ${source.id}`,
      400,
    );
  }
  return source as unknown as AgentGraphRowSource;
};

const edgeStatusToSessionStatus = (status: AgentEdgeStatus | null): SessionStatus => {
  if (status === "open") return "running";
  if (status === "failed") return "failed";
  return "complete";
};

const titleFromRow = (row: AgentGraphRow, fallbackId: string) =>
  (row.title ?? "").trim() || (row.firstUserMessage ?? "").trim() || (row.preview ?? "").trim() || fallbackId;

const timestampFromMs = (value: number | null | undefined) =>
  value !== null && value !== undefined && Number.isFinite(value) ? new Date(value).toISOString() : undefined;

const createNode = ({
  id,
  row,
  depth,
  edgeStatus,
  metadataMissing = false,
}: {
  id: string;
  row?: AgentGraphRow;
  depth: number;
  edgeStatus: AgentEdgeStatus | null;
  metadataMissing?: boolean;
}): AgentNode => {
  const node: AgentNode = {
    id,
    title: row ? titleFromRow(row, id) : id,
    status: edgeStatusToSessionStatus(edgeStatus),
    depth,
    tokenTotal: Number(row?.tokensUsed ?? 0),
  };

  const createdAt = timestampFromMs(row?.createdAtMs);
  if (createdAt) {
    node.createdAt = createdAt;
  }

  const updatedAt = timestampFromMs(row?.updatedAtMs);
  if (updatedAt) {
    node.updatedAt = updatedAt;
  }

  if (edgeStatus) {
    node.sourceEdgeStatus = edgeStatus;
  }

  if (row?.agentNickname) {
    node.nickname = row.agentNickname;
  }

  if (row?.agentRole) {
    node.role = row.agentRole;
  }

  if (row?.preview?.trim()) {
    node.finalReportPreview = row.preview.trim();
  }

  if (metadataMissing) {
    node.metadataMissing = true;
  }

  return node;
};

type ChildEntry = {
  childId: string;
  status: AgentEdgeStatus;
  row?: AgentGraphRow;
  edgeOrder: number;
  sortCreatedAtMs: number;
  edgeSource?: EdgeSource;
  edgeConfidence?: EdgeConfidence;
  edgeVia?: EdgeVia;
};

export const deriveAgentGraph = (
  rootThreadId: string,
  rows: AgentGraphRow[],
  options: AgentGraphOptions = {},
): AgentGraph => {
  const maxDepth = options.maxDepth ?? defaultMaxDepth;
  const metadataById = new Map<string, AgentGraphRow>();
  const childrenByParent = new Map<string, ChildEntry[]>();

  for (const row of rows) {
    if (row.id) {
      metadataById.set(row.id, row);
    }

    if (row.parentThreadId && row.childThreadId && row.edgeStatus) {
      const children = childrenByParent.get(row.parentThreadId) ?? [];
      children.push({
        childId: row.childThreadId,
        status: row.edgeStatus,
        row: row.id ? row : undefined,
        edgeOrder: Number(row.edgeOrder ?? children.length),
        sortCreatedAtMs: row.createdAtMs ?? Number.MAX_SAFE_INTEGER,
        edgeSource: row.edgeSource,
        edgeConfidence: row.edgeConfidence,
        edgeVia: row.edgeVia,
      });
      childrenByParent.set(row.parentThreadId, children);
    }
  }

  for (const children of childrenByParent.values()) {
    children.sort(
      (left, right) =>
        left.sortCreatedAtMs - right.sortCreatedAtMs ||
        left.edgeOrder - right.edgeOrder ||
        left.childId.localeCompare(right.childId),
    );
  }

  const rootRow = metadataById.get(rootThreadId);
  if (!rootRow) {
    throw new AgentGraphError("THREAD_NOT_FOUND", `Thread not found: ${rootThreadId}`, 404);
  }

  const nodes: AgentNode[] = [createNode({ id: rootThreadId, row: rootRow, depth: 0, edgeStatus: null })];
  const edges: AgentEdge[] = [];
  const statusSummary: Record<AgentEdgeStatus, number> = {
    open: 0,
    closed: 0,
    failed: 0,
  };
  const visited = new Set<string>([rootThreadId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: rootThreadId, depth: 0 }];
  let truncatedDepth = false;

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const children = childrenByParent.get(current.id) ?? [];

    if (current.depth >= maxDepth) {
      if (children.length > 0) {
        truncatedDepth = true;
      }
      continue;
    }

    for (const child of children) {
      const depth = current.depth + 1;
      edges.push({
        parentId: current.id,
        childId: child.childId,
        status: child.status,
        ...(child.edgeSource ? { source: child.edgeSource } : {}),
        ...(child.edgeConfidence ? { confidence: child.edgeConfidence } : {}),
        ...(child.edgeVia ? { via: child.edgeVia } : {}),
      });
      statusSummary[child.status] += 1;

      if (visited.has(child.childId)) {
        continue;
      }

      visited.add(child.childId);
      const metadataRow = child.row ?? metadataById.get(child.childId);
      nodes.push(
        createNode({
          id: child.childId,
          row: metadataRow,
          depth,
          edgeStatus: child.status,
          metadataMissing: !metadataRow,
        }),
      );
      queue.push({ id: child.childId, depth });
    }
  }

  return {
    root: nodes[0],
    nodes,
    edges,
    maxDepth,
    truncatedDepth,
    openCount: statusSummary.open,
    statusSummary,
  };
};

const parseMaxDepth = (value: string | null) => {
  if (value === null || value.trim() === "") {
    return { ok: true as const, value: defaultMaxDepth };
  }

  if (!/^\d+$/.test(value)) {
    return { ok: false as const, message: "maxDepth must be an integer." };
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxAllowedDepth) {
    return { ok: false as const, message: `maxDepth must be between 0 and ${maxAllowedDepth}.` };
  }

  return { ok: true as const, value: parsed };
};

const toErrorStatus = (error: unknown) => {
  if (error instanceof AgentGraphError) {
    return error.status;
  }

  if (error instanceof StateStoreError) {
    return error.code === "STATE_DB_MISSING" || error.code === "SCHEMA_UNSUPPORTED" ? 503 : 500;
  }

  return 503;
};

const writeGraphError = (response: ServerResponse, origin: string | undefined, error: unknown) => {
  writeJson(
    response,
    toErrorStatus(error),
    fail("state-db", {
      code: error instanceof Error && "code" in error ? String(error.code) : "STATE_DB_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Unable to build agent graph.",
      detail:
        error instanceof StateStoreError && error.missing?.length
          ? error.missing.join(", ")
          : error instanceof Error
            ? error.message
            : undefined,
    }),
    origin,
  );
};

export const handleAgentGraphApiRequest = async (request: IncomingMessage, response: ServerResponse) => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/api/agent-graph") {
    return false;
  }

  if (request.method !== "GET") {
    writeJson(
      response,
      405,
      fail("state-db", {
        code: "METHOD_NOT_ALLOWED",
        message: "Agent graph API only supports GET requests.",
      }),
      origin,
    );
    return true;
  }

  const rootThreadId = url.searchParams.get("rootThreadId")?.trim();
  if (!rootThreadId) {
    writeJson(
      response,
      400,
      fail("state-db", {
        code: "INVALID_FILTER",
        message: "rootThreadId is required.",
      }),
      origin,
    );
    return true;
  }

  const maxDepth = parseMaxDepth(url.searchParams.get("maxDepth"));
  if (!maxDepth.ok) {
    writeJson(
      response,
      400,
      fail("state-db", {
        code: "INVALID_FILTER",
        message: maxDepth.message,
      }),
      origin,
    );
    return true;
  }

  // The SourceId dispatch discriminator travels as `sourceId` (default "codex").
  const sourceResult = parseSourceId(url);
  if (!sourceResult.ok) {
    writeJson(response, 400, fail("state-db", { code: "UNKNOWN_SOURCE", message: sourceResult.message }), origin);
    return true;
  }

  try {
    const registry = await createDefaultRegistry();

    try {
      if (!registry.has(sourceResult.source)) {
        writeJson(
          response,
          400,
          fail("state-db", {
            code: "UNKNOWN_SOURCE",
            message: `Source is not registered: ${sourceResult.source}`,
          }),
          origin,
        );
        return true;
      }

      // Dispatch by sourceId, then narrow to the AgentGraphRowSource capability.
      // Codex rows come from its wrapped StateStore SQL; CC rows from subagents/*.meta.json
      // joined to the parent Task tool_use. Both feed the unchanged deriveAgentGraph.
      const source = asAgentGraphRowSource(registry.get(sourceResult.source));
      const rows = await source.getAgentGraphRows(rootThreadId, maxDepth.value + 1);
      const graph = deriveAgentGraph(rootThreadId, rows, { maxDepth: maxDepth.value });
      writeJson(response, 200, ok("state-db", graph), origin);
      return true;
    } finally {
      await registry.close();
    }
  } catch (error) {
    writeGraphError(response, origin, error);
    return true;
  }
};
