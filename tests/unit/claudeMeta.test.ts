import { afterEach, describe, expect, it } from "vitest";

import {
  countSubagents,
  discoverClaudeSessions,
} from "../../src/backend/sources/claudeCode/discovery";
import {
  deriveClaudeMeta,
  inferStatus,
  pickTitle,
  STALE_WINDOW_MS,
  sumUsageTokens,
} from "../../src/backend/sources/claudeCode/claudeMeta";
import {
  createClaudeProjectsFixture,
  defaultClaudeSessions,
  type ClaudeProjectsFixture,
} from "../fixtures/claudeProjects";

const fixtures: ClaudeProjectsFixture[] = [];

const makeFixture = async (sessions = defaultClaudeSessions) => {
  const fixture = await createClaudeProjectsFixture({ sessions });
  fixtures.push(fixture);
  return fixture;
};

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

const PLAIN_ID = "11111111-1111-4111-8111-111111111111";
const SUBAGENT_ID = "22222222-2222-4222-8222-222222222222";

describe("discoverClaudeSessions", () => {
  it("returns one entry per <escaped-cwd>/<uuid>.jsonl with the right childCount and subagentsDir", async () => {
    const fixture = await makeFixture();

    const discovered = await discoverClaudeSessions(fixture.projectsDir);
    const byId = new Map(discovered.map((session) => [session.sessionId, session]));

    expect(discovered).toHaveLength(2);

    const subagent = byId.get(SUBAGENT_ID);
    expect(subagent?.childCount).toBe(2);
    expect(subagent?.subagentsDir.endsWith(`/${SUBAGENT_ID}/subagents`)).toBe(true);

    const plain = byId.get(PLAIN_ID);
    expect(plain?.childCount).toBe(0);
    expect(plain?.transcriptPath.endsWith(`${PLAIN_ID}.jsonl`)).toBe(true);
  });

  it("returns an empty list when the projects dir does not exist", async () => {
    const discovered = await discoverClaudeSessions("/no/such/agentview-claude-projects-dir");
    expect(discovered).toEqual([]);
  });
});

describe("countSubagents", () => {
  it("returns 0 for a non-existent dir", async () => {
    expect(await countSubagents("/no/such/subagents")).toBe(0);
  });

  it("counts only agent-*.jsonl files (not .meta.json)", async () => {
    const fixture = await makeFixture();
    const subagentsDir = `${fixture.projectsDir}/-repo-subagent-app/${SUBAGENT_ID}/subagents`;
    expect(await countSubagents(subagentsDir)).toBe(2);
  });
});

describe("pickTitle", () => {
  it("returns the aiTitle when present", () => {
    expect(pickTitle("Real title", "first message preview")).toBe("Real title");
  });

  it("falls back to the first-user-message preview when aiTitle is empty or whitespace", () => {
    expect(pickTitle("", "first message preview")).toBe("first message preview");
    expect(pickTitle("   ", "first message preview")).toBe("first message preview");
    expect(pickTitle(undefined, "first message preview")).toBe("first message preview");
  });
});

describe("sumUsageTokens", () => {
  it("sums input/output/cacheCreate/cacheRead treating missing keys as 0", () => {
    const total = sumUsageTokens([
      { input: 100, output: 50, cacheCreate: 10, cacheRead: 5 },
      { input: 20, output: 8 },
    ]);
    expect(total).toBe(100 + 50 + 10 + 5 + 20 + 8);
  });

  it("returns 0 for no usages", () => {
    expect(sumUsageTokens([])).toBe(0);
  });
});

describe("inferStatus", () => {
  const now = 1_700_000_000_000;

  it("returns running for a fresh mtime with no terminal marker", () => {
    expect(inferStatus({ mtimeMs: now, hasTerminalMarker: false, now, staleWindowMs: STALE_WINDOW_MS })).toBe(
      "running",
    );
  });

  it("returns complete for a stale mtime", () => {
    expect(
      inferStatus({ mtimeMs: now - STALE_WINDOW_MS - 1, hasTerminalMarker: false, now, staleWindowMs: STALE_WINDOW_MS }),
    ).toBe("complete");
  });

  it("returns complete for a terminal marker regardless of a fresh mtime", () => {
    expect(inferStatus({ mtimeMs: now, hasTerminalMarker: true, now, staleWindowMs: STALE_WINDOW_MS })).toBe(
      "complete",
    );
  });
});

describe("deriveClaudeMeta", () => {
  it("returns a full SessionSummary derived from the transcript without a full parse", async () => {
    const fixture = await makeFixture();
    const discovered = await discoverClaudeSessions(fixture.projectsDir);
    const subagent = discovered.find((session) => session.sessionId === SUBAGENT_ID)!;

    const summary = await deriveClaudeMeta(subagent, { now: 1_700_000_300_000 });

    expect(summary).toMatchObject({
      source: "claude-code",
      id: SUBAGENT_ID,
      title: "Subagent CC session title",
      cwd: "/repo/subagent-app",
      branch: "feat/work",
      gitBranch: "feat/work",
      model: "claude-opus-4",
      childCount: 2,
      openChildCount: 0,
      archived: false,
      threadSource: "user",
    });

    const expectedTokens = 200 + 80 + 20 + 8 + 40 + 12;
    expect(summary.tokenTotal).toBe(expectedTokens);
    expect(summary.tokensUsed).toBe(expectedTokens);
    expect(summary.updatedAtMs).toBe(1_700_000_300_000);
    expect(summary.rolloutPath).toBe(subagent.transcriptPath);
    expect(summary.warningCountStatus).toBe("not_requested");
    expect(summary.failedToolCountStatus).toBe("not_requested");
  });

  it("falls back to a redacted first-user-message preview when aiTitle is empty and masks secrets", async () => {
    const fixture = await makeFixture([
      {
        sessionId: "33333333-3333-4333-8333-333333333333",
        cwd: "/repo/secret-app",
        aiTitle: "",
        gitBranch: "main",
        firstUserMessage: "Run task. OPENAI_API_KEY=sk-proj-secret should not leak",
        createdAtMs: 1_700_000_400_000,
        updatedAtMs: 1_700_000_500_000,
        assistantUsages: [{ input: 5, output: 5 }],
      },
    ]);

    const discovered = await discoverClaudeSessions(fixture.projectsDir);
    const summary = await deriveClaudeMeta(discovered[0], { now: 1_700_000_600_000 });

    expect(summary.firstUserMessagePreview).toContain("[REDACTED]");
    expect(summary.firstUserMessagePreview).not.toContain("sk-proj-secret");
    expect(summary.title).not.toContain("sk-proj-secret");
    expect(JSON.stringify(summary)).not.toContain("sk-proj-secret");
  });

  it("falls back to the project directory name when transcript lines omit cwd", async () => {
    const sessionId = "44444444-4444-4444-8444-444444444444";
    const fixture = await makeFixture([
      {
        sessionId,
        cwd: "/repo/missing-cwd-app",
        createdAtMs: 1_700_000_700_000,
        updatedAtMs: 1_700_000_800_000,
        rawLines: [
          {
            type: "user",
            sessionId,
            timestamp: "2023-11-14T22:25:00.000Z",
            message: { role: "user", content: "Find the cwd fallback" },
          },
        ],
      },
    ]);

    const discovered = await discoverClaudeSessions(fixture.projectsDir);
    const summary = await deriveClaudeMeta(discovered[0], { now: 1_700_000_900_000 });

    expect(summary.cwd).toBe("/repo/missing/cwd/app");
  });
});
