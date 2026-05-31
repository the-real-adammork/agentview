import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { AgentEdgeStatus, SessionStatus, SessionSummary } from "../../../shared/contracts";
import { maskPreviewSecrets } from "../../../shared/redaction";
import type { AgentGraphRow } from "../agentGraphRow";
import { readJsonlLines } from "../../rollout/jsonlStream";
import { inferStatus, STALE_WINDOW_MS, sumUsageTokens, type ClaudeUsageDelta } from "./claudeMeta";

/**
 * CC sub-agent enumeration. A CC root's `subagents/` dir holds one
 * `agent-<id>.jsonl` transcript + `agent-<id>.meta.json` sidecar per launched
 * sub-agent. The sidecar's `toolUseId` is the *exact* join key to the parent
 * transcript's `Task` `tool_use.id` — this is the certain native edge (stronger
 * than Codex's reconstruction). Every preview is redacted through
 * `src/shared/redaction.ts`; no raw transcript content leaves the server.
 */

const PREVIEW_MAX = 800;

const compactJson = (value: unknown, maxLength = PREVIEW_MAX): string => {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}...` : oneLine;
};

const redactedPreview = (value: unknown, maxLength = PREVIEW_MAX): string =>
  maskPreviewSecrets(compactJson(value, maxLength));

interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
}

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const usageDeltaOf = (usage: Record<string, unknown> | undefined): ClaudeUsageDelta => ({
  input: asNumber(usage?.input_tokens),
  output: asNumber(usage?.output_tokens),
  cacheCreate: asNumber(usage?.cache_creation_input_tokens),
  cacheRead: asNumber(usage?.cache_read_input_tokens),
});

/** Extract joined text from a user/assistant message content (string or block list). */
const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((block) =>
        block && typeof block === "object" && "type" in block && (block as { type?: unknown }).type === "text"
          ? (block as { text?: unknown }).text
          : block && typeof block === "object" && "text" in block
            ? (block as { text?: unknown }).text
            : undefined,
      )
      .filter((text): text is string => typeof text === "string" && text.length > 0);
    if (parts.length > 0) return parts.join(" ");
  }
  return "";
};

interface ParsedSubLine {
  type?: string;
  timestamp?: string;
  message?: { role?: string; content?: unknown; usage?: Record<string, unknown> };
  isError?: boolean;
}

/**
 * A normalized sub-agent entry, derived from a `<root>/subagents/agent-<id>.{jsonl,meta.json}`
 * pair. Carries everything BOTH `listChildren` (child summaries) and
 * `getAgentGraphRows` (graph rows) need without re-reading the transcript.
 */
export interface SubagentEntry {
  /** Child session id = file stem (`agent-<id>`). Unprefixed native id. */
  id: string;
  transcriptPath: string;
  agentType: string | null;
  /** First line of `meta.description`, trimmed. */
  description: string;
  toolUseId: string | null;
  firstUserMessagePreview: string | null;
  /** Final report = last assistant text block (redacted). Drives `finalReportPreview`. */
  finalReportPreview: string | null;
  tokenTotal: number;
  createdAtMs: number;
  updatedAtMs: number;
  status: SessionStatus;
  isError: boolean;
  /** Ordinal of this sub-agent's `agent-*` file (stable sort tiebreak fallback). */
  fileIndex: number;
}

const firstDescriptionLine = (description: string | undefined): string =>
  (description ?? "").split("\n")[0]?.trim() ?? "";

/** Parse one sub-agent transcript file into the normalized fields. */
const deriveSubagentTranscript = async (
  transcriptPath: string,
  now: number,
): Promise<{
  firstUserMessagePreview: string | null;
  finalReportPreview: string | null;
  tokenTotal: number;
  createdAtMs: number;
  updatedAtMs: number;
  status: SessionStatus;
  isError: boolean;
}> => {
  const { lines } = await readJsonlLines(transcriptPath);

  let firstUserText = "";
  let lastAssistantText = "";
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let isError = false;
  const usages: ClaudeUsageDelta[] = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let line: ParsedSubLine;
    try {
      line = JSON.parse(raw) as ParsedSubLine;
    } catch {
      continue;
    }

    if (typeof line.timestamp === "string") {
      if (firstTimestamp === undefined) firstTimestamp = line.timestamp;
      lastTimestamp = line.timestamp;
    }

    const role = line.message?.role ?? line.type;
    if (role === "user" && !firstUserText) {
      const text = textOf(line.message?.content);
      if (text) firstUserText = text;
    }
    if (role === "assistant") {
      usages.push(usageDeltaOf(line.message?.usage));
      const text = textOf(line.message?.content);
      if (text) lastAssistantText = text;
    }
    if (line.isError === true) isError = true;
  }

  const fileStat = await stat(transcriptPath);
  const createdAtMs = firstTimestamp ? Date.parse(firstTimestamp) : Math.round(fileStat.birthtimeMs || fileStat.ctimeMs);
  const updatedAtMs = lastTimestamp ? Date.parse(lastTimestamp) : Math.round(fileStat.mtimeMs);

  // A sub-agent's "terminal marker" is its final report (last assistant text block).
  // A transcript that produced a final report is complete; one that has not is still
  // running (a sub-agent without a final report has not returned). When a final
  // report IS present, `inferStatus` keeps the recency window for parity with
  // `claudeMeta`, but a missing report alone marks the run open regardless of mtime.
  const hasTerminalMarker = lastAssistantText.trim().length > 0;
  const status: SessionStatus = hasTerminalMarker
    ? inferStatus({ mtimeMs: fileStat.mtimeMs, hasTerminalMarker, now, staleWindowMs: STALE_WINDOW_MS })
    : "running";

  return {
    firstUserMessagePreview: firstUserText ? redactedPreview(firstUserText) : null,
    finalReportPreview: lastAssistantText ? redactedPreview(lastAssistantText, 1200) : null,
    tokenTotal: sumUsageTokens(usages),
    createdAtMs,
    updatedAtMs,
    status,
    isError,
  };
};

/**
 * Enumerate the `agent-<id>.{jsonl,meta.json}` pairs in one `subagents/` dir into
 * normalized `SubagentEntry[]`, sorted by file name (stable ordinal). Returns an
 * empty list when the dir is missing/unreadable so a CC root without sub-agents
 * (or an absent dir) is non-fatal.
 */
export const enumerateSubagents = async (
  subagentsDir: string,
  { now = Date.now() }: { now?: number } = {},
): Promise<SubagentEntry[]> => {
  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(subagentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const transcriptNames = dirEntries
    .filter((entry) => entry.isFile() && entry.name.startsWith("agent-") && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const entries: SubagentEntry[] = [];
  for (let fileIndex = 0; fileIndex < transcriptNames.length; fileIndex += 1) {
    const transcriptName = transcriptNames[fileIndex];
    const id = transcriptName.slice(0, -".jsonl".length);
    const transcriptPath = join(subagentsDir, transcriptName);

    let meta: SubagentMeta = {};
    try {
      const rawMeta = await readFile(join(subagentsDir, `${id}.meta.json`), "utf8");
      const parsed = JSON.parse(rawMeta) as unknown;
      if (parsed && typeof parsed === "object") meta = parsed as SubagentMeta;
    } catch {
      // Missing/unreadable sidecar — keep the transcript-derived fields; meta nulls.
    }

    const transcript = await deriveSubagentTranscript(transcriptPath, now);
    entries.push({
      id,
      transcriptPath,
      agentType: typeof meta.agentType === "string" && meta.agentType ? meta.agentType : null,
      description: firstDescriptionLine(meta.description),
      toolUseId: typeof meta.toolUseId === "string" && meta.toolUseId ? meta.toolUseId : null,
      fileIndex,
      ...transcript,
    });
  }

  return entries;
};

/** A sub-agent whose status is open counts toward `openChildCount`. */
export const openChildCount = (entries: SubagentEntry[]): number =>
  entries.filter((entry) => entry.status === "running").length;

/**
 * Scan one transcript for assistant `Task`/`Agent` `tool_use` blocks, returning the
 * tool_use ids it owns (in block order) plus whether each id later received a
 * `tool_result` (so the edge can report `open`/`closed`). The result lets the graph
 * builder join `meta.toolUseId` → the OWNING transcript (root vs. nested sub-agent)
 * and recover the block ordinal for `edgeOrder`.
 */
const AGENT_TOOL_NAMES = new Set(["Task", "Agent"]);

export interface TaskBlockInfo {
  toolUseId: string;
  ordinal: number;
  hasResult: boolean;
  resultIsError: boolean;
}

export const scanTaskBlocks = async (transcriptPath: string): Promise<TaskBlockInfo[]> => {
  let lines: string[];
  try {
    ({ lines } = await readJsonlLines(transcriptPath));
  } catch {
    return [];
  }

  const blocks: TaskBlockInfo[] = [];
  const resultIds = new Map<string, boolean>(); // tool_use_id → isError
  let ordinal = 0;

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = record.message;
    const content = (message && typeof message === "object" ? (message as { content?: unknown }).content : undefined) ??
      record.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const type = (block as { type?: unknown }).type;
      if (type === "tool_use") {
        const name = (block as { name?: unknown }).name;
        const id = (block as { id?: unknown }).id;
        if (typeof name === "string" && AGENT_TOOL_NAMES.has(name) && typeof id === "string") {
          blocks.push({ toolUseId: id, ordinal, hasResult: false, resultIsError: false });
          ordinal += 1;
        }
      } else if (type === "tool_result") {
        const id = (block as { tool_use_id?: unknown }).tool_use_id;
        const isError = (block as { is_error?: unknown }).is_error === true;
        if (typeof id === "string") resultIds.set(id, isError);
      }
    }
  }

  return blocks.map((block) => {
    const found = resultIds.has(block.toolUseId);
    return {
      ...block,
      hasResult: found,
      resultIsError: found ? (resultIds.get(block.toolUseId) ?? false) : false,
    };
  });
};

/** Map a `SessionStatus` to an `AgentEdgeStatus` for the agent-graph edge. */
export const childEdgeStatus = (entry: SubagentEntry, parentTask: TaskBlockInfo | undefined): AgentEdgeStatus => {
  // `failed` if the child or its parent `tool_result` is an error.
  if (entry.isError || parentTask?.resultIsError) return "failed";
  // `open` if the child is still running AND the parent's `Task` has no result yet.
  if (entry.status === "running" && !parentTask?.hasResult) return "open";
  return "closed";
};

/**
 * A sub-agent linked to its parent (root or enclosing sub-agent) via the certain
 * `meta.toolUseId` → `Task` `tool_use.id` join, with depth from the root and the
 * matching parent `Task` block (for `edgeOrder`/status).
 */
export interface LinkedSubagent {
  entry: SubagentEntry;
  parentId: string;
  depth: number;
  parentTask: TaskBlockInfo | undefined;
  edgeOrder: number;
}

/**
 * Link every enumerated sub-agent to its parent transcript via `toolUseId` and
 * compute depth from the root. The root transcript and each sub-agent transcript
 * are scanned for `Task` blocks; an entry whose `toolUseId` matches a block in
 * transcript T is a child of T. Entries with no matching owner (orphans) attach to
 * the root at depth 1. Cycles/duplicate child ids are guarded by keeping the first
 * placement (BFS from the root). Results are capped at `scanDepth`.
 */
export const linkSubagents = async (
  rootSessionId: string,
  rootTranscriptPath: string,
  entries: SubagentEntry[],
  scanDepth: number,
): Promise<LinkedSubagent[]> => {
  // tool_use_id → owning transcript id (root id OR a sub-agent's `agent-<id>`).
  const ownerByToolUseId = new Map<string, { ownerId: string; task: TaskBlockInfo }>();
  const tasksByTranscript = new Map<string, TaskBlockInfo[]>();

  const rootTasks = await scanTaskBlocks(rootTranscriptPath);
  tasksByTranscript.set(rootSessionId, rootTasks);
  for (const task of rootTasks) ownerByToolUseId.set(task.toolUseId, { ownerId: rootSessionId, task });

  for (const entry of entries) {
    const tasks = await scanTaskBlocks(entry.transcriptPath);
    tasksByTranscript.set(entry.id, tasks);
    for (const task of tasks) {
      if (!ownerByToolUseId.has(task.toolUseId)) ownerByToolUseId.set(task.toolUseId, { ownerId: entry.id, task });
    }
  }

  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  // Build child lists per parent id.
  const childrenByParent = new Map<string, Array<{ entry: SubagentEntry; parentTask: TaskBlockInfo | undefined; edgeOrder: number }>>();
  for (const entry of entries) {
    const owner = entry.toolUseId ? ownerByToolUseId.get(entry.toolUseId) : undefined;
    const parentId = owner?.ownerId ?? rootSessionId;
    const list = childrenByParent.get(parentId) ?? [];
    list.push({ entry, parentTask: owner?.task, edgeOrder: owner?.task?.ordinal ?? entry.fileIndex });
    childrenByParent.set(parentId, list);
  }

  // BFS from the root, capping at `scanDepth`, first-placement wins (cycle guard).
  const linked: LinkedSubagent[] = [];
  const visited = new Set<string>([rootSessionId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: rootSessionId, depth: 0 }];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.depth >= scanDepth) continue;
    const children = childrenByParent.get(current.id) ?? [];
    for (const child of children) {
      if (visited.has(child.entry.id)) continue;
      visited.add(child.entry.id);
      const depth = current.depth + 1;
      linked.push({
        entry: child.entry,
        parentId: current.id,
        depth,
        parentTask: child.parentTask,
        edgeOrder: child.edgeOrder,
      });
      if (entriesById.has(child.entry.id)) queue.push({ id: child.entry.id, depth });
    }
  }

  return linked;
};

/**
 * Map linked sub-agents to child `SessionSummary[]` for `listChildren`. The nickname
 * + title come from `meta.description`; `agentRole` from `meta.agentType`;
 * `parentId`/`parentEdgeSource` mark the certain native edge to the parent (root for
 * a direct child, the enclosing sub-agent for a nested one).
 */
export const subagentsToChildSummaries = (linked: LinkedSubagent[]): SessionSummary[] =>
  linked.map(({ entry, parentId }) => {
    const title = entry.description || entry.firstUserMessagePreview || entry.id;
    const titlePreview = redactedPreview(title);
    return {
      source: "claude-code",
      id: entry.id,
      title,
      status: entry.status,
      updatedAt: new Date(entry.updatedAtMs).toISOString(),
      branch: "",
      cwd: "",
      model: "",
      lastMessage: entry.finalReportPreview ?? entry.firstUserMessagePreview ?? "",
      childCount: 0,
      openChildCount: 0,
      parentId,
      parentEdgeSource: "native",
      tokenTotal: entry.tokenTotal,
      rolloutPath: entry.transcriptPath,
      createdAtMs: entry.createdAtMs,
      updatedAtMs: entry.updatedAtMs,
      titlePreview,
      firstUserMessagePreview: entry.firstUserMessagePreview ?? undefined,
      preview: titlePreview,
      tokensUsed: entry.tokenTotal,
      threadSource: "subagent",
      agentNickname: entry.description || null,
      agentRole: entry.agentType,
      gitSha: null,
      gitBranch: null,
      gitOriginUrl: null,
      archived: false,
      warningCountStatus: "not_requested",
      failedToolCountStatus: "not_requested",
    } satisfies SessionSummary;
  });

/**
 * Build a root metadata `AgentGraphRow` from the root `SessionSummary` (node fields
 * only; null edge fields). `deriveAgentGraph` indexes this by `id` for the root node.
 */
export const rootMetadataRow = (root: SessionSummary): AgentGraphRow => ({
  id: root.id,
  title: root.title,
  firstUserMessage: root.firstUserMessagePreview ?? null,
  preview: root.preview ?? null,
  tokensUsed: root.tokenTotal,
  createdAtMs: root.createdAtMs ?? null,
  updatedAtMs: root.updatedAtMs ?? null,
  agentNickname: root.agentNickname ?? null,
  agentRole: root.agentRole ?? null,
  parentThreadId: null,
  childThreadId: null,
  edgeStatus: null,
});

/**
 * Map linked sub-agents to native edge `AgentGraphRow[]`. Each row carries the
 * child's node fields (so `deriveAgentGraph` needs no second lookup) plus the
 * certain native edge: `edgeSource: "native"`, `edgeConfidence: "certain"`,
 * `edgeVia` omitted. `parentThreadId` is the enclosing transcript (root or the
 * enclosing sub-agent), `edgeOrder` the matching `Task` block ordinal. Ordered by
 * depth then `createdAtMs` then edge ordinal, mirroring the Codex recursive query.
 */
export const subagentsToAgentGraphRows = (linked: LinkedSubagent[]): AgentGraphRow[] =>
  [...linked]
    .sort(
      (left, right) =>
        left.depth - right.depth ||
        (left.entry.createdAtMs ?? 0) - (right.entry.createdAtMs ?? 0) ||
        left.edgeOrder - right.edgeOrder,
    )
    .map(({ entry, parentId, parentTask, edgeOrder }) => ({
      id: entry.id,
      title: entry.description || entry.firstUserMessagePreview || entry.id,
      firstUserMessage: entry.firstUserMessagePreview,
      preview: entry.finalReportPreview,
      tokensUsed: entry.tokenTotal,
      createdAtMs: entry.createdAtMs,
      updatedAtMs: entry.updatedAtMs,
      agentNickname: entry.description || null,
      agentRole: entry.agentType,
      parentThreadId: parentId,
      childThreadId: entry.id,
      edgeStatus: childEdgeStatus(entry, parentTask),
      edgeOrder,
      edgeSource: "native",
      edgeConfidence: "certain",
    }));

/**
 * Build the full `AgentGraphRow[]` for a CC root: the root metadata row first, then
 * a native edge row per discovered sub-agent (depth-ordered, capped at `scanDepth`,
 * cycle-guarded via `linkSubagents`).
 */
export const buildAgentGraphRows = async (
  root: SessionSummary,
  rootTranscriptPath: string,
  subagentsDir: string,
  scanDepth: number,
): Promise<AgentGraphRow[]> => {
  const entries = await enumerateSubagents(subagentsDir);
  const linked = await linkSubagents(root.id, rootTranscriptPath, entries, scanDepth);
  return [rootMetadataRow(root), ...subagentsToAgentGraphRows(linked)];
};
