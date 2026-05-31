import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { escapeCwd } from "../../src/backend/sources/claudeCode/claudePaths";

export interface ClaudeAssistantUsageFixture {
  input?: number;
  output?: number;
  cacheCreate?: number;
  cacheRead?: number;
}

export interface ClaudeSubagentFixture {
  agentId: string;
  agentType: string;
  description: string;
  toolUseId: string;
}

export interface ClaudeSessionFixture {
  sessionId: string;
  cwd: string;
  aiTitle?: string;
  gitBranch?: string;
  version?: string;
  model?: string;
  firstUserMessage?: string;
  createdAtMs: number;
  updatedAtMs: number;
  assistantUsages?: ClaudeAssistantUsageFixture[];
  subagents?: ClaudeSubagentFixture[];
  /**
   * Verbatim transcript lines to write instead of the synthesized
   * user/ai-title/assistant rows. Use `claudeLine(...)` to build well-formed
   * records. When set, the transcript is written exactly as given (the timeline
   * parser tests drive a real multi-tool transcript this way).
   */
  rawLines?: Array<Record<string, unknown>>;
}

/**
 * Stamp a CC transcript record with the shared envelope keys (`uuid`, `parentUuid`,
 * `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `isSidechain`,
 * `userType`) so fixtures stay terse. Any field can be overridden via `record`.
 */
export const claudeLine = (
  record: Record<string, unknown> & { type: string },
  defaults: { sessionId: string; cwd: string; gitBranch?: string; version?: string; timestamp?: string } = {
    sessionId: "cc-fixture",
    cwd: "/repo/cc-app",
  },
): Record<string, unknown> => ({
  sessionId: defaults.sessionId,
  cwd: defaults.cwd,
  gitBranch: defaults.gitBranch ?? "main",
  version: defaults.version ?? "1.2.3",
  isSidechain: false,
  userType: "external",
  ...(defaults.timestamp ? { timestamp: defaults.timestamp } : {}),
  ...record,
});

export interface ClaudeProjectsFixture {
  projectsDir: string;
  cleanup(): Promise<void>;
}

export interface CreateClaudeProjectsFixtureOptions {
  sessions?: ClaudeSessionFixture[];
}

const isoOf = (ms: number) => new Date(ms).toISOString();

/**
 * Two default sessions used by the discovery/merged tests: a plain one (no
 * subagents) and one with two `subagents/` entries. Mirrors the real on-disk CC
 * layout (verified against `~/.claude/projects`).
 */
export const defaultClaudeSessions: ClaudeSessionFixture[] = [
  {
    sessionId: "11111111-1111-4111-8111-111111111111",
    cwd: "/repo/plain-app",
    aiTitle: "Plain CC session title",
    gitBranch: "main",
    version: "1.2.3",
    model: "claude-opus-4",
    firstUserMessage: "Investigate the plain session",
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_100_000,
    assistantUsages: [{ input: 100, output: 50, cacheCreate: 10, cacheRead: 5 }],
  },
  {
    sessionId: "22222222-2222-4222-8222-222222222222",
    cwd: "/repo/subagent-app",
    aiTitle: "Subagent CC session title",
    gitBranch: "feat/work",
    version: "1.2.3",
    model: "claude-opus-4",
    firstUserMessage: "Investigate the subagent session",
    createdAtMs: 1_700_000_200_000,
    updatedAtMs: 1_700_000_300_000,
    assistantUsages: [
      { input: 200, output: 80, cacheCreate: 20, cacheRead: 8 },
      { input: 40, output: 12 },
    ],
    subagents: [
      { agentId: "aaaa", agentType: "explorer", description: "Explore the repo", toolUseId: "tool-a" },
      { agentId: "bbbb", agentType: "implementer", description: "Implement the fix", toolUseId: "tool-b" },
    ],
  },
];

