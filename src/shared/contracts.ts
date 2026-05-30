export type ApiSource = "fixture" | "state-db" | "rollout-cache" | "logs-db" | "raw-log" | "client";

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
/** How confident we are in a reconstructed (non-codex) parent edge. */
export type EdgeConfidence = "certain" | "high" | "medium" | "low";
/** Which signal produced a reconstructed parent edge. */
export type EdgeVia = "marker" | "run-id" | "cwd-time";
/** Origin of a parent edge: codex's own spawn record vs. agentview's reconstruction. */
export type EdgeSource = "codex" | "reconstructed";
export type CountStatus = "not_requested" | "loading" | "ready" | "unavailable";
export type FailedToolCountStatus = CountStatus | "unknown";
export type ArchivedFilter = "include" | "exclude" | "only";

export interface SessionFilter {
  search?: string;
  cwd?: string;
  repo?: string;
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
  /** Parent thread id when this thread was spawned as a sub-agent; null/undefined for user roots. */
  parentId?: string | null;
  /** "codex" when parentId came from thread_spawn_edges; "reconstructed" when inferred. */
  parentEdgeSource?: EdgeSource;
  /** Confidence of a reconstructed parent edge (absent for codex edges). */
  parentEdgeConfidence?: EdgeConfidence;
  /** Signal that produced a reconstructed parent edge (absent for codex edges). */
  parentEdgeVia?: EdgeVia;
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
  gitOriginUrl?: string | null;
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
  | "skill_invoke"
  | "token_snapshot"
  | "agent_launch"
  | "agent_wait"
  | "warning"
  | "parse_error";

export type EventSeverity = "info" | "warning" | "error";

/**
 * Structured `exec_command` output, classified server-side once during the
 * rollout parse and cached on the owning tool_call event. The frontend picks a
 * renderer component by `kind` and draws it — no client-side parsing. When the
 * server can't classify an output it omits `outputRender` (or sends `plain`)
 * and the UI falls back to the raw `<pre>` preview. See
 * docs/design/workflowkit-evangelion/docs/Exec Renderers Handoff.md.
 */
export type DiffLineType = "add" | "del" | "ctx";
export interface DiffLine {
  /** add · del · ctx (context). */
  t: DiffLineType;
  text: string;
}
export interface DiffHunk {
  /** The `@@ -a,b +c,d @@` header line, already extracted. */
  header: string;
  lines: DiffLine[];
}
export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}
/** `git diff` / `git show` → unified (single-column) diff. */
export interface DiffOutputRender {
  kind: "diff";
  files: DiffFile[];
}

/** `pytest` / `cargo test` / `vitest` / `go test` → pass/fail summary. */
export interface TestsOutputRender {
  kind: "tests";
  passed: number;
  failed: number;
  skipped: number;
  durationMs?: number;
  /** Fully-qualified failing test names; empty when all pass. */
  failing: string[];
}

export interface StatusFile {
  /** M | A | D | R | ?? (extend as needed; unknown → faint glyph). */
  code: string;
  path: string;
}
/** `git status --short` → file list. `files: []` means a clean tree. */
export interface StatusOutputRender {
  kind: "status";
  files: StatusFile[];
}

/** `sqlite3 -column` / columnar output → table. */
export interface TableOutputRender {
  kind: "table";
  columns: string[];
  /** May be a truncated slice of `totalRows` (server caps to a sane max). */
  rows: string[][];
  totalRows?: number;
}

export interface FileLine {
  /** The real source line number (so `sed -n '40,46p'` shows 40–46). */
  n: number;
  text: string;
}
/** `nl` / `cat` / `sed -n` / `head` → line-numbered file peek. */
export interface FileOutputRender {
  kind: "file";
  path?: string;
  startLine?: number;
  totalLines?: number;
  lines: FileLine[];
}

