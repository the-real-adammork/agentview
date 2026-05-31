import type {
  CachedRolloutFacts,
  PageOptions,
  SessionFilter,
  SessionSummary,
  SourceId,
  TimelineEvent,
} from "../../shared/contracts";

/**
 * `SourceId` is declared in `src/shared/contracts.ts` (relocated there in Phase 2
 * from this module — same exact union, no rename). Re-exported here so existing
 * imports of `SourceId` from `SessionSource` keep resolving.
 */
export type { SourceId };

export interface SourceHealth {
  source: SourceId;
  available: boolean;
  detail?: string;
}

export interface ResolvedSession {
  source: SourceId;
  sessionId: string;
  /** Absolute path to the primary transcript. */
  rawLogPath: string;
  /** Source-specific, opaque (CC: { subagentsDir }). */
  extra?: Record<string, unknown>;
}

export interface SourceTailResult {
  events: TimelineEvent[];
  nextByte: number;
  nextLine: number;
}

/**
 * The richer tail result the LIVE path needs (vs. the locked public `tail`): it
 * carries the running line continuation (`nextLine`), the `truncated` flag the
 * `timeline` frame maps to `reset`, and parser `warnings`. The caller supplies the
 * running `fromLine` so streamed events keep ascending source-line numbers across
 * tails (the same invariant Codex's `tailRolloutFile`/`sourceLine` preserves).
 */
export interface LiveTailResult {
  events: TimelineEvent[];
  nextByte: number;
  nextLine: number;
  truncated: boolean;
  warnings: string[];
}

/**
 * A source-internal capability (NOT on the locked `SessionSource`) the live path
 * narrows the dispatched source to, mirroring `AgentGraphRowSource`. Both
 * `CodexSource` (wrapping `tailRolloutFile`) and `ClaudeCodeSource` (wrapping
 * `tailClaudeTranscript`) satisfy it, so `liveSources.ts` tails any source with no
 * `if (codex)` branch.
 */
export interface LiveTailSource {
  tailLive(resolved: ResolvedSession, fromByte: number, fromLine: number): Promise<LiveTailResult>;
}

export interface SessionSource {
  readonly id: SourceId;
  getHealth(): Promise<SourceHealth>;
  listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSummary | null>;
  resolveSession(sessionId: string): Promise<ResolvedSession>;
  parse(resolved: ResolvedSession): Promise<CachedRolloutFacts>;
  listChildren(rootSessionId: string, scanDepth: number): Promise<SessionSummary[]>;
  tail(resolved: ResolvedSession, fromByte: number): Promise<SourceTailResult>;
  close(): Promise<void>;
}
