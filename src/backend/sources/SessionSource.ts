import type {
  CachedRolloutFacts,
  PageOptions,
  SessionFilter,
  SessionSummary,
  SourceId,
  TimelineEvent,
  TokenSeries,
} from "../../shared/contracts";
import type { RolloutCacheStatus } from "../cache/rolloutCache";

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

/**
 * What the timeline handler needs from a single parsed session: the normalized
 * facts, the cache status, and any parse warnings.
 */
export interface TimelineParse {
  facts: CachedRolloutFacts;
  status: RolloutCacheStatus;
  warnings: string[];
}

/** Incremental tail result for the timeline GET (`fromByte`) path. */
export interface TimelineTail {
  events: TimelineEvent[];
  nextByteOffset: number;
  warnings: string[];
}

/**
 * A source-internal capability (NOT on the locked `SessionSource`) the timeline
 * handler narrows the dispatched source to, mirroring `LiveTailSource` /
 * `AgentGraphRowSource`. It carries the three primitives that genuinely differ per
 * source — cache-keyed parse, incremental tail, and child resolution — so the
 * timeline handler dispatches every source through ONE uniform path with no
 * `if (source)` branch and no concrete-source cast.
 */
export interface TimelineSource {
  /** Parse a resolved session through the source's parser-version-keyed cache. */
  parseCached(resolved: ResolvedSession): Promise<TimelineParse>;
  /**
   * Incrementally tail a resolved session from `fromByte`, continuing source-line
   * numbering from `fromEventLine` so streamed events keep ascending line numbers.
   */
  tailParsed(resolved: ResolvedSession, fromByte: number, fromEventLine: number): Promise<TimelineTail>;
  /** Resolve a child (from `listChildren`) to a `ResolvedSession` for the +SUBS subtree merge. */
  resolveChild(child: SessionSummary): Promise<ResolvedSession>;
}

/**
 * A source-internal capability for the live token feed. Only sources that back a
 * live token series implement it (Codex, via the rollout cache + `deriveTokenSeries`);
 * the live path narrows the dispatched source to it, so it pushes a `tokens` frame
 * with no `if (codex)` discriminator — a source without the capability simply gets
 * no live token feed.
 */
export interface LiveTokenSource {
  liveTokenSeries(resolved: ResolvedSession): Promise<TokenSeries>;
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
