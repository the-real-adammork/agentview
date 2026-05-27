import { describe, expect, it } from "vitest";

import { deriveAgentGraph } from "../../src/backend/api/agentGraph";
import type { AgentGraphRow } from "../../src/backend/sqlite/stateStore";

type AgentGraphRowWithTimestamps = AgentGraphRow & {
  createdAtMs: number | null;
  updatedAtMs: number | null;
};

const rows = [
  {
    id: "root-thread",
    title: "Root orchestration",
    firstUserMessage: "Coordinate phase four",
    preview: "Root preview",
    tokensUsed: 1000,
    createdAtMs: 1_000,
    updatedAtMs: 2_000,
    agentNickname: null,
    agentRole: null,
    parentThreadId: null,
    childThreadId: null,
    edgeStatus: null,
  },
  {
    id: "child-open",
    title: "Open child",
    firstUserMessage: "Implement graph",
    preview: "Working",
    tokensUsed: 200,
    createdAtMs: 1_300,
    updatedAtMs: 2_300,
    agentNickname: "graph-api",
    agentRole: "implementation",
    parentThreadId: "root-thread",
    childThreadId: "child-open",
    edgeStatus: "open",
  },
  {
    id: "child-closed",
    title: "Closed child",
    firstUserMessage: "Review graph",
    preview: "Done",
    tokensUsed: 300,
    createdAtMs: 1_100,
    updatedAtMs: 2_100,
    agentNickname: null,
    agentRole: "review",
    parentThreadId: "root-thread",
    childThreadId: "child-closed",
    edgeStatus: "closed",
  },
  {
    id: "grandchild-failed",
    title: "Failed grandchild",
    firstUserMessage: "Exercise failure path",
    preview: "Failed",
    tokensUsed: 50,
    createdAtMs: 1_400,
    updatedAtMs: 2_400,
    agentNickname: "graph-failure",
    agentRole: null,
    parentThreadId: "child-open",
    childThreadId: "grandchild-failed",
    edgeStatus: "failed",
  },
  {
    id: null,
    title: null,
    firstUserMessage: null,
    preview: null,
    tokensUsed: null,
    createdAtMs: null,
    updatedAtMs: null,
    agentNickname: null,
    agentRole: null,
    parentThreadId: "child-closed",
    childThreadId: "missing-child",
    edgeStatus: "open",
  },
] satisfies AgentGraphRowWithTimestamps[];

describe("deriveAgentGraph", () => {
  it("returns the root and direct children at depth 1 with status summary", () => {
    const graph = deriveAgentGraph("root-thread", rows, { maxDepth: 1 });

    expect(graph.root).toMatchObject({
      id: "root-thread",
      title: "Root orchestration",
      depth: 0,
      status: "complete",
      createdAt: "1970-01-01T00:00:01.000Z",
      updatedAt: "1970-01-01T00:00:02.000Z",
    });
    expect(graph.nodes.map((node) => [node.id, node.depth, node.status])).toEqual([
      ["root-thread", 0, "complete"],
      ["child-closed", 1, "complete"],
      ["child-open", 1, "running"],
    ]);
    expect(graph.edges).toEqual([
      { parentId: "root-thread", childId: "child-closed", status: "closed" },
      { parentId: "root-thread", childId: "child-open", status: "open" },
    ]);
    expect(graph.openCount).toBe(1);
    expect(graph.statusSummary).toEqual({ open: 1, closed: 1, failed: 0 });
    expect(graph.truncatedDepth).toBe(true);
  });

  it("returns depth 2 descendants and preserves missing child metadata as placeholder nodes", () => {
    const graph = deriveAgentGraph("root-thread", rows, { maxDepth: 2 });

    expect(graph.truncatedDepth).toBe(false);
    expect(graph.nodes.map((node) => [node.id, node.depth, node.status, node.metadataMissing ?? false])).toEqual([
      ["root-thread", 0, "complete", false],
      ["child-closed", 1, "complete", false],
      ["child-open", 1, "running", false],
      ["missing-child", 2, "running", true],
      ["grandchild-failed", 2, "failed", false],
    ]);
    expect(graph.nodes.find((node) => node.id === "child-open")).toMatchObject({
      createdAt: "1970-01-01T00:00:01.300Z",
      updatedAt: "1970-01-01T00:00:02.300Z",
      sourceEdgeStatus: "open",
    });
    expect(graph.nodes.find((node) => node.id === "child-closed")).toMatchObject({
      createdAt: "1970-01-01T00:00:01.100Z",
      updatedAt: "1970-01-01T00:00:02.100Z",
      sourceEdgeStatus: "closed",
    });
    expect(graph.nodes.find((node) => node.id === "missing-child")).toMatchObject({
      title: "missing-child",
      tokenTotal: 0,
      sourceEdgeStatus: "open",
      metadataMissing: true,
    });
    expect(graph.statusSummary).toEqual({ open: 2, closed: 1, failed: 1 });
  });
});