export interface MatchLine {
  n: number;
  text: string;
  /** `[start, end]` char offsets to emphasize within `text`; omit for no highlight. */
  col?: [number, number];
}
export interface MatchFile {
  path: string;
  matches: MatchLine[];
}
/** `rg` / `grep` → matches grouped by file. */
export interface MatchesOutputRender {
  kind: "matches";
  files: MatchFile[];
}

export interface HttpHeader {
  k: string;
  v: string;
}
/** `curl` / `wget` → request/response summary. */
export interface HttpOutputRender {
  kind: "http";
  method?: string;
  url?: string;
  /** HTTP status code; absent when the request had no response line captured (no `-i`) or failed to connect. */
  status?: number;
  statusText?: string;
  durationMs?: number;
  size?: string;
  contentType?: string;
  /** When true, the UI tints the body as JSON. */
  json?: boolean;
  headers?: HttpHeader[];
  body?: string;
  /** Transport-level failure surfaced from `curl: (N) …` when there is no HTTP response. */
  error?: string;
}

export type TreeEntryType = "dir" | "file" | "link";
export interface TreeEntry {
  name: string;
  type: TreeEntryType;
  /** Nesting depth for indentation (0 = top level). */
  depth: number;
  /** Human-readable size for files (e.g. "12 MB"). */
  size?: string;
  /** Item count for directories, when known. */
  count?: number;
}
/** `ls` / `find` / `tree` → a (optionally nested) directory listing. */
export interface TreeOutputRender {
  kind: "tree";
  /** Listing root (e.g. `tree dashboard/`); omitted for a bare `ls`/`find`. */
  root?: string;
  entries: TreeEntry[];
  /** Total entries before the server cap (entries may be a slice). */
  totalEntries?: number;
}

/** `jq` / `cat *.json` → pretty-printed, syntax-colored JSON. */
export interface JsonOutputRender {
  kind: "json";
  /** Origin label (filename), when known. */
  source?: string;
  /** Any JSON value; strings render verbatim, everything else is pretty-printed. */
  value: unknown;
}

export interface LogCommit {
  hash: string;
  author: string;
  date: string;
  subject: string;
  refs?: string[];
}
/** `git log` / `git blame` → commit history. */
export interface LogOutputRender {
  kind: "log";
  total: number;
  commits: LogCommit[];
}

export interface BuildSnippetLine {
  n: number;
  text: string;
  /** `[start, end]` columns to underline with a caret. */
  caret?: [number, number];
}
export interface BuildDiagnostic {
  severity: "error" | "warning";
  code?: string;
  file: string;
  line: number;
  col?: number;
  message: string;
  snippet?: BuildSnippetLine[];
}
/** `cargo build` / `tsc` / `go build` → compiler diagnostics. */
export interface BuildOutputRender {
  kind: "build";
  tool: string;
  errors: number;
  warnings: number;
  durationMs?: number;
  diagnostics: BuildDiagnostic[];
}

export interface LintIssue {
  severity: "error" | "warning" | "info";
  line: number;
  col: number;
  rule: string;
  message: string;
}
export interface LintFile {
  path: string;
  issues: LintIssue[];
}
/** `eslint` / `ruff` / `clippy` → linter diagnostics grouped by file. */
export interface LintOutputRender {
  kind: "lint";
  tool: string;
  errors: number;
  warnings: number;
  files: LintFile[];
}

export interface TraceFrame {
  fn: string;
  file: string;
  line: number;
  /** True for application frames (emphasized); false for library frames (dimmed). */
  user: boolean;
  code?: string;
}
/** Python traceback / Rust panic / Node error → stack trace (outermost→innermost). */
export interface TraceOutputRender {
  kind: "trace";
  lang: "python" | "rust" | "node";
  exception: string;
  message: string;
  frames: TraceFrame[];
}

