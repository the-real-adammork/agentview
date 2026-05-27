import type {
  CachedRolloutFacts,
  CachedToolCall,
  EventSeverity,
  TimelineEvent,
  TimelineEventKind,
  TokenSnapshot,
} from "../../shared/contracts";
import { maskPreviewSecrets } from "../../shared/redaction";

export const ROLLOUT_PARSER_VERSION = 2;
export const LARGE_OUTPUT_COLLAPSE_BYTES = 4 * 1024;

type JsonRecord = Record<string, unknown>;
type MutableTimelineEvent = TimelineEvent & {
  commandPreview?: string;
  failureReasonPreview?: string;
  resultEventId?: string;
  outputTokenCount?: number;
  agentStatus?: "open" | "closed" | "failed";
};

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

const parseJsonObject = (value: unknown) => {
  if (!stringValue(value)) return undefined;
  try {
    const parsed = JSON.parse(value as string) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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

const topLevelType = (record: JsonRecord) =>
  stringValue(record.type, record.kind, record.event, record.name)?.toLowerCase().replace(/[.-]/g, "_");

const isObservedEnvelope = (record: JsonRecord) => {
  const type = topLevelType(record);
  return type === "event_msg" || type === "response_item";
};

const normalizedEventType = (record: JsonRecord) => {
  const payload = isRecord(record.payload) ? record.payload : undefined;
  const type = isObservedEnvelope(record)
    ? stringValue(payload?.type, payload?.kind, payload?.event, payload?.name, record.kind, record.event, record.name)
    : stringValue(record.type, record.kind, record.event, record.name, payload?.type);
  return type?.toLowerCase().replace(/[.-]/g, "_") ?? "unknown";
};

const eventType = normalizedEventType;

const rawEventType = (record: JsonRecord) =>
  stringValue(
    isObservedEnvelope(record) && isRecord(record.payload) ? record.payload.type : undefined,
    record.type,
    record.kind,
    record.event,
    record.name,
  ) ?? "unknown";

const nestedMessage = (record: JsonRecord) => {
  const payload = isRecord(record.payload) ? record.payload : isRecord(record.data) ? record.data : undefined;
  const message = isRecord(record.message)
    ? record.message
    : isRecord(record.msg)
      ? record.msg
      : isRecord(payload?.message)
        ? payload.message
        : isRecord(payload?.msg)
          ? payload.msg
          : undefined;
  return message;
};

const nestedPayload = (record: JsonRecord) => {
  const payload = isRecord(record.payload) ? record.payload : undefined;
  const data = isRecord(record.data) ? record.data : undefined;
  return payload ?? data ?? record;
};

const textFromContentItems = (value: unknown) => {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;

  const textItems = value
    .map((item) => {
      if (!isRecord(item)) return undefined;
      return stringValue(item.text, item.content, item.output_text, item.input_text);
    })
    .filter((item): item is string => Boolean(item));
  return textItems.length ? textItems.join(" ") : undefined;
};

const previewFromRecord = (record: JsonRecord) => {
  const message = nestedMessage(record);
  const payload = nestedPayload(record);
  const content = stringValue(
    record.preview,
    record.text,
    record.body,
    record.task,
    record.last_agent_message,
    message?.content,
    message?.text,
    payload.preview,
    payload.text,
    payload.body,
    payload.task,
    payload.last_agent_message,
  );

  if (content) return redactedPreview(content);

  const contentItems =
    textFromContentItems(record.content) ??
    textFromContentItems(message?.content) ??
    textFromContentItems(message?.items) ??
    textFromContentItems(payload.content) ??
    textFromContentItems(payload.items);
  if (contentItems) return redactedPreview(contentItems);

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

const argsFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  return record.arguments ?? record.args ?? record.params ?? payload.arguments ?? payload.args ?? payload.params;
};

const argsObjectFromRecord = (record: JsonRecord) => {
  const args = argsFromRecord(record);
  if (isRecord(args)) return args;
  return parseJsonObject(args);
};

const commandPreviewFromRecord = (record: JsonRecord) => {
  const args = argsObjectFromRecord(record);
  return redactedPreview(stringValue(args?.cmd, args?.command, args?.shell_command));
};

const outputDetailsFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  const raw = stringValue(record.output, record.result, record.stderr, record.stdout, payload.output, payload.result, payload.stderr, payload.stdout);
  const wrapper = parseJsonObject(raw);
  const outputText = stringValue(wrapper?.output, wrapper?.stdout, wrapper?.stderr, wrapper?.result, raw);
  const exitCode = numberValue(record.exitCode, record.exit_code, payload.exitCode, payload.exit_code, wrapper?.exitCode, wrapper?.exit_code);
  const durationMs = numberValue(
    record.durationMs,
    record.duration_ms,
    payload.durationMs,
    payload.duration_ms,
    wrapper?.durationMs,
    wrapper?.duration_ms,
  );
  const outputTokenCount = numberValue(
    record.outputTokenCount,
    record.output_token_count,
    payload.outputTokenCount,
    payload.output_token_count,
    wrapper?.outputTokenCount,
    wrapper?.output_token_count,
    wrapper?.output_tokens,
  );
  return { outputText, exitCode, durationMs, outputTokenCount };
};

const childThreadIdFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  return stringValue(record.child_thread_id, record.childThreadId, payload.child_thread_id, payload.childThreadId);
};

const agentNicknameFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  return stringValue(record.agent_nickname, record.agentNickname, payload.agent_nickname, payload.agentNickname, payload.nickname);
};

const agentRoleFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  return stringValue(record.agent_role, record.agentRole, payload.agent_role, payload.agentRole, payload.role);
};

const agentTaskPreviewFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  return redactedPreview(stringValue(record.agent_task, record.task, payload.agent_task, payload.task));
};

const agentStatusFromRecord = (record: JsonRecord) => {
  const payload = nestedPayload(record);
  const status = stringValue(record.status, payload.status)?.toLowerCase();
  return status === "open" || status === "closed" || status === "failed" ? status : undefined;
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
  const lastUsage = isRecord(record.last_token_usage)
    ? record.last_token_usage
    : isRecord(payload.last_token_usage)
      ? payload.last_token_usage
      : undefined;
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
  const contextWindow = numberValue(record.context_window, record.model_context_window, payload.context_window, payload.model_context_window);

  if (total === 0 && input === 0 && output === 0 && cachedInput === 0 && reasoningOutput === undefined) {
    return undefined;
  }

  return {
    timestamp,
    total,
    input,
    output,
    cachedInput,
    lastInput: numberValue(lastUsage?.input, lastUsage?.input_tokens, lastUsage?.prompt_tokens),
    lastOutput: numberValue(lastUsage?.output, lastUsage?.output_tokens, lastUsage?.completion_tokens),
    reasoningOutput,
    modelContextWindow: contextWindow,
    planType: stringValue(record.plan_type, record.planType, payload.plan_type, payload.planType),
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
    rateLimitPrimaryPercentRaw: numberValue(usage.rateLimitPrimaryPercentRaw, usage.rate_limit_primary_percent_raw, rateLimits?.primary_percent_raw),
    rateLimitSecondaryPercentRaw: numberValue(
      usage.rateLimitSecondaryPercentRaw,
      usage.rate_limit_secondary_percent_raw,
      rateLimits?.secondary_percent_raw,
    ),
    resetAt: stringValue(usage.resetAt, usage.reset_at, rateLimits?.reset_at),
  };
};

const classify = (record: JsonRecord): { kind: TimelineEventKind; severity: EventSeverity } => {
  const type = eventType(record);
  const payload = nestedPayload(record);
  const role = stringValue(record.role, nestedMessage(record)?.role, payload.role)?.toLowerCase();
  const level = stringValue(record.level, record.severity, payload.level, payload.severity)?.toLowerCase();

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
  const payload = nestedPayload(record);
  const role = stringValue(record.role, nestedMessage(record)?.role, payload.role)?.toLowerCase();
  const level = stringValue(record.level, record.severity, payload.level, payload.severity)?.toLowerCase();
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
    "spawn_agent",
    "wait_agent",
    "message",
  ].some((known) => type.includes(known));
};

