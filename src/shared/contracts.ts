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
  status: "ok";
  mode: "fixture" | "real";
  checkedAt: string;
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
}

export interface AgentNode {
  id: string;
  title: string;
  status: SessionStatus;
  depth: number;
  tokenTotal: number;
  nickname?: string;
  role?: string;
  finalReportPreview?: string;
}

export interface AgentEdge {
  parentId: string;
  childId: string;
  status: "open" | "closed" | "failed";
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
  listSessions(): Promise<ApiResult<SessionSummary[]>>;
  getTimeline(threadId: string): Promise<ApiResult<TimelineEvent[]>>;
  getAgentGraph(rootThreadId: string): Promise<ApiResult<AgentGraph>>;
  getTokenSeries(threadId: string): Promise<ApiResult<TokenSeries>>;
  queryLogs(): Promise<ApiResult<RuntimeLog[]>>;
}
