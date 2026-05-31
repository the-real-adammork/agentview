import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type {
  CachedRolloutFacts,
  PageOptions,
  SessionFilter,
  SessionSummary,
  TokenSeries,
} from "../../../shared/contracts";
import { getRolloutFactsWithCache, type RolloutCacheResult } from "../../cache/rolloutCache";
import { parseRolloutFile } from "../../rollout/jsonlStream";
import { deriveTokenSeries } from "../../rollout/tokenSeries";
import { openStateStore, type AgentGraphRow, type StateStore, type StateStoreHealth } from "../../sqlite/stateStore";
import { tailRolloutFile, type TailRolloutResult } from "../../tail/liveTail";
import type {
  LiveTailResult,
  LiveTailSource,
  LiveTokenSource,
  ResolvedSession,
  SessionSource,
  SourceHealth,
  SourceTailResult,
  TimelineParse,
  TimelineSource,
  TimelineTail,
} from "../SessionSource";

/**
 * Path resolution for a Codex rollout, replicated verbatim from the timeline
 * handler (`resolveRolloutPath`) so `CodexSource` stays a self-contained wrapper
 * without importing the handler (which would create an import cycle once the
 * handler imports `CodexSource`). Same traversal guard, same error names.
 */
const resolveRolloutPath = async (codexHome: string, rolloutPath: string) => {
  if (!rolloutPath.trim()) {
    throw new Error("Thread has no rollout_path.");
  }

  const resolved = isAbsolute(rolloutPath) ? resolve(rolloutPath) : resolve(codexHome, rolloutPath);
  const relativeToHome = relative(codexHome, resolved);
  if (relativeToHome.startsWith("..") || isAbsolute(relativeToHome)) {
    const error = new Error("Thread rollout_path resolves outside CODEX_HOME.");
    error.name = "RolloutPathTraversalError";
    throw error;
  }

  try {
    await access(resolved);
  } catch {
    const error = new Error("Thread rollout file is not readable.");
    error.name = "RolloutNotFoundError";
    throw error;
  }
  return resolved;
};

/**
 * A `SessionSource` that delegates to the existing Codex primitives — the
 * read-only state store, the rollout facts cache, the rollout parser, and the
 * live tail reader — with zero behavior change. The store handle is opened
 * lazily and memoized so repeated calls reuse one connection; `close()` disposes
 * it and a later call reopens it.
 */
