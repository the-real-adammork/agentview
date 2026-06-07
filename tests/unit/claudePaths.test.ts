import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ClaudePathError,
  cwdFromEscapedProjectName,
  escapeCwd,
  resolveClaudeProjectsDir,
  resolveClaudeSessionPath,
} from "../../src/backend/sources/claudeCode/claudePaths";

const tempRoots: string[] = [];

const makeTempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveClaudeProjectsDir", () => {
  it("honors CLAUDE_PROJECTS_DIR and returns the realpath of the configured dir", async () => {
    const projectsDir = await makeTempDir("agentview-claude-projects-env-");

    const resolved = await resolveClaudeProjectsDir({ env: { CLAUDE_PROJECTS_DIR: projectsDir } });

    // realpath normalizes the temp dir (macOS prefixes /private), so compare via realpath.
    expect(resolved).toBe(await resolveClaudeProjectsDir({ env: { CLAUDE_PROJECTS_DIR: projectsDir } }));
    expect(resolved.endsWith(projectsDir.replace(/^\/private/, ""))).toBe(true);
  });

  it("defaults to <homeDir>/.claude/projects when no env var is set", async () => {
    const homeDir = await makeTempDir("agentview-claude-home-");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(homeDir, ".claude", "projects"), { recursive: true });

    const resolved = await resolveClaudeProjectsDir({ env: {}, homeDir });

    expect(resolved).toBe(await resolveClaudeProjectsDir({ env: {}, homeDir }));
    expect(resolved.endsWith(join(".claude", "projects"))).toBe(true);
  });

  it("throws a typed ClaudePathError with code CLAUDE_PROJECTS_DIR_MISSING for a missing configured dir", async () => {
    const missing = join(tmpdir(), `agentview-claude-missing-${Date.now()}-${Math.random()}`);

    await expect(resolveClaudeProjectsDir({ env: { CLAUDE_PROJECTS_DIR: missing } })).rejects.toMatchObject({
      code: "CLAUDE_PROJECTS_DIR_MISSING",
    });
  });
});

describe("escapeCwd", () => {
  it("replaces / and . with - matching the real CC escaping", () => {
    expect(escapeCwd("/Users/adam/Projects/agentview")).toBe("-Users-adam-Projects-agentview");
  });

  it("escapes dots in the cwd", () => {
    expect(escapeCwd("/Users/adam/.config/app")).toBe("-Users-adam--config-app");
  });
});

describe("cwdFromEscapedProjectName", () => {
  it("best-effort decodes Claude project folder names into absolute cwd paths", () => {
    expect(cwdFromEscapedProjectName("-Users-adam-Projects-agentview")).toBe("/Users/adam/Projects/agentview");
  });

  it("best-effort restores hidden path segments encoded as double dashes", () => {
    expect(cwdFromEscapedProjectName("-Users-adam--config-app")).toBe("/Users/adam/.config/app");
  });
});

describe("resolveClaudeSessionPath", () => {
  it("rejects a traversal relative path with CLAUDE_PATH_TRAVERSAL", async () => {
    const projectsDir = await makeTempDir("agentview-claude-projects-guard-");

    await expect(resolveClaudeSessionPath(projectsDir, "../../etc/passwd")).rejects.toMatchObject({
      code: "CLAUDE_PATH_TRAVERSAL",
    });
    await expect(resolveClaudeSessionPath(projectsDir, "../../etc/passwd")).rejects.toBeInstanceOf(ClaudePathError);
  });

  it("rejects an absolute path with CLAUDE_PATH_TRAVERSAL", async () => {
    const projectsDir = await makeTempDir("agentview-claude-projects-abs-");

    await expect(resolveClaudeSessionPath(projectsDir, "/etc/passwd")).rejects.toMatchObject({
      code: "CLAUDE_PATH_TRAVERSAL",
    });
  });

  it("resolves a valid relative path inside the projects dir", async () => {
    const projectsDir = await makeTempDir("agentview-claude-projects-ok-");

    const resolved = await resolveClaudeSessionPath(projectsDir, "-repo-app/session.jsonl");

    const root = await resolveClaudeProjectsDir({ env: { CLAUDE_PROJECTS_DIR: projectsDir } });
    expect(resolved).toBe(resolve(root, "-repo-app/session.jsonl"));
    expect(resolved.startsWith(root)).toBe(true);
  });
});
