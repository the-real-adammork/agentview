import { stat } from "node:fs/promises";

import type {
  CachedRolloutFacts,
  PageOptions,
  SessionFilter,
  SessionSummary,
} from "../../../shared/contracts";
import { getRolloutFactsWithCache } from "../../cache/rolloutCache";
import { resolveCodexHome } from "../../codexPaths";
import { readJsonlLines } from "../../rollout/jsonlStream";
import type { AgentGraphRow, AgentGraphRowSource } from "../agentGraphRow";
import type {
  LiveTailResult,
  LiveTailSource,
  ResolvedSession,
  SessionSource,
  SourceHealth,
  SourceTailResult,
  TimelineParse,
  TimelineSource,
  TimelineTail,
} from "../SessionSource";
import { countLinesBefore, tailClaudeTranscript } from "./claudeTail";
import { resolveClaudeSessionPath } from "./claudePaths";
import { deriveClaudeMeta } from "./claudeMeta";
import { discoverClaudeSessions, type DiscoveredClaudeSession } from "./discovery";
import { CLAUDE_PARSER_VERSION, parseClaudeSessionLines } from "./parseClaudeSession";
import {
  buildAgentGraphRows,
  enumerateSubagents,
  linkSubagents,
  openChildCount,
  subagentsToChildSummaries,
} from "./subagents";

/**
 * The concrete `ClaudeCodeSource` is the cross-source `SessionSource` plus the
 * source-internal `AgentGraphRowSource` capability (`getAgentGraphRows`) the
 * `/api/agent-graph` + `+SUBS` timeline handlers dispatch through generically. Per
 * Planning decision #3, `getAgentGraphRows` is NOT widened onto the locked
 * `SessionSource` interface — it stays a source capability, mirroring `CodexSource`.
 *
 * `tailLive` is the source-internal tail variant the live path (`liveSources.ts`)
 * uses: it carries the running `fromLine` counter and exposes the richer
 * `truncated`/`warnings` fields the live `timeline` frame needs (the public
 * `tail` exposes only the locked `SourceTailResult`). Mirrors `CodexSource.tailRaw`.
 */
export interface ClaudeCodeSource extends SessionSource, AgentGraphRowSource, LiveTailSource, TimelineSource {}

/**
 * Thrown by CC `SessionSource` methods that were deferred to later phases. As of
 * Phase 6 every method (`parse`/`listChildren`/`tail`) is implemented, so this is
 * retained only for the typed-error contract the timeline handler's error mapping
 * expects (and any source method a future phase chooses to defer behind it).
 */
export class ClaudeCodeNotImplementedError extends Error {
  code = "CC_NOT_IMPLEMENTED" as const;
  method: string;
  phase: 4 | 5 | 6;

  constructor(method: string, phase: 4 | 5 | 6) {
    super(`Claude Code ${method} is not implemented until phase ${phase}.`);
    this.name = "ClaudeCodeNotImplementedError";
    this.method = method;
    this.phase = phase;
  }
}

const updatedAtMsOf = (session: SessionSummary): number =>
  typeof session.updatedAtMs === "number" && Number.isFinite(session.updatedAtMs) ? session.updatedAtMs : 0;

const createdAtMsOf = (session: SessionSummary): number =>
  typeof session.createdAtMs === "number" && Number.isFinite(session.createdAtMs) ? session.createdAtMs : 0;

/**
 * Pure filter predicate mirroring the Codex `StateStore.listSessions` semantics so
 * CC filtering matches Codex filtering behavior: archived (CC rows are always
 * `archived:false`), cwd (exact), threadSource (CC roots are `"user"`),
 * agentRole, model (exact), token floor/ceiling, the updated/created windows, and
 * a substring search over title/firstUserMessagePreview/id.
 */
