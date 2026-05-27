import type {
  CachedRolloutFacts,
  CachedToolCall,
  EventSeverity,
  TimelineEvent,
  TimelineEventKind,
  TokenSnapshot,
} from "../../shared/contracts";
import { maskPreviewSecrets } from "../../shared/redaction";

export const ROLLOUT_PARSER_VERSION = 1;
export const LARGE_OUTPUT_COLLAPSE_BYTES = 4 * 1024;

type JsonRecord = Record<string, unknown>;

export interface ParseRolloutOptions {
  threadId: string;
  rolloutPath: string;
  sourceMtimeMs: number;
  sourceSizeBytes: number;
  parsedThroughByte?: number;
  startingLine?: number;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
};

const numberValue = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "bigint") return Number(value);
  }
  return undefined;
};

const isoTimestamp = (record: JsonRecord, lineNumber: number) => {
  const raw = stringValue(record.timestamp, record.created_at, record.createdAt, record.time, record.ts);
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }

  const millis = numberValue(record.timestamp_ms, record.timestampMs, record.created_at_ms, record.createdAtMs);
  if (millis !== undefined) return new Date(millis).toISOString();

  return new Date(lineNumber).toISOString();
};

const compactJson = (value: unknown, maxLength = 800) => {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}...` : oneLine;
};

const redactedPreview = (value: unknown, maxLength = 800) => maskPreviewSecrets(compactJson(value, maxLength));

const eventType = (record: JsonRecord) =>
  stringValue(record.type, record.kind, record.event, record.name)?.toLowerCase().replace(/[.-]/g, "_") ?? "unknown";

const rawEventType = (record: JsonRecord) =>
  stringValue(record.type, record.kind, record.event, record.name) ?? "unknown";

const nestedMessage = (record: JsonRecord) => {
  const message = isRecord(record.message) ? record.message : isRecord(record.msg) ? record.msg : undefined;
  return message;
};

const nestedPayload = (record: JsonRecord) => {
  const payload = isRecord(record.payload) ? record.payload : undefined;
  const data = isRecord(record.data) ? record.data : undefined;
  return payload ?? data ?? record;
};

const previewFromRecord = (record: JsonRecord) => {
  const message = nestedMessage(record);
  const payload = nestedPayload(record);
  const content = stringValue(
    record.preview,
    record.text,
    record.content,
    record.body,
    message?.content,
    message?.text,
    payload.preview,
    payload.text,
    payload.content,
    payload.body,
  );

  if (content) return redactedPreview(content);

  const items = Array.isArray(record.content)
    ? record.content
    : Array.isArray(message?.items)
      ? message.items
      : Array.isArray(payload.items)
        ? payload.items
        : undefined;
  if (items) {
    const textItems = items
      .map((item) => {
        if (!isRecord(item)) return undefined;
        return stringValue(item.text, item.content);
      })
      .filter(Boolean);
    return redactedPreview(textItems.length ? textItems.join(" ") : items);
  }

  return redactedPreview(payload);
};

const callIdFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  return stringValue(record.call_id, record.callId, record.id, payload.call_id, payload.callId, payload.id);
};

const toolNameFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  const tool = isRecord(record.tool) ? record.tool : isRecord(payload.tool) ? payload.tool : undefined;
  return stringValue(record.tool_name, record.toolName, record.name, payload.tool_name, payload.toolName, payload.name, tool?.name);
};

const outputFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  return stringValue(record.output, record.result, record.stderr, record.stdout, payload.output, payload.result, payload.stderr, payload.stdout);
};

const argsFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  return record.arguments ?? record.args ?? record.params ?? payload.arguments ?? payload.args ?? payload.params;
};

const tokenSnapshotFromRecord = (record: JsonRecord, timestamp: string): TokenSnapshot | undefined => {
  const payload = nestedPayload(record);
  const usage = isRecord(record.total_token_usage)
    ? record.total_token_usage
    : isRecord(record.usage)
      ? record.usage
      : isRecord(payload.total_token_usage)
        ? payload.total_token_usage
        : isRecord(payload.usage)
          ? payload.usage
          : payload;
  const rateLimits = isRecord(record.rate_limits)
    ? record.rate_limits
    : isRecord(payload.rate_limits)
      ? payload.rate_limits
      : undefined;
  const input = numberValue(usage.input, usage.input_tokens, usage.prompt_tokens) ?? 0;
  const output = numberValue(usage.output, usage.output_tokens, usage.completion_tokens) ?? 0;
  const cachedInput = numberValue(usage.cachedInput, usage.cached_input, usage.cached_input_tokens) ?? 0;
  const reasoningOutput = numberValue(usage.reasoningOutput, usage.reasoning_output, usage.reasoning_output_tokens);
  const total = numberValue(usage.total, usage.total_tokens) ?? input + output + cachedInput + (reasoningOutput ?? 0);
  const contextWindow = numberValue(record.context_window, payload.context_window);

  if (total === 0 && input === 0 && output === 0 && cachedInput === 0 && reasoningOutput === undefined) {
    return undefined;
  }

  return {
    timestamp,
    total,
    input,
    output,
    cachedInput,
    reasoningOutput,
    contextUtilization: numberValue(usage.contextUtilization, usage.context_utilization) ?? (contextWindow ? total / contextWindow : undefined),
    rateLimitPrimaryPercent: numberValue(
      usage.rateLimitPrimaryPercent,
      usage.rate_limit_primary_percent,
      rateLimits?.primary_percent,
    ),
    rateLimitSecondaryPercent: numberValue(
      usage.rateLimitSecondaryPercent,
      usage.rate_limit_secondary_percent,
      rateLimits?.secondary_percent,
    ),
    resetAt: stringValue(usage.resetAt, usage.reset_at, rateLimits?.reset_at),
  };
};

const classify = (record: JsonRecord): { kind: TimelineEventKind; severity: EventSeverity } => {
  const type = eventType(record);
  const role = stringValue(record.role, nestedMessage(record)?.role)?.toLowerCase();
  const level = stringValue(record.level, record.severity)?.toLowerCase();

  if (level === "error") return { kind: "warning", severity: "error" };
  if (level === "warn" || level === "warning") return { kind: "warning", severity: "warning" };
  if (type.includes("parse_error")) return { kind: "parse_error", severity: "error" };
  if (type.includes("task_started") || type.includes("session_started") || type.includes("thread_started")) return { kind: "task_started", severity: "info" };
  if (type.includes("task_complete") || type.includes("task_completed") || type.includes("session_finished") || type.includes("thread_completed")) return { kind: "task_complete", severity: "info" };
  if (type.includes("turn_context")) return { kind: "turn_context", severity: "info" };
  if (type.includes("reasoning")) return { kind: "reasoning", severity: "info" };
  if (type.includes("token") || type.includes("usage")) return { kind: "token_snapshot", severity: "info" };
  if (type.includes("tool_result") || type.includes("function_call_output")) return { kind: "tool_result", severity: "info" };
  if (type.includes("tool_call") || type.includes("function_call")) return { kind: "tool_call", severity: "info" };
  if (type.includes("agent_launch") || type.includes("spawn")) return { kind: "agent_launch", severity: "info" };
  if (type.includes("agent_wait") || type.includes("wait")) return { kind: "agent_wait", severity: "info" };
  if (role === "user") return { kind: "user_message", severity: "info" };
  if (role === "assistant") return { kind: "assistant_message", severity: "info" };
  if (role === "agent") return { kind: "agent_message", severity: "info" };
  if (type.includes("user")) return { kind: "user_message", severity: "info" };
  if (type.includes("assistant")) return { kind: "assistant_message", severity: "info" };
  if (type.includes("agent")) return { kind: "agent_message", severity: "info" };
  return { kind: "warning", severity: "warning" };
};

const knownEventType = (record: JsonRecord) => {
  const type = eventType(record);
  const role = stringValue(record.role, nestedMessage(record)?.role)?.toLowerCase();
  const level = stringValue(record.level, record.severity)?.toLowerCase();
  if (level === "error" || level === "warn" || level === "warning") return true;
  if (role === "user" || role === "assistant" || role === "agent") return true;
  return [
    "task_started",
    "task_complete",
    "task_completed",
    "session_started",
    "session_finished",
    "thread_started",
    "thread_completed",
    "turn_context",
    "reasoning",
    "token_count",
    "token_snapshot",
    "usage",
    "tool_result",
    "function_call_output",
    "tool_call",
    "function_call",
    "agent_launch",
    "agent_spawn",
    "agent_wait",
    "message",
  ].some((known) => type.includes(known));
};

const makeEvent = (record: JsonRecord, options: ParseRolloutOptions, sourceLine: number, index: number): TimelineEvent => {
  const timestamp = isoTimestamp(record, sourceLine);
  const { kind, severity } = classify(record);
  const callId = callIdFromRecord(record);
  const toolName = toolNameFromRecord(record);
  const output = outputFromRecord(record);
  const outputBytes = numberValue(record.outputBytes, record.output_bytes, Buffer.byteLength(output ?? "", "utf8"));
  const exitCode = numberValue(record.exitCode, record.exit_code, nestedPayload(record).exit_code);
  const durationMs = numberValue(record.durationMs, record.duration_ms, nestedPayload(record).duration_ms);

  let previewText = previewFromRecord(record);
  if (!knownEventType(record)) {
    previewText = `Unknown rollout event ${rawEventType(record)}: ${previewText}`;
  }
  if (kind === "token_snapshot") {
    const snapshot = tokenSnapshotFromRecord(record, timestamp);
    if (snapshot) {
      previewText = `tokens total=${snapshot.total.toLocaleString("en-US")} input=${snapshot.input.toLocaleString("en-US")} output=${snapshot.output.toLocaleString("en-US")} cached=${snapshot.cachedInput.toLocaleString("en-US")}`;
    }
  } else if ((kind === "tool_call" || kind === "agent_launch") && toolName) {
    previewText = `${toolName} ${redactedPreview(argsFromRecord(record))}`.trim();
  } else if ((kind === "tool_result" || kind === "agent_wait") && toolName) {
    previewText = `${toolName} completed${exitCode !== undefined ? ` with exit ${exitCode}` : ""}`;
  } else if (kind === "agent_launch") {
    previewText = redactedPreview({
      childThreadId: stringValue(record.child_thread_id, record.childThreadId, nestedPayload(record).child_thread_id),
      nickname: stringValue(record.agent_nickname, record.agentNickname, nestedPayload(record).agent_nickname),
      role: stringValue(record.agent_role, record.agentRole, nestedPayload(record).agent_role),
    });
  } else if (kind === "agent_wait") {
    previewText = redactedPreview({
      childThreadId: stringValue(record.child_thread_id, record.childThreadId, nestedPayload(record).child_thread_id),
      status: stringValue(record.status, nestedPayload(record).status),
    });
  }

  return {
    id: `${options.threadId}:${sourceLine}:${index}`,
    threadId: options.threadId,
    timestamp,
    turnId: stringValue(record.turn_id, record.turnId, nestedPayload(record).turn_id, nestedPayload(record).turnId),
    sourceLine,
    kind,
    severity: exitCode && exitCode !== 0 ? "error" : severity,
    previewText,
    callId,
    toolName,
    argumentsPreview: argsFromRecord(record) === undefined ? undefined : redactedPreview(argsFromRecord(record)),
    outputPreview: output === undefined ? undefined : redactedPreview(output, 1200),
    outputBytes,
    exitCode,
    durationMs,
    isCollapsedByDefault: (outputBytes ?? 0) > LARGE_OUTPUT_COLLAPSE_BYTES,
    hasRawAvailable: output !== undefined,
    rawPreview: output === undefined ? undefined : redactedPreview(output, 4000),
  };
};

export const parseRolloutLines = (lines: string[], options: ParseRolloutOptions): CachedRolloutFacts => {
  const events: TimelineEvent[] = [];
  const warnings: string[] = [];
  const toolCallsById = new Map<string, CachedToolCall>();
  const tokenSnapshots: TokenSnapshot[] = [];
  const startingLine = options.startingLine ?? 1;

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

    const event = makeEvent(record, options, sourceLine, events.length);
    if (!knownEventType(record)) {
      warnings.push(`line ${sourceLine}: unknown rollout event ${rawEventType(record)}`);
    }

    if (event.callId && !event.toolName) {
      event.toolName = toolCallsById.get(event.callId)?.toolName;
    }

    events.push(event);

    const snapshot = event.kind === "token_snapshot" ? tokenSnapshotFromRecord(record, event.timestamp) : undefined;
    if (snapshot) tokenSnapshots.push(snapshot);

    if (event.callId && event.toolName && (event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "agent_launch" || event.kind === "agent_wait")) {
      const existing = toolCallsById.get(event.callId) ?? {
        callId: event.callId,
        toolName: event.toolName,
      };
      existing.toolName = existing.toolName || event.toolName;
      if (event.kind === "tool_call" || event.kind === "agent_launch") {
        existing.startedAt = event.timestamp;
        existing.argumentsPreview = event.argumentsPreview;
      } else {
        existing.completedAt = event.timestamp;
        existing.outputPreview = event.outputPreview;
        existing.outputBytes = event.outputBytes;
        existing.exitCode = event.exitCode;
      }
      toolCallsById.set(event.callId, existing);
    }
  });

  return {
    threadId: options.threadId,
    rolloutPath: options.rolloutPath,
    parserVersion: ROLLOUT_PARSER_VERSION,
    sourceMtimeMs: options.sourceMtimeMs,
    sourceSizeBytes: options.sourceSizeBytes,
    parsedThroughByte: options.parsedThroughByte ?? options.sourceSizeBytes,
    events,
    toolCalls: [...toolCallsById.values()],
    tokenSnapshots,
    warnings,
  };
};
