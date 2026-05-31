import type {
  CachedRolloutFacts,
  CachedToolCall,
  EventSeverity,
  TimelineEvent,
  TimelineEventKind,
  TokenSnapshot,
} from "../../../shared/contracts";
import { fillCallCounts, fillToolSearch } from "../../rollout/classifyCall";
import { classifyExecOutput } from "../../rollout/classifyExecOutput";
import { maskPreviewSecrets } from "../../../shared/redaction";
import { mapClaudeTool, normalizeResultText, type MappedClaudeTool } from "./toolMap";

/**
 * CC transcript parser. Emits the *identical* `CachedRolloutFacts` shape the Codex
 * `parseRolloutLines` does (same `TimelineEvent` / `OutputRender` / `CallRender`
 * types, same `.warnings`/`.summary` population) so a CC session draws through the
 * existing renderers with zero renderer/contract change. The only CC-specific logic
 * — line/block classification (§A), per-tool render adaptation (§B via `toolMap`),
 * `parentUuid` turn reconstruction (§C), and `message.usage` mapping (§D) — lives
 * here and in `toolMap.ts`.
 */

/** CC cache-key discriminator; bump on parser changes. Distinct from `ROLLOUT_PARSER_VERSION`. */
export const CLAUDE_PARSER_VERSION = 1;

const LARGE_OUTPUT_COLLAPSE_BYTES = 4 * 1024;
const CLASSIFY_OUTPUT_CAP = 128 * 1024;

type JsonRecord = Record<string, unknown>;

type MutableTimelineEvent = TimelineEvent & {
  /** The CC `uuid` of the owning line (for turn reconstruction). */
  lineUuid?: string;
  /** Redacted, bounded full result output carried call↔result for classification; stripped before output. */
  fullOutput?: string;
  /** A render fully built from the call (Edit/Write diffs); applied at join. */
  outputRenderInput?: import("../../../shared/contracts").OutputRender;
  /** Whether `outputRender` must be classified from the joined result text. */
  classifyAtJoin?: boolean;
  resultEventId?: string;
};

export interface ParseClaudeSessionOptions {
  threadId: string;
  rolloutPath: string;
  sourceMtimeMs: number;
  sourceSizeBytes: number;
  parsedThroughByte?: number;
  startingLine?: number;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (...values: unknown[]): string | undefined => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value;
  return undefined;
};

const num = (...values: unknown[]): number | undefined => {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
};

