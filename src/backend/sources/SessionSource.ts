import type {
  CachedRolloutFacts,
  PageOptions,
  SessionFilter,
  SessionSummary,
  TimelineEvent,
} from "../../shared/contracts";

/**
 * Discriminates which tool produced a session. Declared here in Phase 1 because
 * `src/shared/contracts.ts` does not yet carry it; Phase 2 relocates this exact
 * union into contracts and has this module import it (no rename).
 */
export type SourceId = "codex" | "claude-code";

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
