import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createClaudeCodeSource } from "../../src/backend/sources/claudeCode/ClaudeCodeSource";
import {
  createClaudeProjectsFixture,
  defaultClaudeSessions,
  type ClaudeProjectsFixture,
} from "../fixtures/claudeProjects";

const fixtures: ClaudeProjectsFixture[] = [];
const tempDirs: string[] = [];

const makeFixture = async (sessions = defaultClaudeSessions) => {
  const fixture = await createClaudeProjectsFixture({ sessions });
  fixtures.push(fixture);
  return fixture;
};

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const PLAIN_ID = "11111111-1111-4111-8111-111111111111";
const SUBAGENT_ID = "22222222-2222-4222-8222-222222222222";

describe("createClaudeCodeSource", () => {
  it("reports id claude-code", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });
    expect(source.id).toBe("claude-code");
  });

  it("getHealth reports available for a present dir and unavailable for a missing dir", async () => {
    const fixture = await makeFixture();
    const present = createClaudeCodeSource({ projectsDir: fixture.projectsDir });
    expect(await present.getHealth()).toMatchObject({ source: "claude-code", available: true });

    const missing = createClaudeCodeSource({ projectsDir: "/no/such/agentview-claude-projects-missing" });
    const health = await missing.getHealth();
    expect(health.source).toBe("claude-code");
    expect(health.available).toBe(false);
    expect(typeof health.detail).toBe("string");
  });

  it("listSessions returns roots plus sub-agent rows with native parentage", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const sessions = await source.listSessions();
    expect(sessions).toHaveLength(4);
    expect(sessions.every((session) => session.source === "claude-code")).toBe(true);

    const subagent = sessions.find((session) => session.id === SUBAGENT_ID);
    expect(subagent).toMatchObject({ title: "Subagent CC session title", cwd: "/repo/subagent-app", childCount: 2 });
    const children = sessions.filter((session) => session.parentId === SUBAGENT_ID);
    expect(children.map((session) => session.id).sort()).toEqual(["agent-aaaa", "agent-bbbb"]);
    expect(children.every((session) => session.threadSource === "subagent")).toBe(true);
    expect(children.every((session) => session.cwd === "/repo/subagent-app")).toBe(true);

    // Sorted by updatedAtMs desc.
    expect(sessions.map((session) => session.id)).toEqual([SUBAGENT_ID, "agent-aaaa", "agent-bbbb", PLAIN_ID]);
  });

  it("applies the SessionFilter axes that make sense for CC", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const bySearch = await source.listSessions({ search: "Subagent" });
    expect(bySearch.map((session) => session.id)).toEqual([SUBAGENT_ID]);

    const byCwd = await source.listSessions({ cwd: "/repo/plain-app" });
    expect(byCwd.map((session) => session.id)).toEqual([PLAIN_ID]);

    const byUpdatedAfter = await source.listSessions({ updatedAfterMs: 1_700_000_250_000 });
    expect(byUpdatedAfter.map((session) => session.id)).toEqual([SUBAGENT_ID, "agent-aaaa", "agent-bbbb"]);

    const byMinTokens = await source.listSessions({ minTokens: 200 });
    expect(byMinTokens.map((session) => session.id)).toEqual([SUBAGENT_ID]);

    const byModel = await source.listSessions({ model: "claude-opus-4" });
    expect(byModel).toHaveLength(4);

    const bySubagentThreadSource = await source.listSessions({ threadSource: "subagent" });
    expect(bySubagentThreadSource.map((session) => session.id).sort()).toEqual(["agent-aaaa", "agent-bbbb"]);
  });

  it("paginates by limit and offset", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const firstPage = await source.listSessions(undefined, { limit: 1, offset: 0 });
    expect(firstPage.map((session) => session.id)).toEqual([SUBAGENT_ID]);

    const secondPage = await source.listSessions(undefined, { limit: 1, offset: 1 });
    expect(secondPage.map((session) => session.id)).toEqual(["agent-aaaa"]);
  });

  it("getSession returns the matching row and null for an unknown id", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const found = await source.getSession(PLAIN_ID);
    expect(found).toMatchObject({ id: PLAIN_ID, source: "claude-code" });

    const missing = await source.getSession("does-not-exist");
    expect(missing).toBeNull();
  });

  it("getSession and resolveSession can address a sub-agent transcript", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const found = await source.getSession("agent-aaaa");
    expect(found).toMatchObject({
      id: "agent-aaaa",
      source: "claude-code",
      parentId: SUBAGENT_ID,
      threadSource: "subagent",
    });

    const resolved = await source.resolveSession("agent-aaaa");
    expect(resolved.source).toBe("claude-code");
    expect(resolved.sessionId).toBe("agent-aaaa");
    expect(resolved.rawLogPath.endsWith("agent-aaaa.jsonl")).toBe(true);
  });

  it("resolveSession returns the absolute transcript path and conventional subagentsDir", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const resolved = await source.resolveSession(SUBAGENT_ID);
    expect(resolved.source).toBe("claude-code");
    expect(resolved.sessionId).toBe(SUBAGENT_ID);
    expect(resolved.rawLogPath.endsWith(`${SUBAGENT_ID}.jsonl`)).toBe(true);
    expect((resolved.extra as { subagentsDir: string }).subagentsDir.endsWith(`${SUBAGENT_ID}/subagents`)).toBe(true);
  });

  it("resolveSession rejects an unknown/garbage id with a typed not-found", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    await expect(source.resolveSession("../../etc/passwd")).rejects.toThrow();
    await expect(source.resolveSession("totally-unknown-id")).rejects.toThrow();
  });

  it("parse returns CachedRolloutFacts (Phase 4); listChildren works (Phase 5); tail returns a SourceTailResult (Phase 6)", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });
    const resolved = await source.resolveSession(PLAIN_ID);

    // Phase 4 implements `parse`: it reads the transcript and emits normalized facts.
    const facts = await source.parse(resolved);
    expect(facts.threadId).toBe(PLAIN_ID);
    expect(facts.rolloutPath).toBe(resolved.rawLogPath);
    expect(Array.isArray(facts.events)).toBe(true);

    // listChildren (Phase 5) is implemented: a session without sub-agents returns [].
    await expect(source.listChildren(PLAIN_ID, 10)).resolves.toEqual([]);

    // tail (Phase 6) is implemented: a cold call returns the locked SourceTailResult
    // with every event the cold parse produces and offsets advanced to EOF.
    const tail = await source.tail(resolved, 0);
    expect(Object.keys(tail).sort()).toEqual(["events", "nextByte", "nextLine"]);
    expect(tail.events).toEqual(facts.events);
    expect(tail.nextByte).toBeGreaterThan(0);
  });

  it("close resolves without error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentview-claude-close-"));
    tempDirs.push(dir);
    const source = createClaudeCodeSource({ projectsDir: dir });
    await expect(source.close()).resolves.toBeUndefined();
  });
});