export interface DiffstatFile {
  path: string;
  insertions: number;
  deletions: number;
}
export interface DiffstatTotals {
  files: number;
  insertions: number;
  deletions: number;
}
/** `git diff --stat` / `git show --stat` → changed-files summary (no hunks). */
export interface DiffstatOutputRender {
  kind: "diffstat";
  files: DiffstatFile[];
  totals?: DiffstatTotals;
}

export type GitSub = "commit" | "add" | "merge" | "worktree" | "branch";
/** `git commit` / `add` / `merge` / `worktree` / `branch` → one card, body switches on `sub`. */
export interface GitOutputRender {
  kind: "git";
  sub: GitSub;
  /** commit */
  branch?: string;
  shortSha?: string;
  subject?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  /** add */
  staged?: string[];
  /** merge */
  strategy?: string;
  fastForward?: boolean;
  conflict?: string;
  diffstat?: DiffstatOutputRender;
  /** worktree */
  path?: string;
  head?: string;
  ok?: boolean;
  error?: string;
  /** branch / rev-parse */
  sha?: string;
}

export type ComposeResourceType = "network" | "volume" | "container" | "image";
export type ComposeState =
  | "creating"
  | "created"
  | "starting"
  | "started"
  | "recreated"
  | "healthy"
  | "error";
export interface ComposeResource {
  type: ComposeResourceType;
  /** Project prefix stripped for display. */
  name: string;
  state: ComposeState;
}
/** `docker compose up` → streaming lifecycle collapsed to terminal state per resource. */
export interface ComposeOutputRender {
  kind: "compose";
  resources: ComposeResource[];
  /** Image-layer pull stream, collapsed to a single chip. */
  pull?: { layers: number; done: number };
}

/** Fallback: render the raw `<pre>` preview. */
export interface PlainOutputRender {
  kind: "plain";
}

export type OutputRender =
  | DiffOutputRender
  | TestsOutputRender
  | StatusOutputRender
  | TableOutputRender
  | FileOutputRender
  | MatchesOutputRender
  | HttpOutputRender
  | TreeOutputRender
  | JsonOutputRender
  | LogOutputRender
  | BuildOutputRender
  | LintOutputRender
  | TraceOutputRender
  | DiffstatOutputRender
  | GitOutputRender
  | ComposeOutputRender
  | PlainOutputRender;

export type OutputRenderKind = OutputRender["kind"];

/**
 * Call-side renderers: a one-line summary of a tool *invocation* (read / search /
 * fetch), classified from the call's arguments. Complementary to `outputRender`,
 * which renders the tool's result. Agent and skill invocations keep their own
 * first-class event kinds (richer than a one-liner), so they're not call-rendered.
 */
export interface ReadCallRender {
  kind: "read";
  path: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
}
/** `grep` / `search_files` — the search request (the `matches` output renders the hits). */
export interface SearchCallRender {
  kind: "search_call";
  pattern: string;
  path?: string;
  flags?: string;
  hits?: number;
}
/** `web_search` / `web_fetch`. */
export interface FetchCallRender {
  kind: "fetch";
  mode: "search" | "fetch";
  query?: string;
  url?: string;
  results?: number;
  status?: number;
}
/** `spawn_agent` / `wait_agent` / `send_input` — agent coordination. */
export interface AgentCallRender {
  kind: "agent";
  op: "spawn" | "wait" | "send";
  nickname?: string;
  role?: string;
  task?: string;
  targets?: string[];
  target?: string;
  message?: string;
  status?: string;
}
export interface ToolSearchFunction {
  name: string;
  /** First line of the function's description. */
  summary?: string;
  /** Parameter names → chips. */
  params?: string[];
}
export interface ToolSearchNamespace {
  name: string;
  description?: string;
  functions: ToolSearchFunction[];
}
/** `tool_search_call` — tool-catalog discovery (query → namespace/function tree). */
export interface ToolSearchCallRender {
  kind: "tool_search";
  query: string;
  limit?: number;
  /** Total functions across namespaces → drives "+N" overflow. */
  resultCount: number;
  namespaces: ToolSearchNamespace[];
}
export type CallRender =
  | ReadCallRender
  | SearchCallRender
  | FetchCallRender
  | AgentCallRender
  | ToolSearchCallRender;