const matchesFilter = (session: SessionSummary, filter: SessionFilter): boolean => {
  const archived = filter.archived ?? "exclude";
  if (archived === "only") return false; // CC rows are never archived.

  if (filter.cwd?.trim() && session.cwd !== filter.cwd.trim()) return false;

  if (filter.threadSource && session.threadSource !== filter.threadSource) return false;

  if (filter.agentRole && session.agentRole !== filter.agentRole) return false;

  if (filter.model && session.model !== filter.model) return false;

  const tokens = session.tokensUsed ?? session.tokenTotal ?? 0;
  if (filter.minTokens !== undefined && tokens < filter.minTokens) return false;
  if (filter.maxTokens !== undefined && tokens > filter.maxTokens) return false;

  if (filter.warningCountStatus && filter.warningCountStatus !== "not_requested") return false;
  if (filter.failedToolCountStatus && filter.failedToolCountStatus !== "unknown") return false;

  if (filter.updatedAfterMs !== undefined && updatedAtMsOf(session) < filter.updatedAfterMs) return false;
  if (filter.updatedBeforeMs !== undefined && updatedAtMsOf(session) > filter.updatedBeforeMs) return false;
  if (filter.createdAfterMs !== undefined && createdAtMsOf(session) < filter.createdAfterMs) return false;
  if (filter.createdBeforeMs !== undefined && createdAtMsOf(session) > filter.createdBeforeMs) return false;

  const search = filter.search?.trim();
  if (search) {
    const needle = search.toLowerCase();
    const haystack = [session.title, session.firstUserMessagePreview ?? "", session.preview ?? "", session.id]
      .join("\n")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
};

/**
 * A `SessionSource` backed by Claude Code transcripts on disk. As of Phase 6 every
 * method is real: `getHealth`/`listSessions`/`getSession`/`resolveSession` (Phase 3),
 * `parse` (Phase 4), `listChildren`/`getAgentGraphRows` (Phase 5), and
 * `tail`/`tailLive` (Phase 6). Discovery is stateless filesystem reads, so the
 * source holds no resources and `close()` is a no-op.
 */
export const createClaudeCodeSource = ({ projectsDir }: { projectsDir: string }): ClaudeCodeSource => {
  const findDiscovered = async (sessionId: string): Promise<DiscoveredClaudeSession | null> => {
    const discovered = await discoverClaudeSessions(projectsDir);
    return discovered.find((session) => session.sessionId === sessionId) ?? null;
  };

  /**
   * Enrich a root `SessionSummary` with `childCount`/`openChildCount` from the same
   * `subagents/` enumeration `listChildren` uses. Best-effort: an absent/unreadable
   * `subagents/` dir leaves the derived counts (childCount from discovery, 0 open).
   */
  const withChildCounts = async (
    summary: SessionSummary,
    discovered: DiscoveredClaudeSession,
  ): Promise<SessionSummary> => {
    const entries = await enumerateSubagents(discovered.subagentsDir);
    if (entries.length === 0) return summary;
    return { ...summary, childCount: entries.length, openChildCount: openChildCount(entries) };
  };

  // The raw transcript → facts parse, factored out so both `parse` (locked
  // SessionSource) and `parseCached` (TimelineSource) share one implementation.
  const parseSession = async (resolved: ResolvedSession): Promise<CachedRolloutFacts> => {
    const sourceStat = await stat(resolved.rawLogPath);
    const { lines } = await readJsonlLines(resolved.rawLogPath);
    return parseClaudeSessionLines(lines, {
      threadId: resolved.sessionId,
      rolloutPath: resolved.rawLogPath,
      sourceMtimeMs: sourceStat.mtimeMs,
      sourceSizeBytes: sourceStat.size,
    });
  };

  // CC has no Codex state DB; reuse the resolved Codex home only as the on-disk
  // cache scratch root (under `.observatory`, overridable via AGENTVIEW_CACHE_ROOT),
  // memoized per source instance. CC cache entries are keyed by CLAUDE_PARSER_VERSION
  // so they never read a Codex cache entry as fresh (or vice-versa).
  let cacheRootPromise: Promise<string> | null = null;
  const getCacheRoot = (): Promise<string> => (cacheRootPromise ??= resolveCodexHome());

  const parseCached = async (resolved: ResolvedSession): Promise<TimelineParse> => {
    const cacheRoot = await getCacheRoot();
    const cached = await getRolloutFactsWithCache({
      codexHome: cacheRoot,
      threadId: resolved.sessionId,
      rolloutPath: resolved.rawLogPath,
      parserVersion: CLAUDE_PARSER_VERSION,
      parse: () => parseSession(resolved),
    });
    return { facts: cached.facts, status: cached.status, warnings: cached.warnings };
  };

  return {
    id: "claude-code",

    async getHealth(): Promise<SourceHealth> {
      try {
        await stat(projectsDir);
        return { source: "claude-code", available: true };
      } catch (error) {
        return {
          source: "claude-code",
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]> {
      const discovered = await discoverClaudeSessions(projectsDir);
      const summaries = await Promise.all(
        discovered.map(async (session) => withChildCounts(await deriveClaudeMeta(session), session)),
      );

      const filtered = filter ? summaries.filter((summary) => matchesFilter(summary, filter)) : summaries;
      filtered.sort((left, right) => updatedAtMsOf(right) - updatedAtMsOf(left));

      const offset = page?.offset ?? 0;
      const limit = page?.limit;
      return limit === undefined ? filtered.slice(offset) : filtered.slice(offset, offset + limit);
    },

    async getSession(sessionId: string): Promise<SessionSummary | null> {
      const discovered = await findDiscovered(sessionId);
      if (!discovered) return null;
      return withChildCounts(await deriveClaudeMeta(discovered), discovered);
    },

    async resolveSession(sessionId: string): Promise<ResolvedSession> {
      const discovered = await findDiscovered(sessionId);
      if (!discovered) {
        const error = new Error(`Claude Code session not found: ${sessionId}`);
        error.name = "ClaudeSessionNotFoundError";
        throw error;
      }

      // Validate the transcript path stays inside the projects root (traversal guard).
      const relPath = discovered.transcriptPath.startsWith(`${projectsDir}/`)
        ? discovered.transcriptPath.slice(projectsDir.length + 1)
        : discovered.transcriptPath;
      await resolveClaudeSessionPath(projectsDir, relPath);

      return {
        source: "claude-code",
        sessionId,
        rawLogPath: discovered.transcriptPath,
        extra: { subagentsDir: discovered.subagentsDir },
      };
    },

    async parse(resolved: ResolvedSession): Promise<CachedRolloutFacts> {
      return parseSession(resolved);
    },

    // --- TimelineSource capability: same uniform dispatch as Codex. CC parses
    // through getRolloutFactsWithCache keyed by CLAUDE_PARSER_VERSION, so the
    // timeline handler needs no CC-specific branch. CC does NOT implement
    // LiveTokenSource — live tokens stay Codex-only via the capability check. ---

    parseCached,

    async tailParsed(resolved: ResolvedSession, fromByte: number, fromEventLine: number): Promise<TimelineTail> {
      const result = await tailClaudeTranscript({
        path: resolved.rawLogPath,
        sessionId: resolved.sessionId,
        fromByte,
        fromLine: fromEventLine,
      });
      return { events: result.events, nextByteOffset: result.nextByte, warnings: result.warnings };
    },

    async resolveChild(child: SessionSummary): Promise<ResolvedSession> {
      // CC sub-agent transcripts live under the root's `subagents/` dir and are not
      // top-level discoverable, so `resolveSession(childId)` would 404. `listChildren`
      // already carries the absolute child transcript path (from our own enumeration,
      // inside CLAUDE_PROJECTS_DIR), so build the ResolvedSession directly from it.
      if (!child.rolloutPath) {
        const error = new Error(`Claude Code child session has no transcript path: ${child.id}`);
        error.name = "ClaudeSessionNotFoundError";
        throw error;
      }
      return { source: "claude-code", sessionId: child.id, rawLogPath: child.rolloutPath };
    },

    async listChildren(rootSessionId: string, scanDepth: number): Promise<SessionSummary[]> {
      const discovered = await findDiscovered(rootSessionId);
      if (!discovered) return [];
      const entries = await enumerateSubagents(discovered.subagentsDir);
      if (entries.length === 0) return [];
      const linked = await linkSubagents(rootSessionId, discovered.transcriptPath, entries, scanDepth);
      return subagentsToChildSummaries(linked);
    },

    // Source-internal capability (AgentGraphRowSource), NOT on the cross-source
    // SessionSource interface. The /api/agent-graph + +SUBS timeline handlers narrow
    // the dispatched source to AgentGraphRowSource and call this generically. CC
    // derives rows from subagents/*.meta.json + the parent Task tool_use join.
    async getAgentGraphRows(rootSessionId: string, scanDepth: number): Promise<AgentGraphRow[]> {
      const discovered = await findDiscovered(rootSessionId);
      if (!discovered) {
        const error = new Error(`Claude Code session not found: ${rootSessionId}`);
        error.name = "ClaudeSessionNotFoundError";
        throw error;
      }
      const root = await withChildCounts(await deriveClaudeMeta(discovered), discovered);
      return buildAgentGraphRows(root, discovered.transcriptPath, discovered.subagentsDir, scanDepth);
    },

    // Source-internal live tail: the running `fromLine` is supplied by the caller
    // (the live path computes it via `countLinesBefore`, mirroring Codex) and the
    // richer `truncated`/`warnings` flow into the `timeline` frame's `reset`/`warnings`.
    async tailLive(resolved: ResolvedSession, fromByte: number, fromLine: number): Promise<LiveTailResult> {
      return tailClaudeTranscript({
        path: resolved.rawLogPath,
        sessionId: resolved.sessionId,
        fromByte,
        fromLine,
      });
    },

    async tail(resolved: ResolvedSession, fromByte: number): Promise<SourceTailResult> {
      // A bare public call self-derives `fromLine` so it is consistent without the
      // live path's running counter: 1 + the count of complete lines before fromByte.
      const fromLine = 1 + (await countLinesBefore(resolved.rawLogPath, fromByte));
      const result = await tailClaudeTranscript({
        path: resolved.rawLogPath,
        sessionId: resolved.sessionId,
        fromByte,
        fromLine,
      });
      // The public shape is exactly the locked three fields — drop truncated/warnings.
      return { events: result.events, nextByte: result.nextByte, nextLine: result.nextLine };
    },

    async close(): Promise<void> {
      // No held resources — discovery is stateless filesystem reads.
    },
  };
};