/**
 * Build a temp `CLAUDE_PROJECTS_DIR` tree with real CC line shapes, mirroring
 * `createCodexHomeFixture`. Each session writes `<escaped-cwd>/<sessionId>.jsonl`
 * with a stamped `user` line, an `ai-title` line, and one `assistant` line per
 * usage entry; sessions with `subagents` also write a sibling
 * `<sessionId>/subagents/agent-<id>.jsonl` + `agent-<id>.meta.json`.
 */
export const createClaudeProjectsFixture = async ({
  sessions = [],
}: CreateClaudeProjectsFixtureOptions = {}): Promise<ClaudeProjectsFixture> => {
  const projectsDir = await mkdtemp(join(tmpdir(), "agentview-claude-projects-"));

  for (const session of sessions) {
    const escaped = escapeCwd(session.cwd);
    const projectDir = join(projectsDir, escaped);
    await mkdir(projectDir, { recursive: true });

    const stamped = {
      cwd: session.cwd,
      gitBranch: session.gitBranch ?? "",
      version: session.version ?? "",
      sessionId: session.sessionId,
    };

    const lines: Array<Record<string, unknown>> = [];

    if (session.rawLines) {
      // Write the supplied transcript verbatim (the timeline-parse tests drive a
      // real multi-tool transcript). Still derive mtime from updatedAtMs below.
      const transcriptPath = join(projectDir, `${session.sessionId}.jsonl`);
      await writeFile(transcriptPath, `${session.rawLines.map((line) => JSON.stringify(line)).join("\n")}\n`);
      const mtimeSeconds = session.updatedAtMs / 1000;
      await utimes(transcriptPath, mtimeSeconds, mtimeSeconds);
      continue;
    }

    lines.push({
      type: "user",
      ...stamped,
      timestamp: isoOf(session.createdAtMs),
      uuid: `${session.sessionId}-user-0`,
      parentUuid: null,
      isSidechain: false,
      userType: "external",
      message: { role: "user", content: session.firstUserMessage ?? "" },
    });

    lines.push({
      type: "ai-title",
      aiTitle: session.aiTitle ?? "",
      sessionId: session.sessionId,
    });

    const usages = session.assistantUsages ?? [];
    usages.forEach((usage, index) => {
      lines.push({
        type: "assistant",
        ...stamped,
        timestamp: isoOf(session.updatedAtMs),
        uuid: `${session.sessionId}-assistant-${index}`,
        parentUuid: `${session.sessionId}-user-0`,
        isSidechain: false,
        userType: "external",
        message: {
          role: "assistant",
          model: session.model ?? "",
          usage: {
            input_tokens: usage.input ?? 0,
            output_tokens: usage.output ?? 0,
            cache_creation_input_tokens: usage.cacheCreate ?? 0,
            cache_read_input_tokens: usage.cacheRead ?? 0,
          },
        },
      });
    });

    const transcriptPath = join(projectDir, `${session.sessionId}.jsonl`);
    await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const mtimeSeconds = session.updatedAtMs / 1000;
    await utimes(transcriptPath, mtimeSeconds, mtimeSeconds);

    if (session.subagents && session.subagents.length > 0) {
      const subagentsDir = join(projectDir, session.sessionId, "subagents");
      await mkdir(subagentsDir, { recursive: true });

      for (const subagent of session.subagents) {
        const sidechainLine = {
          type: "assistant",
          ...stamped,
          isSidechain: true,
          timestamp: isoOf(session.updatedAtMs),
          uuid: `${session.sessionId}-sub-${subagent.agentId}`,
          message: { role: "assistant", content: "" },
        };
        await writeFile(
          join(subagentsDir, `agent-${subagent.agentId}.jsonl`),
          `${JSON.stringify(sidechainLine)}\n`,
        );
        await writeFile(
          join(subagentsDir, `agent-${subagent.agentId}.meta.json`),
          `${JSON.stringify({
            agentType: subagent.agentType,
            description: subagent.description,
            toolUseId: subagent.toolUseId,
          })}\n`,
        );
      }
    }
  }

  return {
    projectsDir,
    cleanup: () => rm(projectsDir, { recursive: true, force: true }),
  };
};