export interface TimelineEvent {
  id: string;
  threadId: string;
  timestamp: string;
  turnId?: string;
  sourceLine: number;
  kind: TimelineEventKind;
  severity: EventSeverity;
  previewText: string;
  phase?: string;
  callId?: string;
  toolName?: string;
  argumentsPreview?: string;
  /** Extracted command line for shell-style tool calls (cmd/command/shell_command). */
  commandPreview?: string;
  outputPreview?: string;
  outputBytes?: number;
  /**
   * Structured, server-classified `exec_command` output for the rich renderers
   * (diff/tests/status/table/file/matches/http). Lives on the tool_call after
   * the call↔result join; absent (or `plain`) means render the raw preview.
   */
  outputRender?: OutputRender;
  /** Call-side one-line render for read/search/fetch tool invocations. */
  callRender?: CallRender;
  exitCode?: number;
  durationMs?: number;
  childThreadId?: string;
  agentNickname?: string;
  agentRole?: string;
  agentTaskPreview?: string;
  joinedOutputPreview?: string;
  joinedExitCode?: number;
  joinedDurationMs?: number;
  tokenSnapshot?: TokenSnapshot;
  isCollapsedByDefault?: boolean;
  hasRawAvailable?: boolean;
  rawPreview?: string;
  /** skill_invoke: the invoked skill's name (e.g. `read_pdf`). */
  skillName?: string;
  /** skill_invoke: result state driving the status chip. */
  skillStatus?: "ok" | "fail" | "running";
}

export interface TurnSummary {
  turnId: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  firstTokenMs?: number;
  model?: string;
  reasoningEffort?: string;
  sandboxPolicy?: string;
  approvalMode?: string;
  lastAgentMessagePreview?: string;
  inputTokenCount?: number;
  outputTokenCount?: number;
  totalTokenCount?: number;
}

export interface AgentLaunchFact {
  callId: string;
  childThreadId?: string;
  timestamp: string;
  nickname?: string;
  role?: string;
  taskPreview?: string;
}

export interface AgentWaitFact {
  callId: string;
  childThreadId?: string;
  timestamp: string;
  status?: AgentEdgeStatus;
  reportPreview?: string;
}

export interface RolloutSummary {
  startedAt?: string;
  completedAt?: string;
  eventCount: number;
  turnCount: number;
  toolCallCount: number;
  failedToolCallCount: number;
  tokenSnapshotCount: number;
  agentLaunchCount: number;
  agentWaitCount: number;
  warningCount: number;
  parsedThroughByte: number;
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
  durationMs?: number;
  resultEventId?: string;
  failureReasonPreview?: string;
  commandPreview?: string;
  outputTokenCount?: number;
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
  turns: TurnSummary[];
  agentLaunches: AgentLaunchFact[];
  agentWaits: AgentWaitFact[];
  summary: RolloutSummary;
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
  createdAt?: string;
  updatedAt?: string;
  sourceEdgeStatus?: AgentEdgeStatus;
  nickname?: string;
  role?: string;
  finalReportPreview?: string;
  metadataMissing?: boolean;
}

export interface AgentEdge {
  parentId: string;
  childId: string;
  status: AgentEdgeStatus;
  source?: EdgeSource;
  confidence?: EdgeConfidence;
  via?: EdgeVia;
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
  lastInput?: number;
  lastOutput?: number;
  reasoningOutput?: number;
  modelContextWindow?: number;
  planType?: string;
  contextUtilization?: number;
  rateLimitPrimaryPercent?: number;
  rateLimitSecondaryPercent?: number;
  rateLimitPrimaryPercentRaw?: number;
  rateLimitSecondaryPercentRaw?: number;
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
  timestampNanos?: number;
  level: RuntimeLogLevel;
  target: string;
  bodyPreview: string;
  modulePath?: string;
  file?: string;
  line?: number;
  threadId?: string;
  scope?: string;
  processUuid?: string;
  estimatedBytes: number;
  redactionApplied: boolean;
}

