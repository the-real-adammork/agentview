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
  /** First user prompt text written into the sub-agent transcript. */
  firstUserMessage?: string;
  /** Final report = the last assistant text block of the sub-agent transcript. */
  finalReport?: string;
  /** Assistant usage rows summed into the sub-agent token total. Defaults to one row. */
  assistantUsages?: ClaudeAssistantUsageFixture[];
  /** First/last transcript timestamps; default to the parent session's window. */
  createdAtMs?: number;
  updatedAtMs?: number;
  /**
   * When `true`, the sub-agent's transcript omits a terminal assistant text block
   * so the child status heuristic reports it as still open/running.
   */
  open?: boolean;
  /**
   * Nested sub-agents owned by THIS sub-agent (for the depth-cap test). Each nested
   * entry writes its own `agent-<id>.jsonl` + `.meta.json` under the SAME root
   * `subagents/` dir and injects a matching `Task` tool_use into this sub-agent's
   * transcript. `toolUseId` links the nested child to this sub-agent's `Task` block.
   */
  nested?: ClaudeSubagentFixture[];
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
 * Write one sub-agent `agent-<id>.jsonl` transcript + `agent-<id>.meta.json` sidecar
 * into `subagentsDir`. The transcript carries `isSidechain:true`, a `user` prompt,
 * one assistant line per usage row (so the child token total sums them), and a
 * terminal assistant text block (the "final report") unless `open` is set. When the
 * sub-agent owns `nested` children, this injects a `Task` tool_use into ITS own
 * transcript and recurses into the same `subagentsDir` (the nested transcript's
 * `parent` is THIS sub-agent's `agent-<id>`).
 */
const writeSubagent = async (
  subagentsDir: string,
  parent: { sessionId: string; cwd: string; gitBranch?: string; version?: string; updatedAtMs: number },
  subagent: ClaudeSubagentFixture,
): Promise<void> => {
  const childId = `agent-${subagent.agentId}`;
  const createdAtMs = subagent.createdAtMs ?? parent.updatedAtMs;
  const updatedAtMs = subagent.updatedAtMs ?? parent.updatedAtMs;
  const stamped = {
    cwd: parent.cwd,
    gitBranch: parent.gitBranch ?? "",
    version: parent.version ?? "",
    sessionId: parent.sessionId,
    agentId: childId,
    isSidechain: true,
  };

  const lines: Array<Record<string, unknown>> = [];

  lines.push({
    type: "user",
    ...stamped,
    timestamp: isoOf(createdAtMs),
    uuid: `${childId}-user-0`,
    parentUuid: null,
    userType: "external",
    message: { role: "user", content: subagent.firstUserMessage ?? subagent.description },
  });

  const usages = subagent.assistantUsages ?? [{ input: 50, output: 20, cacheCreate: 5, cacheRead: 2 }];
  usages.forEach((usage, index) => {
    lines.push({
      type: "assistant",
      ...stamped,
      timestamp: isoOf(updatedAtMs),
      uuid: `${childId}-assistant-${index}`,
      parentUuid: `${childId}-user-0`,
      userType: "external",
      message: {
        role: "assistant",
        usage: {
          input_tokens: usage.input ?? 0,
          output_tokens: usage.output ?? 0,
          cache_creation_input_tokens: usage.cacheCreate ?? 0,
          cache_read_input_tokens: usage.cacheRead ?? 0,
        },
      },
    });
  });

  // Inject a `Task` tool_use per nested sub-agent so the recursion can join
  // `meta.toolUseId` → this sub-agent's transcript.
  (subagent.nested ?? []).forEach((child, index) => {
    lines.push({
      type: "assistant",
      ...stamped,
      timestamp: isoOf(child.createdAtMs ?? updatedAtMs),
      uuid: `${childId}-task-${child.agentId}`,
      parentUuid: `${childId}-user-0`,
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: child.toolUseId,
            name: "Task",
            input: { subagent_type: child.agentType, description: child.description },
          },
        ],
      },
      _taskOrdinal: index,
    });
  });

  // The final report is the LAST assistant text block — drives the graph node's
  // `finalReportPreview`. Omitted when `open` (so the status heuristic stays open).
  if (!subagent.open) {
    lines.push({
      type: "assistant",
      ...stamped,
      timestamp: isoOf(updatedAtMs),
      uuid: `${childId}-report`,
      parentUuid: `${childId}-user-0`,
      message: { role: "assistant", content: [{ type: "text", text: subagent.finalReport ?? `${subagent.description} done` }] },
    });
  }

  const transcriptPath = join(subagentsDir, `${childId}.jsonl`);
  await writeFile(transcriptPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  const mtimeSeconds = updatedAtMs / 1000;
  await utimes(transcriptPath, mtimeSeconds, mtimeSeconds);

  await writeFile(
    join(subagentsDir, `${childId}.meta.json`),
    `${JSON.stringify({
      agentType: subagent.agentType,
      description: subagent.description,
      toolUseId: subagent.toolUseId,
    })}\n`,
  );

  for (const child of subagent.nested ?? []) {
    await writeSubagent(subagentsDir, { ...parent, updatedAtMs }, child);
  }
};

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

    // Inject one assistant `Task` tool_use line per direct sub-agent (`id ===
    // toolUseId`) so the CC agent-graph builder can join `meta.toolUseId` → the
    // parent transcript's `Task` block ordinal. The block order is the sub-agent
    // declaration order (drives `edgeOrder`).
    (session.subagents ?? []).forEach((subagent, index) => {
      lines.push({
        type: "assistant",
        ...stamped,
        timestamp: isoOf(subagent.createdAtMs ?? session.updatedAtMs),
        uuid: `${session.sessionId}-task-${subagent.agentId}`,
        parentUuid: `${session.sessionId}-user-0`,
        isSidechain: false,
        userType: "external",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: subagent.toolUseId,
              name: "Task",
              input: { subagent_type: subagent.agentType, description: subagent.description },
            },
          ],
        },
        _taskOrdinal: index,
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
        await writeSubagent(subagentsDir, session, subagent);
      }
    }
  }

  return {
    projectsDir,
    cleanup: () => rm(projectsDir, { recursive: true, force: true }),
  };
};
