import type { PageOptions, SessionFilter, SessionSummary, SourceId } from "../../shared/contracts";
import type { SessionSource, SourceHealth } from "./SessionSource";

export interface ResolvedSessionSource {
  source: SessionSource;
  session: SessionSummary;
}

export interface SourceRegistry {
  get(source: SourceId): SessionSource; // throws on unknown source
  has(source: SourceId): boolean;
  all(): SessionSource[];
  findSession(sessionId: string, preferredSource?: SourceId): Promise<ResolvedSessionSource | null>;
  listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]>; // fan-out + merge by updatedAtMs desc
  getHealth(): Promise<SourceHealth[]>;
  close(): Promise<void>;
}

const updatedAtMsOf = (session: SessionSummary): number =>
  typeof session.updatedAtMs === "number" && Number.isFinite(session.updatedAtMs) ? session.updatedAtMs : 0;

/**
 * Holds the registered `SessionSource`s and dispatches by an explicit `(source, id)`
 * composite key. A `Map<SourceId, SessionSource>` keyed by `source.id` preserves
 * registration order (insertion order). The merged `listSessions` fans out across
 * every source and re-sorts by `updatedAtMs` desc; a single `filter.source`
 * narrows to one delegate with no fan-out.
 */
export const createSourceRegistry = (sources: SessionSource[]): SourceRegistry => {
  const byId = new Map<SourceId, SessionSource>();
  for (const source of sources) {
    byId.set(source.id, source);
  }

  const all = (): SessionSource[] => [...byId.values()];

  const get = (source: SourceId): SessionSource => {
    const found = byId.get(source);
    if (!found) {
      throw new Error(`Unknown source: ${source}`);
    }
    return found;
  };

  return {
    get,
    has(source: SourceId): boolean {
      return byId.has(source);
    },
    all,
    async findSession(sessionId: string, preferredSource?: SourceId): Promise<ResolvedSessionSource | null> {
      const candidates = preferredSource ? [get(preferredSource)] : all();
      const errors: unknown[] = [];
      const checkedSources: SessionSource[] = [];
      for (const source of candidates) {
        try {
          const session = await source.getSession(sessionId);
          if (session) return { source, session };
          checkedSources.push(source);
        } catch (error) {
          // A source can be temporarily unavailable (for example, an absent Codex
          // state DB in a Claude Code-only test run). Keep probing the other
          // registered sources so source-less ids still resolve when possible.
          errors.push(error);
        }
      }
      for (const source of checkedSources) {
        if ((await source.getHealth()).available) {
          return null;
        }
      }
      if (errors.length > 0) {
        throw errors[0];
      }
      return null;
    },
    async listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]> {
      if (filter?.source) {
        return get(filter.source).listSessions(filter, page);
      }

      const lists = await Promise.all(all().map((source) => source.listSessions(filter, page)));
      const merged = lists
        .flat()
        .sort((left, right) => updatedAtMsOf(right) - updatedAtMsOf(left));

      const offset = page?.offset ?? 0;
      const limit = page?.limit;
      return limit === undefined ? merged.slice(offset) : merged.slice(offset, offset + limit);
    },
    async getHealth(): Promise<SourceHealth[]> {
      return Promise.all(all().map((source) => source.getHealth()));
    },
    async close(): Promise<void> {
      await Promise.all(all().map((source) => source.close()));
    },
  };
};
