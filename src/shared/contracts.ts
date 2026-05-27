export type ApiSource = "fixture" | "state-db" | "rollout-cache" | "logs-db";

export type ApiResult<T> =
  | {
      ok: true;
      data: T;
      source: ApiSource;
      warnings: string[];
    }
  | {
      ok: false;
      error: ApiError;
      source: ApiSource;
      warnings: string[];
    };

export interface ApiError {
  code: string;
  message: string;
  detail?: string;
}

export type SessionStatus = "running" | "complete" | "failed" | "paused";

export interface HealthStatus {
  status: "ok" | "unavailable";
  mode: "fixture" | "real";
  checkedAt: string;
  stateDb?: {
    readOnly: boolean;
    supported: boolean;
    tables: string[];
  };
}

export type ThreadSource = "user" | "subagent";
export type CountStatus = "not_requested" | "loading" | "ready" | "unavailable";
export type FailedToolCountStatus = CountStatus | "unknown";
export type ArchivedFilter = "include" | "exclude" | "only";

export interface SessionFilter {
  search?: string;
  cwd?: string;
  archived?: ArchivedFilter;
  threadSource?: ThreadSource;
  agentRole?: string;
  model?: string;
  minTokens?: number;
  maxTokens?: number;
  warningCountStatus?: CountStatus;
  failedToolCountStatus?: FailedToolCountStatus;
  updatedAfterMs?: number;
  updatedBeforeMs?: number;
  createdAfterMs?: number;
  createdBeforeMs?: number;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  status: SessionStatus;
  updatedAt: string;
  branch: string;
  cwd: string;
  model: string;
  lastMessage: string;
  childCount: number;
  openChildCount: number;
  tokenTotal: number;
  rolloutPath?: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  repoLabel?: string;
  titlePreview?: string;
  firstUserMessagePreview?: string;
  preview?: string;
  reasoningEffort?: string | null;
  tokensUsed?: number;
  threadSource?: ThreadSource | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  gitSha?: string | null;
  gitBranch?: string | null;
  gitOriginUrlPreview?: string | null;
  archived?: boolean;
  warningCountStatus?: CountStatus;
  warningCount?: number | null;
  failedToolCountStatus?: FailedToolCountStatus;
  failedToolCount?: number | null;
}

export type TimelineEventKind =
  | "task_started"
  | "task_complete"
  | "turn_context"
  | "user_message"
  | "assistant_message"
  | "agent_message"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "token_snapshot"
  | "agent_launch"
  | "agent_wait"
  | "warning"
  | "parse_error";

export type EventSeverity = "info" | "warning" | "error";

export interface TimelineEvent {
  id: string;
  threadId: string;
  timestamp: string;
  turnId?: string;
  sourceLine: number;
  kind: TimelineEventKind;
  severity: EventSeverity;
  previewText: string;
  callId?: string;
  toolName?: string;
  argumentsPreview?: string;
  outputPreview?: string;
  outputBytes?: number;
  exitCode?: number;
  durationMs?: number;
  isCollapsedByDefault?: boolean;
  hasRawAvailable?: boolean;
  rawPreview?: string;
}

export interface CachedToolCall {
  callId: string;
  toolName: string;
  startedAt?: string;
  completedAt?: string;
  argumentsPreview?: string;
  outputPreview?: string;
  outputBytes?: number;
  exitCode?: number;
}

export interface CachedRolloutFacts {
  threadId: string;
  rolloutPath: string;
  parserVersion: number;
  sourceMtimeMs: number;
  sourceSizeBytes: number;
  parsedThroughByte: number;
  events: TimelineEvent[];
  toolCalls: CachedToolCall[];
  tokenSnapshots: TokenSnapshot[];
  warnings: string[];
}

export interface TimelinePayload {
  threadId: string;
  events: TimelineEvent[];
  facts: CachedRolloutFacts;
  nextByteOffset: number;
  cacheStatus: "cold" | "warm" | "stale" | "corrupt" | "tail";
}

export type AgentEdgeStatus = "open" | "closed" | "failed";

export interface AgentNode {
  id: string;
  title: string;
  status: SessionStatus;
  depth: number;
  tokenTotal: number;
  nickname?: string;
  role?: string;
  finalReportPreview?: string;
  metadataMissing?: boolean;
}

export interface AgentEdge {
  parentId: string;
  childId: string;
  status: AgentEdgeStatus;
}

export interface AgentGraph {
  root: AgentNode;
  nodes: AgentNode[];
  edges: AgentEdge[];
  maxDepth: number;
  truncatedDepth: boolean;
  openCount: number;
  statusSummary: {
    open: number;
    closed: number;
    failed?: number;
  };
}

export interface TokenSnapshot {
  timestamp: string;
  total: number;
  input: number;
  output: number;
  cachedInput: number;
  reasoningOutput?: number;
  contextUtilization?: number;
  rateLimitPrimaryPercent?: number;
  rateLimitSecondaryPercent?: number;
  resetAt?: string;
}

export interface TokenSeries {
  snapshots: TokenSnapshot[];
  totals: {
    input: number;
    cachedInput: number;
    output: number;
    reasoningOutput: number;
    total: number;
  };
  cachedInputRatio?: number;
  latestContextUtilization?: number;
  peakContextUtilization?: number;
  rateLimitPrimaryPercent?: number;
  rateLimitSecondaryPercent?: number;
  resetAt?: string;
  emptyStateReasons: string[];
}

export type RuntimeLogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface RuntimeLog {
  id: string;
  timestampMs: number;
  level: RuntimeLogLevel;
  target: string;
  bodyPreview: string;
  modulePath?: string;
  file?: string;
  line?: number;
  threadId?: string;
  processUuid?: string;
  estimatedBytes: number;
  redactionApplied: boolean;
}

export interface ObservatoryApi {
  getHealth(): Promise<ApiResult<HealthStatus>>;
  listSessions(filter?: SessionFilter, page?: PageOptions): Promise<ApiResult<SessionSummary[]>>;
  getThread?(threadId: string): Promise<ApiResult<SessionSummary>>;
  getTimeline(threadId: string, options?: { fromByte?: number }): Promise<ApiResult<TimelinePayload>>;
  getAgentGraph(rootThreadId: string, options?: { maxDepth?: number }): Promise<ApiResult<AgentGraph>>;
  getTokenSeries(threadId: string): Promise<ApiResult<TokenSeries>>;
  queryLogs(): Promise<ApiResult<RuntimeLog[]>>;
}
