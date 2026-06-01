import { afterEach, describe, expect, it } from "vitest";

import { createClaudeCodeSource } from "../../src/backend/sources/claudeCode/ClaudeCodeSource";
import {
  createClaudeProjectsFixture,
  type ClaudeProjectsFixture,
  type ClaudeSessionFixture,
} from "../fixtures/claudeProjects";

const fixtures: ClaudeProjectsFixture[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const ROOT_ID = "root1111-1111-4111-8111-111111111111";
const ROOT_CWD = "/repo/children-app";

const rootWithTwoChildren = (): ClaudeSessionFixture => ({
  sessionId: ROOT_ID,
  cwd: ROOT_CWD,
  aiTitle: "Children root session",
  gitBranch: "main",
  model: "claude-opus-4",
  firstUserMessage: "Coordinate the work",
  createdAtMs: 1_700_000_000_000,
  updatedAtMs: 1_700_000_500_000,
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
      // Still running: no terminal report block + a fresh mtime is set by the fixture
      // via updatedAtMs, but we mark it open so the heuristic reports it open.
      open: true,
    },
  ],
});

const makeSource = async (sessions: ClaudeSessionFixture[]) => {
  const fixture = await createClaudeProjectsFixture({ sessions });
  fixtures.push(fixture);
  return createClaudeCodeSource({ projectsDir: fixture.projectsDir });
};

describe("ClaudeCodeSource.listChildren", () => {
  it("returns one child SessionSummary per sub-agent with native provenance + token totals", async () => {
    const source = await makeSource([rootWithTwoChildren()]);

    const children = await source.listChildren(ROOT_ID, 10);
    expect(children).toHaveLength(2);

    const byId = new Map(children.map((child) => [child.id, child]));
    const reviewer = byId.get("agent-reviewer");
    const writer = byId.get("agent-writer");

    expect(reviewer).toBeDefined();
    expect(reviewer?.source).toBe("claude-code");
    expect(reviewer?.parentId).toBe(ROOT_ID);
    expect(reviewer?.parentEdgeSource).toBe("native");
    expect(reviewer?.agentRole).toBe("code-reviewer");
    expect(reviewer?.agentNickname).toBe("Review the diff for correctness");
    expect(reviewer?.title).toBe("Review the diff for correctness");
    expect(reviewer?.threadSource).toBe("subagent");
    // Token total summed from the child transcript usage.
    expect(reviewer?.tokenTotal).toBe(200 + 80 + 20 + 8);
    expect(reviewer?.tokensUsed).toBe(200 + 80 + 20 + 8);

    expect(writer?.agentRole).toBe("test-writer");
    expect(writer?.tokenTotal).toBe(40 + 12);
  });

  it("populates childCount and openChildCount on the CC root SessionSummary", async () => {
    const source = await makeSource([rootWithTwoChildren()]);

    const root = await source.getSession(ROOT_ID);
    expect(root?.childCount).toBe(2);
    // One child (writer) is open; the reviewer wrote a terminal report.
    expect(root?.openChildCount).toBe(1);

    const listed = (await source.listSessions({ source: "claude-code" })).find((session) => session.id === ROOT_ID);
    expect(listed).toBeDefined();
    expect(listed?.childCount).toBe(2);
    expect(listed?.openChildCount).toBe(1);
  });
});
