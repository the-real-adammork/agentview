import { stat } from "node:fs/promises";

import { readJsonlLines } from "../../rollout/jsonlStream";
import { maskPreviewSecrets } from "../../../shared/redaction";
import type { SessionStatus, SessionSummary } from "../../../shared/contracts";
import type { DiscoveredClaudeSession } from "./discovery";

/** A session whose file was touched within this window (and has no terminal marker) is "running". */
export const STALE_WINDOW_MS = 10 * 60 * 1000;

/** Per-usage token deltas, normalized from the assistant `message.usage` keys. */
export interface ClaudeUsageDelta {
  input?: number;
  output?: number;
  cacheCreate?: number;
  cacheRead?: number;
}

const PREVIEW_MAX = 800;

const compactJson = (value: unknown, maxLength = PREVIEW_MAX) => {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}...` : oneLine;
};

/** Redacted, bounded preview — the same masking the Codex parser applies to previews. */
const redactedPreview = (value: unknown, maxLength = PREVIEW_MAX) => maskPreviewSecrets(compactJson(value, maxLength));

/** The `ai-title` line's `aiTitle`, or a redacted first-user-message preview when empty/whitespace. */
export const pickTitle = (aiTitle: string | undefined, firstUserPreview: string): string => {
  if (aiTitle && aiTitle.trim() !== "") return aiTitle;
  return firstUserPreview;
};

/** Sum every usage delta; missing keys count as 0. */
export const sumUsageTokens = (usages: ClaudeUsageDelta[]): number =>
  usages.reduce(
    (total, usage) =>
      total + (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheCreate ?? 0) + (usage.cacheRead ?? 0),
    0,
  );

/**
 * Recency status heuristic: a transcript whose file mtime is within
 * `staleWindowMs` of `now` AND that carries no terminal marker is "running";
 * everything else is "complete". A terminal marker forces "complete" regardless
 * of mtime.
 *
 * Terminal-marker rule (Phase 3): a `system` line whose `subtype`/`stopReason`
 * indicates the turn ended (e.g. `subtype: "end"`/`"completed"` or a non-empty
 * `stopReason`). The full stop-reason taxonomy is a Phase-4 parse concern; this
 * phase only needs the boolean "did the run end".
 */
export const inferStatus = ({
  mtimeMs,
  hasTerminalMarker,
  now,
  staleWindowMs,
}: {
  mtimeMs: number;
  hasTerminalMarker: boolean;
  now: number;
  staleWindowMs: number;
}): SessionStatus => {
  if (hasTerminalMarker) return "complete";
  return now - mtimeMs <= staleWindowMs ? "running" : "complete";
};

interface ParsedLine {
  type?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  sessionId?: string;
  timestamp?: string;
  aiTitle?: string;
  subtype?: string;
  stopReason?: unknown;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: Record<string, unknown>;
  };
}

const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const usageDeltaOf = (usage: Record<string, unknown> | undefined): ClaudeUsageDelta => ({
  input: asNumber(usage?.input_tokens),
  output: asNumber(usage?.output_tokens),
  cacheCreate: asNumber(usage?.cache_creation_input_tokens),
  cacheRead: asNumber(usage?.cache_read_input_tokens),
});

/** Extract preview text from a `user` message content (plain string or content blocks). */
const userContentPreview = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .map((block) => (block && typeof block === "object" && "text" in block ? (block as { text?: unknown }).text : undefined))
      .filter((text): text is string => typeof text === "string");
    if (texts.length > 0) return texts.join(" ");
  }
  return "";
};

const isTerminalMarker = (line: ParsedLine): boolean => {
  if (line.type !== "system") return false;
  const subtype = typeof line.subtype === "string" ? line.subtype.toLowerCase() : "";
  if (subtype === "end" || subtype === "completed" || subtype === "complete") return true;
  return typeof line.stopReason === "string" && line.stopReason.trim() !== "";
};

/**
 * Stream the transcript and derive a `SessionSummary` WITHOUT a full timeline
 * parse: first stamped cwd/gitBranch/version, the last `ai-title`, the first
 * `user` message preview, the last assistant `message.model`, the running usage
 * sum, first/last `timestamp`, and whether a terminal marker was seen. Every
 * preview is redacted through `src/shared/redaction.ts`.
 */
export const deriveClaudeMeta = async (
  discovered: DiscoveredClaudeSession,
  { now = Date.now() }: { now?: number } = {},
): Promise<SessionSummary> => {
  const { lines } = await readJsonlLines(discovered.transcriptPath);

  let cwd = "";
  let gitBranch = "";
  let version = "";
  let lineSessionId = "";
  let aiTitle: string | undefined;
  let firstUserContent: unknown;
  let lastAssistantModel = "";
  let lastAssistantText = "";
  let lastUserText = "";
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let hasTerminalMarker = false;
  const usages: ClaudeUsageDelta[] = [];

  for (const raw of lines) {
    if (!raw.trim()) continue;
    let line: ParsedLine;
    try {
      line = JSON.parse(raw) as ParsedLine;
    } catch {
      continue;
    }

    if (!cwd && typeof line.cwd === "string") cwd = line.cwd;
    if (!gitBranch && typeof line.gitBranch === "string") gitBranch = line.gitBranch;
    if (!version && typeof line.version === "string") version = line.version;
    if (!lineSessionId && typeof line.sessionId === "string") lineSessionId = line.sessionId;

    if (typeof line.timestamp === "string") {
      if (firstTimestamp === undefined) firstTimestamp = line.timestamp;
      lastTimestamp = line.timestamp;
    }

    if (line.type === "ai-title" && typeof line.aiTitle === "string") {
      aiTitle = line.aiTitle;
    }

    if (line.type === "user") {
      if (firstUserContent === undefined) firstUserContent = line.message?.content;
      const text = userContentPreview(line.message?.content);
      if (text) lastUserText = text;
    }

    if (line.type === "assistant") {
      if (typeof line.message?.model === "string" && line.message.model) lastAssistantModel = line.message.model;
      usages.push(usageDeltaOf(line.message?.usage));
      const text = userContentPreview(line.message?.content);
      if (text) lastAssistantText = text;
    }

    if (isTerminalMarker(line)) hasTerminalMarker = true;
  }

  const fileStat = await stat(discovered.transcriptPath);
  const createdAtMs = firstTimestamp ? Date.parse(firstTimestamp) : Math.round(fileStat.birthtimeMs || fileStat.ctimeMs);
  const updatedAtMs = lastTimestamp ? Date.parse(lastTimestamp) : Math.round(fileStat.mtimeMs);

  const firstUserPreview = redactedPreview(userContentPreview(firstUserContent));
  const title = pickTitle(aiTitle, firstUserPreview);
  const titlePreview = redactedPreview(title);
  const lastMessagePreview = redactedPreview(lastAssistantText || lastUserText);
  const tokenTotal = sumUsageTokens(usages);

  const status = inferStatus({
    mtimeMs: fileStat.mtimeMs,
    hasTerminalMarker,
    now,
    staleWindowMs: STALE_WINDOW_MS,
  });

  return {
    source: "claude-code",
    id: discovered.sessionId,
    title,
    status,
    updatedAt: new Date(updatedAtMs).toISOString(),
    branch: gitBranch,
    cwd: cwd || discovered.cwdFromProjectDir,
    model: lastAssistantModel,
    lastMessage: lastMessagePreview,
    childCount: discovered.childCount,
    openChildCount: 0,
    tokenTotal,
    rolloutPath: discovered.transcriptPath,
    createdAtMs,
    updatedAtMs,
    titlePreview,
    firstUserMessagePreview: firstUserPreview,
    preview: titlePreview,
    tokensUsed: tokenTotal,
    threadSource: "user",
    agentNickname: null,
    agentRole: null,
    gitSha: null,
    gitBranch,
    gitOriginUrl: null,
    archived: false,
    warningCountStatus: "not_requested",
    failedToolCountStatus: "not_requested",
  };
};