export const createCodexSource = ({ codexHome }: { codexHome: string }): CodexSource => {
  let storePromise: Promise<StateStore> | null = null;

  const getStore = (): Promise<StateStore> => {
    if (!storePromise) {
      storePromise = openStateStore({ codexHome });
    }
    return storePromise;
  };

  const resolveSession = async (sessionId: string): Promise<ResolvedSession> => {
    const store = await getStore();
    const thread = await store.getThread(sessionId);
    if (!thread?.rolloutPath) {
      const error = new Error("Thread rollout file is not readable.");
      error.name = "RolloutNotFoundError";
      throw error;
    }
    const rawLogPath = await resolveRolloutPath(codexHome, thread.rolloutPath);
    return { source: "codex", sessionId, rawLogPath };
  };

  const parseWithCache = async (resolved: ResolvedSession): Promise<RolloutCacheResult> => {
    return getRolloutFactsWithCache({
      codexHome,
      threadId: resolved.sessionId,
      rolloutPath: resolved.rawLogPath,
      parse: (sourceMtimeMs, sourceSizeBytes) =>
        parseRolloutFile(resolved.rawLogPath, {
          threadId: resolved.sessionId,
          rolloutPath: resolved.rawLogPath,
          sourceMtimeMs,
          sourceSizeBytes,
        }),
    });
  };

  const tailRaw = async (resolved: ResolvedSession, fromByte: number, sourceLine: number): Promise<TailRolloutResult> =>
    tailRolloutFile({
      path: resolved.rawLogPath,
      threadId: resolved.sessionId,
      fromByte,
      sourceLine,
    });

  return {
    id: "codex",

    async getHealth(): Promise<SourceHealth> {
      try {
        const store = await getStore();
        await store.getHealth();
        return { source: "codex", available: true };
      } catch (error) {
        // A failed open leaves no usable store; clear the memo so a later call
        // re-attempts instead of resolving the rejected promise again.
        storePromise = null;
        return {
          source: "codex",
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]> {
      const store = await getStore();
      return store.listSessions(filter, page);
    },

    async getSession(sessionId: string): Promise<SessionSummary | null> {
      const store = await getStore();
      return store.getThread(sessionId);
    },

    resolveSession,

    async parse(resolved: ResolvedSession): Promise<CachedRolloutFacts> {
      const cached = await parseWithCache(resolved);
      return cached.facts;
    },

    async listChildren(rootSessionId: string, scanDepth: number): Promise<SessionSummary[]> {
      const store = await getStore();
      const rows = await store.getAgentGraphRows(rootSessionId, scanDepth);
      const descendantIds = [
        ...new Set(
          rows
            .map((row) => row.childThreadId)
            .filter((id): id is string => Boolean(id) && id !== rootSessionId),
        ),
      ];
      const children: SessionSummary[] = [];
      for (const id of descendantIds) {
        const session = await store.getThread(id);
        if (session) {
          children.push(session);
        }
      }
      return children;
    },

    async tail(resolved: ResolvedSession, fromByte: number): Promise<SourceTailResult> {
      const facts = await this.parse(resolved);
      const sourceLine = facts.events.length + 1;
      const tail = await tailRaw(resolved, fromByte, sourceLine);
      return {
        events: tail.payload.events,
        nextByte: tail.payload.nextByteOffset,
        nextLine: sourceLine + tail.linesRead,
      };
    },

    async close(): Promise<void> {
      if (storePromise) {
        const pending = storePromise;
        storePromise = null;
        try {
          const store = await pending;
          await store.close();
        } catch {
          // A store that never opened cleanly has nothing to dispose.
        }
      }
    },

    // --- Codex-internal accessors (NOT part of the cross-source SessionSource
    // interface). They expose the richer Codex shapes the handlers need to keep
    // byte-identical responses in Phase 1: the agent-graph rows feeding
    // deriveAgentGraph, the full cache result (status + warnings) for the
    // timeline cold path, the underlying schema for the health body, and the
    // full tail result (truncated + warnings) for the timeline tail path. Phase
    // 2+ generalizes/relocates these as needed. ---

    async getAgentGraphRows(rootThreadId: string, scanDepth: number): Promise<AgentGraphRow[]> {
      const store = await getStore();
      return store.getAgentGraphRows(rootThreadId, scanDepth);
    },

    async parseWithCache(resolved: ResolvedSession): Promise<RolloutCacheResult> {
      return parseWithCache(resolved);
    },

    async tailRaw(resolved: ResolvedSession, fromByte: number, sourceLine: number): Promise<TailRolloutResult> {
      return tailRaw(resolved, fromByte, sourceLine);
    },

    // Source-generic live tail (LiveTailSource): wraps `tailRolloutFile` and maps
    // its `TailRolloutResult` onto the uniform `LiveTailResult` the live path
    // consumes for every source. Byte-identical to the direct `tailRolloutFile`
    // call the live path made before Phase 6 — same events/offset/truncated/warnings.
    async tailLive(resolved: ResolvedSession, fromByte: number, fromLine: number): Promise<LiveTailResult> {
      const tail = await tailRaw(resolved, fromByte, fromLine);
      return {
        events: tail.payload.events,
        nextByte: tail.payload.nextByteOffset,
        nextLine: (tail.truncated ? 1 : fromLine) + tail.linesRead,
        truncated: tail.truncated,
        warnings: tail.warnings,
      };
    },

    async stateDbSchema(): Promise<StateStoreHealth["schema"]> {
      const store = await getStore();
      const health = await store.getHealth();
      return health.schema;
    },

    // --- TimelineSource capability: the three primitives the timeline handler
    // dispatches through uniformly for every source (no `if (source)`, no
    // `as CodexSource` cast). Each wraps an existing Codex primitive 1:1. ---

    async parseCached(resolved: ResolvedSession): Promise<TimelineParse> {
      const cached = await parseWithCache(resolved);
      return { facts: cached.facts, status: cached.status, warnings: cached.warnings };
    },

    async tailParsed(resolved: ResolvedSession, fromByte: number, fromEventLine: number): Promise<TimelineTail> {
      const tail = await tailRaw(resolved, fromByte, fromEventLine);
      return {
        events: tail.payload.events,
        nextByteOffset: tail.payload.nextByteOffset,
        warnings: tail.warnings,
      };
    },

    resolveChild(child: SessionSummary): Promise<ResolvedSession> {
      // Codex children are top-level threads in the same state DB — resolve by id
      // (validates + absolutizes the rollout path, same as a root request).
      return resolveSession(child.id);
    },

    // --- LiveTokenSource capability: the Codex live token series. CC has no Codex
    // tokens DB, so it does not implement this and the live path skips its token
    // feed via the capability check (no `if (codex)`). ---

    async liveTokenSeries(resolved: ResolvedSession): Promise<TokenSeries> {
      const cached = await parseWithCache(resolved);
      return deriveTokenSeries(cached.facts);
    },
  };
};

/**
 * The concrete `CodexSource` is the cross-source `SessionSource` plus a small set
 * of Codex-internal accessors used only by the Codex API handlers (never the
 * cross-source registry). Keeping them on a distinct type means the handlers can
 * reach the richer Codex shapes without widening the locked `SessionSource`.
 */
export interface CodexSource extends SessionSource, LiveTailSource, TimelineSource, LiveTokenSource {
  getAgentGraphRows(rootThreadId: string, scanDepth: number): Promise<AgentGraphRow[]>;
  parseWithCache(resolved: ResolvedSession): Promise<RolloutCacheResult>;
  tailRaw(resolved: ResolvedSession, fromByte: number, sourceLine: number): Promise<TailRolloutResult>;
  stateDbSchema(): Promise<StateStoreHealth["schema"]>;
}

/**
 * Runtime guard narrowing a dispatched source to the concrete `CodexSource` so a
 * Codex-only consumer (e.g. the health endpoint reporting the Codex state-db
 * schema) reaches the Codex-internal accessors without an `as CodexSource` cast.
 */
export const isCodexSource = (value: unknown): value is CodexSource =>
  typeof (value as Partial<CodexSource>).stateDbSchema === "function" &&
  typeof (value as Partial<CodexSource>).parseWithCache === "function";
