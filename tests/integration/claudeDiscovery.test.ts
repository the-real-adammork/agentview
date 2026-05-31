import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ClaudeCodeNotImplementedError,
  createClaudeCodeSource,
} from "../../src/backend/sources/claudeCode/ClaudeCodeSource";
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

  it("listSessions returns both fixture sessions with source:claude-code and derived metadata", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const sessions = await source.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.source === "claude-code")).toBe(true);

    const subagent = sessions.find((session) => session.id === SUBAGENT_ID);
    expect(subagent).toMatchObject({ title: "Subagent CC session title", cwd: "/repo/subagent-app", childCount: 2 });

    // Sorted by updatedAtMs desc.
    expect(sessions.map((session) => session.id)).toEqual([SUBAGENT_ID, PLAIN_ID]);
  });

  it("applies the SessionFilter axes that make sense for CC", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const bySearch = await source.listSessions({ search: "Subagent" });
    expect(bySearch.map((session) => session.id)).toEqual([SUBAGENT_ID]);

    const byCwd = await source.listSessions({ cwd: "/repo/plain-app" });
    expect(byCwd.map((session) => session.id)).toEqual([PLAIN_ID]);

    const byUpdatedAfter = await source.listSessions({ updatedAfterMs: 1_700_000_250_000 });
    expect(byUpdatedAfter.map((session) => session.id)).toEqual([SUBAGENT_ID]);

    const byMinTokens = await source.listSessions({ minTokens: 200 });
    expect(byMinTokens.map((session) => session.id)).toEqual([SUBAGENT_ID]);

    const byModel = await source.listSessions({ model: "claude-opus-4" });
    expect(byModel).toHaveLength(2);

    const bySubagentThreadSource = await source.listSessions({ threadSource: "subagent" });
    expect(bySubagentThreadSource).toHaveLength(0);
  });

  it("paginates by limit and offset", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const firstPage = await source.listSessions(undefined, { limit: 1, offset: 0 });
    expect(firstPage.map((session) => session.id)).toEqual([SUBAGENT_ID]);

    const secondPage = await source.listSessions(undefined, { limit: 1, offset: 1 });
    expect(secondPage.map((session) => session.id)).toEqual([PLAIN_ID]);
  });

  it("getSession returns the matching row and null for an unknown id", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const found = await source.getSession(PLAIN_ID);
    expect(found).toMatchObject({ id: PLAIN_ID, source: "claude-code" });

    const missing = await source.getSession("does-not-exist");
    expect(missing).toBeNull();
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

  it("parse returns CachedRolloutFacts (Phase 4); listChildren/tail still throw the typed error", async () => {
    const fixture = await makeFixture();
    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });
    const resolved = await source.resolveSession(PLAIN_ID);

    // Phase 4 implements `parse`: it reads the transcript and emits normalized facts.
    const facts = await source.parse(resolved);
    expect(facts.threadId).toBe(PLAIN_ID);
    expect(facts.rolloutPath).toBe(resolved.rawLogPath);
    expect(Array.isArray(facts.events)).toBe(true);

    // listChildren (Phase 5) and tail (Phase 6) are still deferred stubs.
    await expect(source.listChildren(PLAIN_ID, 10)).rejects.toBeInstanceOf(ClaudeCodeNotImplementedError);
    await expect(source.listChildren(PLAIN_ID, 10)).rejects.toMatchObject({ method: "listChildren", phase: 5 });

    await expect(source.tail(resolved, 0)).rejects.toBeInstanceOf(ClaudeCodeNotImplementedError);
    await expect(source.tail(resolved, 0)).rejects.toMatchObject({ method: "tail", phase: 6 });
  });

  it("close resolves without error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agentview-claude-close-"));
    tempDirs.push(dir);
    const source = createClaudeCodeSource({ projectsDir: dir });
    await expect(source.close()).resolves.toBeUndefined();
  });
});
