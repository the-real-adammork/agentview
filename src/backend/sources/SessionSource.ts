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
