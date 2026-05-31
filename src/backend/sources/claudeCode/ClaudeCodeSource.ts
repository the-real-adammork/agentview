import { stat } from "node:fs/promises";

import type {
  CachedRolloutFacts,
  PageOptions,
  SessionFilter,
  SessionSummary,
} from "../../../shared/contracts";
import { readJsonlLines } from "../../rollout/jsonlStream";
import type { ResolvedSession, SessionSource, SourceHealth, SourceTailResult } from "../SessionSource";
import { resolveClaudeSessionPath } from "./claudePaths";
import { deriveClaudeMeta } from "./claudeMeta";
import { discoverClaudeSessions, type DiscoveredClaudeSession } from "./discovery";
import { parseClaudeSessionLines } from "./parseClaudeSession";
import { enumerateSubagents, linkSubagents, openChildCount, subagentsToChildSummaries } from "./subagents";

/**
 * Thrown by the CC `SessionSource` methods that are deferred to later phases.
 * `parse` → Phase 4 (timeline), `listChildren` → Phase 5 (agent graph),
 * `tail` → Phase 6 (live tail). The timeline handler's existing error mapping
 * surfaces this as a typed failure until the owning phase lands.
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
 * A `SessionSource` backed by Claude Code transcripts on disk. Discovery + metadata
 * are real this phase (`getHealth`/`listSessions`/`getSession`/`resolveSession`);
 * `parse`/`listChildren`/`tail` throw the typed `ClaudeCodeNotImplementedError`
 * until their owning phase lands. Discovery is stateless filesystem reads, so the
 * source holds no resources and `close()` is a no-op.
 */
export const createClaudeCodeSource = ({ projectsDir }: { projectsDir: string }): SessionSource => {
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
      const sourceStat = await stat(resolved.rawLogPath);
      const { lines } = await readJsonlLines(resolved.rawLogPath);
      return parseClaudeSessionLines(lines, {
        threadId: resolved.sessionId,
        rolloutPath: resolved.rawLogPath,
        sourceMtimeMs: sourceStat.mtimeMs,
        sourceSizeBytes: sourceStat.size,
      });
    },

    async listChildren(rootSessionId: string, scanDepth: number): Promise<SessionSummary[]> {
      const discovered = await findDiscovered(rootSessionId);
      if (!discovered) return [];
      const entries = await enumerateSubagents(discovered.subagentsDir);
      if (entries.length === 0) return [];
      const linked = await linkSubagents(rootSessionId, discovered.transcriptPath, entries, scanDepth);
      return subagentsToChildSummaries(linked);
    },

    async tail(): Promise<SourceTailResult> {
      throw new ClaudeCodeNotImplementedError("tail", 6);
    },

    async close(): Promise<void> {
      // No held resources — discovery is stateless filesystem reads.
    },
  };
};