const compactJson = (value: unknown, maxLength = 800): string => {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}...` : oneLine;
};

const redactedPreview = (value: unknown, maxLength = 800): string =>
  maskPreviewSecrets(compactJson(value, maxLength));

const isoTimestamp = (record: JsonRecord, lineNumber: number): string => {
  const raw = str(record.timestamp);
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  return new Date(lineNumber).toISOString();
};

/** Join a `user`/`assistant` message's text-block list (or string) into one string. */
const joinTextBlocks = (content: unknown): string | undefined => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : undefined))
    .filter((text): text is string => Boolean(text));
  return parts.length ? parts.join("\n") : undefined;
};

/** §D — map a CC assistant `message.usage` into a `TokenSnapshot`. */
const tokenSnapshotFromUsage = (usage: JsonRecord, timestamp: string): TokenSnapshot | undefined => {
  const inputTokens = num(usage.input_tokens) ?? 0;
  const cacheCreation = num(usage.cache_creation_input_tokens) ?? 0;
  const output = num(usage.output_tokens) ?? 0;
  const cachedInput = num(usage.cache_read_input_tokens) ?? 0;
  // cache_creation counts against the prompt → folded into input.
  const input = inputTokens + cacheCreation;
  const total = input + output + cachedInput;

  if (total === 0 && input === 0 && output === 0 && cachedInput === 0) return undefined;

  return { timestamp, total, input, output, cachedInput };
};

interface EventDraft {
  kind: TimelineEventKind;
  severity?: EventSeverity;
  previewText: string;
  callId?: string;
  toolName?: string;
  argumentsPreview?: string;
  commandPreview?: string;
  outputPreview?: string;
  outputBytes?: number;
  callRender?: TimelineEvent["callRender"];
  outputRenderInput?: import("../../../shared/contracts").OutputRender;
  classifyAtJoin?: boolean;
  fullOutput?: string;
  agentRole?: string;
  agentTaskPreview?: string;
  skillName?: string;
  tokenSnapshot?: TokenSnapshot;
  hasRawAvailable?: boolean;
  rawPreview?: string;
}

/**
 * Classify one CC line into zero or more event drafts (§A). A single `assistant`
 * line can yield a reasoning + an assistant_message + N tool_use events + a
 * synthesized token_snapshot; a `user` line yields a user_message OR tool_result
 * blocks. Known metadata lines (`ai-title`, `system`, …) yield no events.
 */
const draftsForLine = (record: JsonRecord, timestamp: string): { drafts: EventDraft[]; recognized: boolean } => {
  const type = str(record.type)?.toLowerCase();
  const message = isRecord(record.message) ? record.message : undefined;
  const role = str(record.role, message?.role)?.toLowerCase();

  // Known metadata line types — skipped, not warned (Phase 3 owns title/meta).
  const KNOWN_METADATA = new Set([
    "system",
    "summary",
    "ai-title",
    "attachment",
    "mode",
    "file-history-snapshot",
    "last-prompt",
    "worktree-state",
    "queue-operation",
  ]);
  if (type && KNOWN_METADATA.has(type)) return { drafts: [], recognized: true };

  if (type === "user" || role === "user") {
    const content = message?.content ?? record.content;
    // tool_result blocks join onto their tool_call.
    if (Array.isArray(content)) {
      const resultBlocks = content.filter(
        (block): block is JsonRecord => isRecord(block) && block.type === "tool_result",
      );
      if (resultBlocks.length > 0) {
        const drafts: EventDraft[] = resultBlocks.map((block) => {
          const text = normalizeResultText(block.content, record.toolUseResult);
          const outputPreview = text === undefined ? undefined : redactedPreview(text, 1200);
          return {
            kind: "tool_result",
            callId: str(block.tool_use_id),
            previewText: outputPreview ?? "tool completed",
            outputPreview,
            outputBytes: text === undefined ? undefined : Buffer.byteLength(text, "utf8"),
            fullOutput: text === undefined ? undefined : text.slice(0, CLASSIFY_OUTPUT_CAP),
            hasRawAvailable: text !== undefined,
            rawPreview: text === undefined ? undefined : redactedPreview(text, 4000),
          };
        });
        return { drafts, recognized: true };
      }
    }
    const text = joinTextBlocks(content);
    return {
      drafts: [{ kind: "user_message", previewText: redactedPreview(text ?? "") }],
      recognized: true,
    };
  }

  if (type === "assistant" || role === "assistant") {
    const drafts: EventDraft[] = [];
    const content = message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "thinking") {
          // Never spill the `signature`; show the redacted thinking text only.
          drafts.push({ kind: "reasoning", previewText: redactedPreview(str(block.thinking) ?? "") || "(reasoning withheld)" });
        } else if (block.type === "text") {
          drafts.push({ kind: "assistant_message", previewText: redactedPreview(str(block.text) ?? "") });
        } else if (block.type === "tool_use") {
          drafts.push(toolUseDraft(block));
        }
      }
    } else {
      const text = joinTextBlocks(content);
      if (text !== undefined) drafts.push({ kind: "assistant_message", previewText: redactedPreview(text) });
    }

    // Synthesize a token_snapshot from message.usage (§D) when present and non-zero.
    const usage = isRecord(message?.usage) ? message.usage : undefined;
    if (usage) {
      const snapshot = tokenSnapshotFromUsage(usage, timestamp);
      if (snapshot) {
        drafts.push({
          kind: "token_snapshot",
          previewText: `tokens total=${snapshot.total.toLocaleString("en-US")} input=${snapshot.input.toLocaleString("en-US")} output=${snapshot.output.toLocaleString("en-US")} cached=${snapshot.cachedInput.toLocaleString("en-US")}`,
          tokenSnapshot: snapshot,
        });
      }
    }

    if (drafts.length === 0) {
      // An assistant line with no recognizable content (e.g. an empty content list)
      // is still a known shape — emit nothing rather than a warning.
      return { drafts: [], recognized: true };
    }
    return { drafts, recognized: true };
  }

  return { drafts: [], recognized: false };
};

/** Build a draft for an assistant `tool_use` block via the per-tool `toolMap`. */
const toolUseDraft = (block: JsonRecord): EventDraft => {
  const mapped: MappedClaudeTool = mapClaudeTool(block);
  const callId = str(block.id);

  if (mapped.kind === "agent_launch") {
    return {
      kind: "agent_launch",
      callId,
      toolName: mapped.toolName,
      previewText: mapped.agentTaskPreview || `${mapped.agentRole ?? "agent"} launched`,
      agentRole: mapped.agentRole,
      agentTaskPreview: mapped.agentTaskPreview,
    };
  }

  if (mapped.kind === "skill_invoke") {
    return {
      kind: "skill_invoke",
      callId,
      toolName: mapped.toolName,
      previewText: mapped.skillName ? `${mapped.skillName} invoked` : "skill invoked",
      argumentsPreview: mapped.argumentsPreview,
      skillName: mapped.skillName,
    };
  }

  const previewText = `${mapped.toolName} ${mapped.commandPreview ?? mapped.argumentsPreview ?? ""}`.trim();
  return {
    kind: "tool_call",
    callId,
    toolName: mapped.toolName,
    previewText,
    commandPreview: mapped.commandPreview,
    argumentsPreview: mapped.argumentsPreview,
    callRender: mapped.callRender,
    outputRenderInput: mapped.outputRenderInput,
    classifyAtJoin: mapped.classifyAtJoin,
  };
};

const millisBetween = (start?: string, end?: string): number | undefined => {
  if (!start || !end) return undefined;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
};

/**
 * §C — reconstruct a `turnId` per user→assistant exchange. Index lines by `uuid`,
 * then for each emitted event walk `parentUuid` up to the nearest enclosing
 * top-level `user` line; that user line's id seeds `turn-<uuid>`. Unresolved chains
 * get no `turnId` (still emitted, just unbucketed) — never throw.
 */
const buildTurnResolver = (lines: ParsedLine[]): ((uuid: string | undefined) => string | undefined) => {
  const byUuid = new Map<string, ParsedLine>();
  for (const line of lines) {
    if (line.uuid) byUuid.set(line.uuid, line);
  }
  const cache = new Map<string, string | undefined>();

  const resolve = (uuid: string | undefined): string | undefined => {
    if (!uuid) return undefined;
    if (cache.has(uuid)) return cache.get(uuid);
    const seen = new Set<string>();
    let current: string | undefined = uuid;
    while (current && !seen.has(current)) {
      seen.add(current);
      const line: ParsedLine | undefined = byUuid.get(current);
      if (!line) break;
      if (line.isTopLevelUser) {
        const turnId = `turn-${line.uuid}`;
        cache.set(uuid, turnId);
        return turnId;
      }
      current = line.parentUuid;
    }
    cache.set(uuid, undefined);
    return undefined;
  };

  return resolve;
};

interface ParsedLine {
  uuid?: string;
  parentUuid?: string;
  isTopLevelUser: boolean;
}

/**
 * Join calls to results (by `tool_use.id` ↔ `tool_use_id`), classify exec output and
 * fill call-side counts, then derive `toolCalls`/`tokenSnapshots`/`agentLaunches`/
 * `turns` exactly as the Codex `deriveFacts` does.
 */
const deriveFacts = (events: MutableTimelineEvent[]) => {
  const calls = events.filter((event) => event.kind === "tool_call" && event.callId);
  const resultsByCallId = new Map(
    events.filter((event) => event.kind === "tool_result" && event.callId).map((event) => [event.callId as string, event]),
  );

  const toolCalls: CachedToolCall[] = calls.map((call) => {
    const result = resultsByCallId.get(call.callId as string);
    if (result && !result.toolName) result.toolName = call.toolName;
    const durationMs = result?.durationMs ?? millisBetween(call.timestamp, result?.timestamp);
    if (result) {
      call.joinedOutputPreview = result.outputPreview;
      call.joinedExitCode = result.exitCode;
      call.joinedDurationMs = durationMs;
      call.resultEventId = result.id;
      if (result.rawPreview) {
        call.rawPreview = result.rawPreview;
        call.hasRawAvailable = true;
      }
    }

    // A diff render built directly from the call (Edit/Write) always wins; otherwise
    // classify the result text into a structured render (Bash → exec; generic → self-identifying).
    if (call.outputRenderInput) {
      call.outputRender = call.outputRenderInput;
    } else if (call.classifyAtJoin) {
      const render = classifyExecOutput(call.commandPreview, result?.fullOutput ?? call.fullOutput);
      if (render) call.outputRender = render;
    }

    // Fill the call-side render's hit/result/status count from the joined output.
    if (call.callRender?.kind === "tool_search") fillToolSearch(call.callRender, undefined);
    else if (call.callRender) fillCallCounts(call.callRender, result?.fullOutput ?? result?.outputPreview);

    return {
      callId: call.callId as string,
      toolName: call.toolName ?? "unknown",
      startedAt: call.timestamp,
      completedAt: result?.timestamp,
      argumentsPreview: call.argumentsPreview,
      outputPreview: result?.outputPreview,
      outputBytes: result?.outputBytes,
      exitCode: result?.exitCode,
      durationMs,
      resultEventId: result?.id,
      failureReasonPreview: undefined,
      commandPreview: call.commandPreview,
      outputTokenCount: undefined,
    } satisfies CachedToolCall;
  });

  // Skills join to their result for the status chip but stay out of `toolCalls`.
  for (const skill of events.filter((event) => event.kind === "skill_invoke")) {
    const result = skill.callId ? resultsByCallId.get(skill.callId) : undefined;
    if (!result) continue;
    skill.joinedOutputPreview = result.outputPreview;
    skill.skillStatus = "ok";
  }

  const tokenSnapshots = events.flatMap((event) => (event.tokenSnapshot ? [event.tokenSnapshot] : []));
  const agentLaunches = events
    .filter((event) => event.kind === "agent_launch")
    .map((event) => ({
      callId: event.callId ?? event.id,
      childThreadId: event.childThreadId,
      timestamp: event.timestamp,
      nickname: event.agentNickname,
      role: event.agentRole,
      taskPreview: event.agentTaskPreview,
    }));
  const agentWaits: CachedRolloutFacts["agentWaits"] = [];

  const eventsByTurn = new Map<string, MutableTimelineEvent[]>();
  for (const event of events) {
    if (!event.turnId) continue;
    eventsByTurn.set(event.turnId, [...(eventsByTurn.get(event.turnId) ?? []), event]);
  }
  const turns = [...eventsByTurn].map(([turnId, turnEvents]) => {
    const startedAt = turnEvents[0]?.timestamp;
    const completedAt = turnEvents.at(-1)?.timestamp;
    const lastToken = [...turnEvents].reverse().find((event) => event.tokenSnapshot)?.tokenSnapshot;
    const lastAgentMessagePreview = [...turnEvents]
      .reverse()
      .find((event) => event.kind === "agent_message" || event.kind === "assistant_message")
      ?.previewText;
    return {
      turnId,
      startedAt,
      completedAt,
      durationMs: millisBetween(startedAt, completedAt),
      lastAgentMessagePreview,
      inputTokenCount: lastToken?.input,
      outputTokenCount: lastToken?.output,
      totalTokenCount: lastToken?.total,
    };
  });

  return { toolCalls, tokenSnapshots, agentLaunches, agentWaits, turns };
};

export const parseClaudeSessionLines = (
  lines: string[],
  options: ParseClaudeSessionOptions,
): CachedRolloutFacts => {
  const events: MutableTimelineEvent[] = [];
  const warnings: string[] = [];
  const startingLine = options.startingLine ?? 1;
  const parsedLines: ParsedLine[] = [];

  lines.forEach((line, index) => {
    const sourceLine = startingLine + index;
    if (!line.trim()) return;

    let record: JsonRecord;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) throw new Error("line is not a JSON object");
      record = parsed;
    } catch (error) {
      const message = `Malformed JSON: ${error instanceof Error ? error.message : String(error)}`;
      warnings.push(`line ${sourceLine}: ${message}`);
      events.push({
        id: `${options.threadId}:${sourceLine}:parse-error`,
        threadId: options.threadId,
        timestamp: new Date(sourceLine).toISOString(),
        sourceLine,
        kind: "parse_error",
        severity: "error",
        previewText: maskPreviewSecrets(message),
      });
      return;
    }

    const type = str(record.type)?.toLowerCase();
    const message = isRecord(record.message) ? record.message : undefined;
    const role = str(record.role, message?.role)?.toLowerCase();
    const uuid = str(record.uuid);
    const parentUuid = str(record.parentUuid);
    // A top-level user message is a real prompt — NOT a `user` line that merely
    // carries `tool_result` blocks (those are intermediate result lines that
    // inherit the enclosing turn, §C).
    const isUserLine = type === "user" || role === "user";
    const userContent = message?.content ?? record.content;
    const carriesToolResult =
      Array.isArray(userContent) && userContent.some((block) => isRecord(block) && block.type === "tool_result");
    const isTopLevelUser = isUserLine && record.isSidechain !== true && !carriesToolResult;
    parsedLines.push({ uuid, parentUuid, isTopLevelUser });

    const timestamp = isoTimestamp(record, sourceLine);
    const { drafts, recognized } = draftsForLine(record, timestamp);

    if (!recognized) {
      warnings.push(`line ${sourceLine}: unknown CC line ${type ?? role ?? "unknown"}`);
      events.push({
        id: `${options.threadId}:${sourceLine}:0`,
        threadId: options.threadId,
        timestamp,
        sourceLine,
        kind: "warning",
        severity: "warning",
        previewText: redactedPreview(record),
        lineUuid: uuid,
      });
      return;
    }

    drafts.forEach((draft, draftIndex) => {
      events.push({
        id: `${options.threadId}:${sourceLine}:${draftIndex}`,
        threadId: options.threadId,
        timestamp,
        sourceLine,
        kind: draft.kind,
        severity: draft.severity ?? "info",
        previewText: draft.previewText,
        callId: draft.callId,
        toolName: draft.toolName,
        argumentsPreview: draft.argumentsPreview,
        commandPreview: draft.commandPreview,
        outputPreview: draft.outputPreview,
        outputBytes: draft.outputBytes,
        callRender: draft.callRender,
        agentRole: draft.agentRole,
        agentTaskPreview: draft.agentTaskPreview,
        skillName: draft.skillName,
        tokenSnapshot: draft.tokenSnapshot,
        isCollapsedByDefault: (draft.outputBytes ?? 0) > LARGE_OUTPUT_COLLAPSE_BYTES,
        hasRawAvailable: draft.hasRawAvailable,
        rawPreview: draft.rawPreview,
        lineUuid: uuid,
        fullOutput: draft.fullOutput,
        outputRenderInput: draft.outputRenderInput,
        classifyAtJoin: draft.classifyAtJoin,
      });
    });
  });

  // §C — assign turnId by walking parentUuid to the nearest top-level user line.
  const resolveTurn = buildTurnResolver(parsedLines);
  for (const event of events) {
    const turnId = resolveTurn(event.lineUuid);
    if (turnId) event.turnId = turnId;
  }

  const { toolCalls, tokenSnapshots, agentLaunches, agentWaits, turns } = deriveFacts(events);

  // The carried helpers were only needed for the join/classification; drop them so
  // they never bloat the cached facts or the streamed payload.
  for (const event of events) {
    delete event.fullOutput;
    delete event.outputRenderInput;
    delete event.classifyAtJoin;
    delete event.lineUuid;
    delete event.resultEventId;
  }

  return {
    threadId: options.threadId,
    rolloutPath: options.rolloutPath,
    parserVersion: CLAUDE_PARSER_VERSION,
    sourceMtimeMs: options.sourceMtimeMs,
    sourceSizeBytes: options.sourceSizeBytes,
    parsedThroughByte: options.parsedThroughByte ?? options.sourceSizeBytes,
    events,
    toolCalls,
    tokenSnapshots,
    turns,
    agentLaunches,
    agentWaits,
    summary: {
      startedAt: events[0]?.timestamp,
      completedAt: events.at(-1)?.timestamp,
      eventCount: events.length,
      turnCount: turns.length,
      toolCallCount: toolCalls.length,
      failedToolCallCount: toolCalls.filter((call) => (call.exitCode ?? 0) !== 0).length,
      tokenSnapshotCount: tokenSnapshots.length,
      agentLaunchCount: agentLaunches.length,
      agentWaitCount: agentWaits.length,
      warningCount: events.filter((event) => event.kind === "warning" || event.kind === "parse_error").length,
      parsedThroughByte: options.parsedThroughByte ?? options.sourceSizeBytes,
    },
    warnings,
  };
};
