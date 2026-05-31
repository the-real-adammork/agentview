import { describe, expect, it } from "vitest";

import type {
  ResolvedSession,
  SessionSource,
  SourceHealth,
  SourceTailResult,
} from "../../src/backend/sources/SessionSource";
import type {
  CachedRolloutFacts,
  PageOptions,
  SessionFilter,
  SessionSummary,
  TimelineEvent,
} from "../../src/shared/contracts";

// Compile-time conformance: these aliases only resolve if the adapter types have
// exactly the locked shape. A drift in any field surfaces as a typecheck failure.
type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// SourceHealth: { source: SourceId; available: boolean; detail?: string }
const _healthShape: AssertExact<
  SourceHealth,
  { source: "codex" | "claude-code"; available: boolean; detail?: string }
> = true;

// ResolvedSession: { source; sessionId; rawLogPath; extra? }
const _resolvedShape: AssertExact<
  ResolvedSession,
  {
    source: "codex" | "claude-code";
    sessionId: string;
    rawLogPath: string;
    extra?: Record<string, unknown>;
  }
> = true;

// SourceTailResult: { events: TimelineEvent[]; nextByte: number; nextLine: number }
const _tailShape: AssertExact<
  SourceTailResult,
  { events: TimelineEvent[]; nextByte: number; nextLine: number }
> = true;

// A literal that exercises every method signature on the interface. Each
// parameter is referenced so the body proves the declared signature compiles.
const _shape: SessionSource = {
  id: "codex",
  async getHealth(): Promise<SourceHealth> {
    return { source: "codex", available: true };
  },
  async listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]> {
    void filter;
    void page;
    return [];
  },
  async getSession(sessionId: string): Promise<SessionSummary | null> {
    void sessionId;
    return null;
  },
  async resolveSession(sessionId: string): Promise<ResolvedSession> {
    return { source: "codex", sessionId, rawLogPath: "/tmp/x.jsonl" };
  },
  async parse(resolved: ResolvedSession): Promise<CachedRolloutFacts> {
    void resolved;
    return {} as CachedRolloutFacts;
  },
  async listChildren(rootSessionId: string, scanDepth: number): Promise<SessionSummary[]> {
    void rootSessionId;
    void scanDepth;
    return [];
  },
  async tail(resolved: ResolvedSession, fromByte: number): Promise<SourceTailResult> {
    void resolved;
    void fromByte;
    const events: TimelineEvent[] = [];
    return { events, nextByte: 0, nextLine: 1 };
  },
  async close(): Promise<void> {
    /* no-op */
  },
};

describe("SessionSource contract", () => {
  it("declares the locked adapter shapes and method signatures", () => {
    expect(_healthShape).toBe(true);
    expect(_resolvedShape).toBe(true);
    expect(_tailShape).toBe(true);
    expect(_shape.id).toBe("codex");
  });
});