export interface RuntimeLogQuery {
  level?: RuntimeLogLevel;
  target?: string;
  threadId?: string;
  scope?: string;
  limit?: number;
  cursor?: string;
}

export interface RuntimeLogPage {
  logs: RuntimeLog[];
  nextCursor: string | null;
}

export interface RawTuiLogTail {
  fromByte: number;
  textPreview: string;
  redactionApplied: boolean;
  nextByteOffset: number;
  truncated: boolean;
}

export interface DiagnosticsSummary {
  warningCounts: {
    total: number;
    byThreadId: Record<string, number>;
    byLevel: Partial<Record<RuntimeLogLevel, number>>;
  };
  loudestTargets: Array<{
    target: string;
    totalCount: number;
    warningCount: number;
    errorCount: number;
  }>;
  failedCommands: Array<{
    threadId: string;
    toolName: string;
    command: string;
    exitCode: number;
    count: number;
    lastOutputPreview: string;
    source: "logs-db" | "rollout-cache";
  }>;
  sessionsWarningBadges: Array<{
    threadId: string;
    warningCountStatus: "ready" | "unavailable";
    warningCount: number;
    failedToolCountStatus: "ready" | "unavailable";
    failedToolCount: number;
  }>;
}

export type LiveChannel = "sessions" | "timeline" | "tokens" | "diagnostics" | "ready" | "error";

export interface LiveSessionsPayload {
  sessions: SessionSummary[];
}

export interface LiveTimelinePayload {
  threadId: string;
  events: TimelineEvent[];
  nextByteOffset: number;
  /** true when the rollout was truncated/rotated — client replaces events instead of appending. */
  reset: boolean;
  warnings: string[];
}

export interface LiveTokensPayload {
  threadId: string;
  series: TokenSeries;
}

export interface LiveDiagnosticsPayload {
  summary: DiagnosticsSummary;
  /** Log rows newer than the connection's last cursor (may be empty). */
  logs: RuntimeLog[];
}

export interface LiveReadyPayload {
  threadId: string | null;
  nextByteOffset: number | null;
  logCursorId: number | null;
}

export interface LiveErrorPayload {
  code: string;
  message: string;
  channel?: LiveChannel;
}

export interface ObservatoryApi {
  getHealth(): Promise<ApiResult<HealthStatus>>;
  listSessions(filter?: SessionFilter, page?: PageOptions): Promise<ApiResult<SessionSummary[]>>;
  getThread?(threadId: string): Promise<ApiResult<SessionSummary>>;
  getTimeline(threadId: string, options?: { fromByte?: number; subtree?: boolean }): Promise<ApiResult<TimelinePayload>>;
  getAgentGraph(rootThreadId: string, options?: { maxDepth?: number }): Promise<ApiResult<AgentGraph>>;
  getTokenSeries(threadId: string): Promise<ApiResult<TokenSeries>>;
  queryLogs(query?: RuntimeLogQuery): Promise<ApiResult<RuntimeLogPage>>;
  getDiagnosticsSummary?(options?: {
    threadIds?: string[];
    targetLimit?: number;
    /** Parse rollouts for per-thread failed-command counts (slow). Default true; the
     *  sessions-list badge call sets false to skip the 500-rollout scan. */
    includeFailedCommands?: boolean;
  }): Promise<ApiResult<DiagnosticsSummary>>;
  tailRawTuiLog?(options?: { fromByte?: number; maxBytes?: number }): Promise<ApiResult<RawTuiLogTail>>;
}
