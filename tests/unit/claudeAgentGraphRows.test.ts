import { afterEach, describe, expect, it } from "vitest";

import { createClaudeCodeSource } from "../../src/backend/sources/claudeCode/ClaudeCodeSource";
import type { CodexSource } from "../../src/backend/sources/codex/CodexSource";
import {
  createClaudeProjectsFixture,
  type ClaudeProjectsFixture,
  type ClaudeSessionFixture,
} from "../fixtures/claudeProjects";

const fixtures: ClaudeProjectsFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const ROOT_ID = "graph111-1111-4111-8111-111111111111";
const ROOT_CWD = "/repo/graph-app";

const session = (): ClaudeSessionFixture => ({
  sessionId: ROOT_ID,
  cwd: ROOT_CWD,
  aiTitle: "Graph root session",
  gitBranch: "main",
  model: "claude-opus-4",
  firstUserMessage: "Coordinate the graph work",
  createdAtMs: 1_700_000_000_000,
  updatedAtMs: 1_700_000_900_000,
  assistantUsages: [{ input: 100, output: 50 }],
  subagents: [
    {
      agentId: "reviewer",
      agentType: "code-reviewer",
      description: "Review the diff for correctness",
      toolUseId: "toolu_review",
      finalReport: "Reviewed: looks correct",
      assistantUsages: [{ input: 200, output: 80, cacheCreate: 20, cacheRead: 8 }],
      createdAtMs: 1_700_000_100_000,
      updatedAtMs: 1_700_000_200_000,
      // Nested grandchild owned by the reviewer (for the depth-cap assertion).
      nested: [
        {
          agentId: "nested-linter",
          agentType: "linter",
          description: "Lint the touched files",
          toolUseId: "toolu_lint",
          finalReport: "Lint clean",
          createdAtMs: 1_700_000_150_000,
          updatedAtMs: 1_700_000_180_000,
        },
      ],
    },
    {
      agentId: "writer",
      agentType: "test-writer",
      description: "Write tests for the change",
      toolUseId: "toolu_write",
      finalReport: "Wrote 3 tests",
      assistantUsages: [{ input: 40, output: 12 }],
      createdAtMs: 1_700_000_300_000,
      updatedAtMs: 1_700_000_400_000,
    },
  ],
});

const makeSource = async (sessions: ClaudeSessionFixture[]) => {
  const fixture = await createClaudeProjectsFixture({ sessions });
  fixtures.push(fixture);
  // ClaudeCodeSource structurally satisfies AgentGraphRowSource; cast for the test.
  return createClaudeCodeSource({ projectsDir: fixture.projectsDir }) as unknown as CodexSource;
};

describe("ClaudeCodeSource.getAgentGraphRows", () => {
  it("emits a root metadata row + a native edge row per sub-agent (depth-ordered)", async () => {
    const source = await makeSource([session()]);

    const rows = await source.getAgentGraphRows(ROOT_ID, 5);

    const rootRow = rows.find((row) => row.id === ROOT_ID && row.parentThreadId === null);
    expect(rootRow).toBeDefined();
    expect(rootRow?.childThreadId).toBeNull();
    expect(rootRow?.edgeStatus).toBeNull();

    const reviewerEdge = rows.find((row) => row.childThreadId === "agent-reviewer");
    expect(reviewerEdge).toBeDefined();
    expect(reviewerEdge?.parentThreadId).toBe(ROOT_ID);
    expect(reviewerEdge?.edgeStatus).toBe("closed");
    expect(reviewerEdge?.edgeSource).toBe("native");
    expect(reviewerEdge?.edgeConfidence).toBe("certain");
    expect(reviewerEdge?.edgeVia).toBeUndefined();
    expect(reviewerEdge?.agentRole).toBe("code-reviewer");
    expect(reviewerEdge?.agentNickname).toBe("Review the diff for correctness");
    expect(reviewerEdge?.preview).toBe("Reviewed: looks correct");
    expect(reviewerEdge?.tokensUsed).toBe(200 + 80 + 20 + 8);

    const writerEdge = rows.find((row) => row.childThreadId === "agent-writer");
    expect(writerEdge?.parentThreadId).toBe(ROOT_ID);
    expect(writerEdge?.agentRole).toBe("test-writer");

    // The nested grandchild is parented by the reviewer (enclosing sub-agent), not root.
    const nestedEdge = rows.find((row) => row.childThreadId === "agent-nested-linter");
    expect(nestedEdge?.parentThreadId).toBe("agent-reviewer");
    expect(nestedEdge?.edgeSource).toBe("native");
  });

  it("caps recursion at scanDepth: a depth-1 scan excludes the nested grandchild", async () => {
    const source = await makeSource([session()]);

    const rows = await source.getAgentGraphRows(ROOT_ID, 1);
    const childIds = rows.map((row) => row.childThreadId).filter((id): id is string => Boolean(id));

    expect(childIds).toContain("agent-reviewer");
    expect(childIds).toContain("agent-writer");
    expect(childIds).not.toContain("agent-nested-linter");
  });
});
