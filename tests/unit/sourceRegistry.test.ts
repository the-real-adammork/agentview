import { describe, expect, it, vi } from "vitest";

import { createSourceRegistry } from "../../src/backend/sources/registry";
import type {
  ResolvedSession,
  SessionSource,
  SourceHealth,
  SourceTailResult,
} from "../../src/backend/sources/SessionSource";
import type {
  CachedRolloutFacts,
  SessionSummary,
  SourceId,
} from "../../src/shared/contracts";

const summary = (id: string, source: SourceId, updatedAtMs: number): SessionSummary => ({
  id,
  source,
  title: id,
  status: "complete",
  updatedAt: new Date(updatedAtMs).toISOString(),
  branch: "",
  cwd: "/repo",
  model: "",
  lastMessage: "",
  childCount: 0,
  openChildCount: 0,
  tokenTotal: 0,
  updatedAtMs,
});

interface FakeSourceOptions {
  id: SourceId;
  sessions: SessionSummary[];
  health?: SourceHealth;
}

const createFakeSource = ({ id, sessions, health }: FakeSourceOptions) => {
  const closeSpy = vi.fn(async () => undefined);
  const listSpy = vi.fn(async (): Promise<SessionSummary[]> => sessions);
  const source: SessionSource = {
    id,
    async getHealth(): Promise<SourceHealth> {
      return health ?? { source: id, available: true };
    },
    listSessions: listSpy,
    async getSession(sessionId: string): Promise<SessionSummary | null> {
      return sessions.find((session) => session.id === sessionId) ?? null;
    },
    async resolveSession(sessionId: string): Promise<ResolvedSession> {
      return { source: id, sessionId, rawLogPath: `/tmp/${sessionId}.jsonl` };
    },
    async parse(): Promise<CachedRolloutFacts> {
      throw new Error("not used in registry tests");
    },
    async listChildren(): Promise<SessionSummary[]> {
      return [];
    },
    async tail(): Promise<SourceTailResult> {
      return { events: [], nextByte: 0, nextLine: 1 };
    },
    close: closeSpy,
  };
  return { source, closeSpy, listSpy };
};

describe("createSourceRegistry", () => {
  it("get returns the matching source and throws a typed error naming the unknown id", () => {
    const codex = createFakeSource({ id: "codex", sessions: [] });
    const cc = createFakeSource({ id: "claude-code", sessions: [] });
    const registry = createSourceRegistry([codex.source, cc.source]);

    expect(registry.get("codex")).toBe(codex.source);
    expect(registry.get("claude-code")).toBe(cc.source);
    expect(() => registry.get("unknown" as SourceId)).toThrowError(/unknown/);
  });

  it("has reflects registration", () => {
    const cc = createFakeSource({ id: "claude-code", sessions: [] });
    const registry = createSourceRegistry([cc.source]);

    expect(registry.has("claude-code")).toBe(true);
    expect(registry.has("git" as SourceId)).toBe(false);
  });

  it("all returns the sources in registration order", () => {
    const codex = createFakeSource({ id: "codex", sessions: [] });
    const cc = createFakeSource({ id: "claude-code", sessions: [] });
    const registry = createSourceRegistry([codex.source, cc.source]);

    expect(registry.all()).toEqual([codex.source, cc.source]);
  });

  it("listSessions with no filter fans out across all sources and merges by updatedAtMs desc", async () => {
    const codex = createFakeSource({
      id: "codex",
      sessions: [summary("codex-old", "codex", 1_000), summary("codex-new", "codex", 5_000)],
    });
    const cc = createFakeSource({
      id: "claude-code",
      sessions: [summary("cc-mid", "claude-code", 3_000), summary("cc-newest", "claude-code", 9_000)],
    });
    const registry = createSourceRegistry([codex.source, cc.source]);

    const merged = await registry.listSessions();
    expect(merged.map((session) => session.id)).toEqual(["cc-newest", "codex-new", "cc-mid", "codex-old"]);
  });

  it("listSessions with filter.source delegates to that single source (no fan-out)", async () => {
    const codex = createFakeSource({ id: "codex", sessions: [summary("codex-1", "codex", 1_000)] });
    const cc = createFakeSource({ id: "claude-code", sessions: [summary("cc-1", "claude-code", 9_000)] });
    const registry = createSourceRegistry([codex.source, cc.source]);

    const rows = await registry.listSessions({ source: "codex" });
    expect(rows.map((session) => session.id)).toEqual(["codex-1"]);
    expect(codex.listSpy).toHaveBeenCalledTimes(1);
    expect(cc.listSpy).not.toHaveBeenCalled();
  });

  it("getHealth aggregates one entry per source", async () => {
    const codex = createFakeSource({ id: "codex", sessions: [], health: { source: "codex", available: true } });
    const cc = createFakeSource({
      id: "claude-code",
      sessions: [],
      health: { source: "claude-code", available: false, detail: "not implemented" },
    });
    const registry = createSourceRegistry([codex.source, cc.source]);

    expect(await registry.getHealth()).toEqual([
      { source: "codex", available: true },
      { source: "claude-code", available: false, detail: "not implemented" },
    ]);
  });

  it("close closes every source", async () => {
    const codex = createFakeSource({ id: "codex", sessions: [] });
    const cc = createFakeSource({ id: "claude-code", sessions: [] });
    const registry = createSourceRegistry([codex.source, cc.source]);

    await registry.close();
    expect(codex.closeSpy).toHaveBeenCalledTimes(1);
    expect(cc.closeSpy).toHaveBeenCalledTimes(1);
  });
});