const makeEvent = (record: JsonRecord, options: ParseRolloutOptions, sourceLine: number, index: number): MutableTimelineEvent => {
  const timestamp = isoTimestamp(record, sourceLine);
  const { kind, severity } = classify(record);
  const callId = callIdFromRecord(record);
  const toolName = toolNameFromRecord(record);
  const outputDetails = outputDetailsFromRecord(record);
  const output = outputDetails.outputText;
  const outputBytes = numberValue(record.outputBytes, record.output_bytes, Buffer.byteLength(output ?? "", "utf8"));
  const exitCode = outputDetails.exitCode;
  const durationMs = outputDetails.durationMs;
  const tokenSnapshot = kind === "token_snapshot" ? tokenSnapshotFromRecord(record, timestamp) : undefined;

  let previewText = previewFromRecord(record);
  if (!knownEventType(record)) {
    previewText = `Unknown rollout event ${rawEventType(record)}: ${previewText}`;
  }
  if (kind === "token_snapshot") {
    if (tokenSnapshot) {
      previewText = `tokens total=${tokenSnapshot.total.toLocaleString("en-US")} input=${tokenSnapshot.input.toLocaleString("en-US")} output=${tokenSnapshot.output.toLocaleString("en-US")} cached=${tokenSnapshot.cachedInput.toLocaleString("en-US")}`;
    }
  } else if ((kind === "tool_call" || kind === "agent_launch") && toolName) {
    previewText = `${toolName} ${redactedPreview(argsFromRecord(record))}`.trim();
  } else if ((kind === "tool_result" || kind === "agent_wait") && toolName) {
    previewText = `${toolName} completed${exitCode !== undefined ? ` with exit ${exitCode}` : ""}`;
  } else if (kind === "agent_launch") {
    previewText = redactedPreview({
      childThreadId: childThreadIdFromRecord(record),
      nickname: agentNicknameFromRecord(record),
      role: agentRoleFromRecord(record),
    });
  } else if (kind === "agent_wait") {
    previewText =
      previewFromRecord(record) ||
      redactedPreview({
        childThreadId: childThreadIdFromRecord(record),
        status: agentStatusFromRecord(record),
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
    childThreadId: childThreadIdFromRecord(record),
    agentNickname: agentNicknameFromRecord(record),
    agentRole: agentRoleFromRecord(record),
    agentTaskPreview: agentTaskPreviewFromRecord(record),
    tokenSnapshot,
    isCollapsedByDefault: (outputBytes ?? 0) > LARGE_OUTPUT_COLLAPSE_BYTES,
    hasRawAvailable: output !== undefined,
    rawPreview: output === undefined ? undefined : redactedPreview(output, 4000),
    commandPreview: commandPreviewFromRecord(record),
    outputTokenCount: outputDetails.outputTokenCount,
    agentStatus: agentStatusFromRecord(record),
  };
};

const millisBetween = (start?: string, end?: string) => {
  if (!start || !end) return undefined;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs ? endMs - startMs : undefined;
};

const deriveFacts = (events: MutableTimelineEvent[]) => {
  const calls = events.filter((event) => event.kind === "tool_call" && event.callId);
  const resultsByCallId = new Map(
    events
      .filter((event) => event.kind === "tool_result" && event.callId)
      .map((event) => [event.callId as string, event]),
  );

  const toolCalls = calls.map((call) => {
    const result = resultsByCallId.get(call.callId as string);
    if (result && !result.toolName) result.toolName = call.toolName;
    const durationMs = result?.durationMs ?? millisBetween(call.timestamp, result?.timestamp);
    if (result) {
      call.joinedOutputPreview = result.outputPreview;
      call.joinedExitCode = result.exitCode;
      call.joinedDurationMs = durationMs;
      call.resultEventId = result.id;
      call.outputTokenCount = result.outputTokenCount;
      if (result.exitCode !== undefined && result.exitCode !== 0) {
        call.severity = "error";
        call.failureReasonPreview = result.outputPreview;
      }
    }

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
      failureReasonPreview: result?.exitCode !== undefined && result.exitCode !== 0 ? result.outputPreview : undefined,
      commandPreview: call.commandPreview,
      outputTokenCount: result?.outputTokenCount,
    } satisfies CachedToolCall;
  });

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
  const agentWaits = events
    .filter((event) => event.kind === "agent_wait")
    .map((event) => ({
      callId: event.callId ?? event.id,
      childThreadId: event.childThreadId,
      timestamp: event.timestamp,
      status: event.agentStatus,
      reportPreview: event.previewText,
    }));

  const eventsByTurn = new Map<string, MutableTimelineEvent[]>();
  for (const event of events) {
    if (!event.turnId) continue;
    eventsByTurn.set(event.turnId, [...(eventsByTurn.get(event.turnId) ?? []), event]);
  }
  const turns = [...eventsByTurn].map(([turnId, turnEvents]) => {
    const startedAt = turnEvents.find((event) => event.kind === "task_started")?.timestamp ?? turnEvents[0]?.timestamp;
    const completedAt = [...turnEvents].reverse().find((event) => event.kind === "task_complete")?.timestamp ?? turnEvents.at(-1)?.timestamp;
    const lastToken = [...turnEvents].reverse().find((event) => event.tokenSnapshot)?.tokenSnapshot;
    const lastAgentMessagePreview = [...turnEvents]
      .reverse()
      .find((event) => event.kind === "task_complete" || event.kind === "agent_message" || event.kind === "assistant_message")
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

export const parseRolloutLines = (lines: string[], options: ParseRolloutOptions): CachedRolloutFacts => {
  const events: MutableTimelineEvent[] = [];
  const warnings: string[] = [];
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

    events.push(event);
  });

  const { toolCalls, tokenSnapshots, agentLaunches, agentWaits, turns } = deriveFacts(events);

  return {
    threadId: options.threadId,
    rolloutPath: options.rolloutPath,
    parserVersion: ROLLOUT_PARSER_VERSION,
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
