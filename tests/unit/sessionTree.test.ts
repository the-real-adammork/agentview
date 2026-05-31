import { describe, expect, it } from "vitest";

import type { SessionSummary } from "../../src/shared/contracts";
import {
  buildSessionRows,
  flattenAgentTree,
  groupSessionsByRepo,
  indexSessions,
  rootOf,
  sessionRepoName,
} from "../../src/frontend/views/sessionTree";

const session = (overrides: Partial<SessionSummary> & Pick<SessionSummary, "id">): SessionSummary => ({
  source: "codex",
  title: overrides.id,
  status: "complete",
  updatedAt: "2026-05-26T18:00:00.000Z",
  branch: "main",
  cwd: "/code/alpha",
  model: "gpt-codex-5",
  lastMessage: "",
  childCount: 0,
  openChildCount: 0,
  tokenTotal: 0,
  ...overrides,
});

describe("sessionTree helpers", () => {
  describe("rootOf", () => {
    it("walks parentId up to the topmost ancestor", () => {
      const a = session({ id: "a", parentId: null });
      const b = session({ id: "b", parentId: "a" });
      const c = session({ id: "c", parentId: "b" });
      const index = indexSessions([a, b, c]);

      expect(rootOf(c, index).id).toBe("a");
      expect(rootOf(b, index).id).toBe("a");
      expect(rootOf(a, index).id).toBe("a");
    });

    it("treats a session whose parent is absent as its own root (orphan sub-agent)", () => {
      const orphan = session({ id: "orphan", parentId: "missing" });
      const index = indexSessions([orphan]);

      expect(rootOf(orphan, index).id).toBe("orphan");
    });
  });

  describe("sessionRepoName", () => {
    it("prefers repoLabel, falling back to the cwd basename", () => {
      expect(sessionRepoName(session({ id: "a", repoLabel: "workflowkit" }))).toBe("workflowkit");
      expect(sessionRepoName(session({ id: "b", repoLabel: undefined, cwd: "/code/beta" }))).toBe("beta");
    });
  });

  describe("groupSessionsByRepo", () => {
    it("groups by the root parent's repo, nests sub-agents, and aggregates", () => {
      const root = session({
        id: "root",
        parentId: null,
        repoLabel: "alpha",
        cwd: "/code/alpha",
        tokenTotal: 100,
        openChildCount: 1,
        warningCount: 2,
      });
      const sub = session({
        id: "sub",
        parentId: "root",
        repoLabel: "alpha",
        tokenTotal: 50,
        threadSource: "subagent",
      });
      const other = session({ id: "other", parentId: null, repoLabel: "beta", cwd: "/code/beta", tokenTotal: 7 });

      const groups = groupSessionsByRepo([root, sub, other]);

      expect(groups.map((group) => group.repoName)).toEqual(["alpha", "beta"]);
      const alpha = groups.find((group) => group.repoName === "alpha")!;
      expect(alpha.sessionCount).toBe(2);
      expect(alpha.totalTokens).toBe(150);
      expect(alpha.openChildren).toBe(1);
      expect(alpha.warnings).toBe(2);
      expect(alpha.roots).toHaveLength(1);
      expect(alpha.roots[0].root.id).toBe("root");
      expect(alpha.roots[0].subs.map((s) => s.id)).toEqual(["sub"]);
    });
  });

  describe("buildSessionRows", () => {
    it("orders parents first with sub-agents nested, pulling in the parent of a matched sub", () => {
      const root = session({ id: "root", parentId: null, updatedAt: "2026-05-26T18:05:00.000Z" });
      const sub = session({ id: "sub", parentId: "root", updatedAt: "2026-05-26T18:01:00.000Z" });
      const unrelated = session({ id: "unrelated", parentId: null, updatedAt: "2026-05-26T18:09:00.000Z" });

      // Only the sub matches the predicate; its parent must still appear so the tree connects.
      const rows = buildSessionRows([root, sub, unrelated], (candidate) => candidate.id === "sub");

      expect(rows.map((row) => [row.session.id, row.depth, row.matched])).toEqual([
        ["root", 0, false],
        ["sub", 1, true],
      ]);
    });

    it("assigns true tree depth so sub-sub-agents are depth 2, nested under their parent", () => {
      const root = session({ id: "root", parentId: null, createdAtMs: 1 });
      const sub = session({ id: "sub", parentId: "root", createdAtMs: 2 });
      const subSub = session({ id: "subSub", parentId: "sub", createdAtMs: 3 });
      const sibling = session({ id: "sibling", parentId: "root", createdAtMs: 4 });

      const rows = buildSessionRows([sibling, subSub, sub, root], () => true);

      // Depth-first, spawn-ordered: root → sub → subSub → sibling, with true depths.
      expect(rows.map((row) => [row.session.id, row.depth])).toEqual([
        ["root", 0],
        ["sub", 1],
        ["subSub", 2],
        ["sibling", 1],
      ]);
    });
  });

  describe("flattenAgentTree", () => {
    it("flattens the whole tree rooted at the current session's root, ordered by spawn time and depth", () => {
      const a = session({ id: "a", parentId: null, createdAtMs: 1 });
      const b = session({ id: "b", parentId: "a", createdAtMs: 2 });
      const c = session({ id: "c", parentId: "b", createdAtMs: 3 });
      const d = session({ id: "d", parentId: "a", createdAtMs: 4 });

      // Called from a deep sub-agent — should still root at "a" and show every node.
      const rows = flattenAgentTree(c, [d, c, b, a]);

      expect(rows.map((row) => [row.session.id, row.depth])).toEqual([
        ["a", 0],
        ["b", 1],
        ["c", 2],
        ["d", 1],
      ]);
    });
  });
});
