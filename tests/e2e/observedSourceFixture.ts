import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { RuntimeLogLevel } from "../../src/shared/contracts";

export interface ObservedLogSeed {
  ts: number;
  tsNanos: number;
  level: RuntimeLogLevel;
  target: string;
  body: string;
  threadId?: string | null;
  modulePath?: string | null;
  file?: string | null;
  line?: number | null;
  processUuid?: string | null;
  estimatedBytes?: number | null;
}

export function e2eCodexHome() {
  const codexHome = process.env.AGENTVIEW_E2E_CODEX_HOME;
  if (!codexHome) {
    throw new Error("Playwright config must provide AGENTVIEW_E2E_CODEX_HOME.");
  }
  return codexHome;
}

export function e2eClaudeProjectsDir() {
  const dir = process.env.AGENTVIEW_E2E_CLAUDE_PROJECTS_DIR;
  if (!dir) {
    throw new Error("Playwright config must provide AGENTVIEW_E2E_CLAUDE_PROJECTS_DIR.");
  }
  return dir;
}

/** The distinctive title used to isolate the CC session via the Sessions search box. */
export const CC_E2E_SESSION_TITLE = "CC timeline render arm";
export const CC_E2E_SESSION_ID = "ccee0001-ccee-4ee0-8ee0-ccee0001ee00";
const CC_E2E_CWD = "/repo/cc-e2e-app";

const ccLine = (record: Record<string, unknown> & { type: string }) =>
  JSON.stringify({
    sessionId: CC_E2E_SESSION_ID,
    cwd: CC_E2E_CWD,
    gitBranch: "main",
    version: "1.2.3",
    isSidechain: false,
    userType: "external",
    ...record,
  });

const ccTranscriptDir = () => {
  // Mirror the on-disk CC layout: <projects>/<escaped-cwd>/<sessionId>.jsonl.
  const escaped = CC_E2E_CWD.replace(/[/.]/g, "-");
  return join(e2eClaudeProjectsDir(), escaped);
};

/**
 * Write one redacted CC transcript into the e2e CLAUDE_PROJECTS_DIR so the CC
 * session is discoverable and selectable. Carries a planted secret + a thinking
 * signature to prove redaction, a `Bash` (git status → status render), and an
 * `Edit` (→ diff render) so the @timeline CC arm draws through the existing
 * renderers. Removed by `removeClaudeTimelineFixture` so the @sessions exact-count
 * spec (which assumes an empty CC dir) stays green.
 */
export async function writeClaudeTimelineFixture() {
  const dir = ccTranscriptDir();
  await mkdir(dir, { recursive: true });
  // Drop any stale CC cache so a re-run re-parses the fresh transcript.
  await rm(join(e2eCodexHome(), ".observatory", "cache", "v1", "rollouts"), { recursive: true, force: true });

  const lines = [
    ccLine({
      type: "user",
      uuid: "u1",
      parentUuid: null,
      timestamp: "2026-05-30T10:00:00.000Z",
      message: { role: "user", content: `${CC_E2E_SESSION_TITLE}. Note OPENAI_API_KEY=sk-cc-e2e-secret` },
    }),
    ccLine({ type: "ai-title", aiTitle: CC_E2E_SESSION_TITLE }),
    ccLine({
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      timestamp: "2026-05-30T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Inspect the working tree first.", signature: "sig-cc-e2e-hidden" },
          { type: "text", text: "Checking the working tree." },
        ],
        usage: { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 40, cache_read_input_tokens: 600 },
      },
    }),
    ccLine({
      type: "assistant",
      uuid: "a2",
      parentUuid: "a1",
      timestamp: "2026-05-30T10:00:02.000Z",
      message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_bash1", name: "Bash", input: { command: "git status --short" } }] },
    }),
    ccLine({
      type: "user",
      uuid: "u2",
      parentUuid: "a2",
      timestamp: "2026-05-30T10:00:03.000Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_bash1", content: " M src/broken.ts" }] },
    }),
    ccLine({
      type: "assistant",
      uuid: "a3",
      parentUuid: "u2",
      timestamp: "2026-05-30T10:00:04.000Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_edit1", name: "Edit", input: { file_path: "/repo/cc-e2e-app/src/broken.ts", old_string: "import x from './x'", new_string: "import x from './x.js'" } }],
      },
    }),
  ];

  await writeFile(join(dir, `${CC_E2E_SESSION_ID}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

/** Remove the CC e2e transcript dir so the empty-CC-dir assumption holds elsewhere. */
export async function removeClaudeTimelineFixture() {
  await rm(ccTranscriptDir(), { recursive: true, force: true });
}

// --- CC agent-graph e2e fixture (Phase 5) ---
// A CC root with two sub-agents (subagents/agent-<id>.{jsonl,meta.json}) and a
// parent `Task` tool_use per sub-agent (id === meta.toolUseId). Written into the e2e
// CLAUDE_PROJECTS_DIR only for the @graph-tokens CC arm and removed afterward so the
// @sessions exact-count spec (empty CC dir) stays green.
export const CC_E2E_GRAPH_SESSION_ID = "ccgraph01-cc01-4c01-8c01-ccgraph01cc01";
const CC_E2E_GRAPH_CWD = "/repo/cc-e2e-graph-app";
const CC_E2E_GRAPH_SUBAGENTS = [
  { agentId: "reviewer", agentType: "code-reviewer", description: "Review the diff", toolUseId: "toolu_g_review", report: "Reviewed" },
  { agentId: "writer", agentType: "test-writer", description: "Write tests", toolUseId: "toolu_g_write", report: "Wrote tests" },
];

const ccGraphLine = (record: Record<string, unknown> & { type: string }, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    sessionId: CC_E2E_GRAPH_SESSION_ID,
    cwd: CC_E2E_GRAPH_CWD,
    gitBranch: "main",
    version: "1.2.3",
    isSidechain: false,
    userType: "external",
    ...record,
    ...extra,
  });

const ccGraphRootDir = () => join(e2eClaudeProjectsDir(), CC_E2E_GRAPH_CWD.replace(/[/.]/g, "-"));

/** Write the CC agent-graph fixture (root transcript + two sub-agents + meta sidecars). */
export async function writeClaudeAgentGraphFixture() {
  const rootDir = ccGraphRootDir();
  await mkdir(rootDir, { recursive: true });
  await rm(join(e2eCodexHome(), ".observatory", "cache", "v1", "rollouts"), { recursive: true, force: true });

  const rootLines = [
    ccGraphLine({
      type: "user",
      uuid: "g-u1",
      parentUuid: null,
      timestamp: "2026-05-30T10:00:00.000Z",
      message: { role: "user", content: "Coordinate the CC graph work" },
    }),
    ccGraphLine({ type: "ai-title", aiTitle: "CC graph e2e root" }),
    ...CC_E2E_GRAPH_SUBAGENTS.map((sub, index) =>
      ccGraphLine({
        type: "assistant",
        uuid: `g-task-${sub.agentId}`,
        parentUuid: "g-u1",
        timestamp: `2026-05-30T10:00:0${index + 1}.000Z`,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: sub.toolUseId, name: "Task", input: { subagent_type: sub.agentType, description: sub.description } }],
        },
      }),
    ),
  ];
  await writeFile(join(rootDir, `${CC_E2E_GRAPH_SESSION_ID}.jsonl`), `${rootLines.join("\n")}\n`, "utf8");

  const subagentsDir = join(rootDir, CC_E2E_GRAPH_SESSION_ID, "subagents");
  await mkdir(subagentsDir, { recursive: true });
  for (const sub of CC_E2E_GRAPH_SUBAGENTS) {
    const childId = `agent-${sub.agentId}`;
    const childLines = [
      ccGraphLine(
        { type: "user", uuid: `${childId}-u`, parentUuid: null, timestamp: "2026-05-30T10:01:00.000Z", message: { role: "user", content: sub.description } },
        { isSidechain: true, agentId: childId },
      ),
      ccGraphLine(
        {
          type: "assistant",
          uuid: `${childId}-a`,
          parentUuid: `${childId}-u`,
          timestamp: "2026-05-30T10:02:00.000Z",
          message: { role: "assistant", content: [{ type: "text", text: sub.report }], usage: { input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
        },
        { isSidechain: true, agentId: childId },
      ),
    ];
    await writeFile(join(subagentsDir, `${childId}.jsonl`), `${childLines.join("\n")}\n`, "utf8");
    await writeFile(
      join(subagentsDir, `${childId}.meta.json`),
      `${JSON.stringify({ agentType: sub.agentType, description: sub.description, toolUseId: sub.toolUseId })}\n`,
      "utf8",
    );
  }
}

/** Remove the CC agent-graph fixture so the empty-CC-dir assumption holds elsewhere. */
export async function removeClaudeAgentGraphFixture() {
  await rm(ccGraphRootDir(), { recursive: true, force: true });
}

const observedEventMsg = (timestamp: string, turnId: string, payload: Record<string, unknown>) =>
  JSON.stringify({
    type: "event_msg",
    timestamp,
    turn_id: turnId,
    payload,
  });

const observedResponseItem = (timestamp: string, turnId: string, payload: Record<string, unknown>) =>
  JSON.stringify({
    type: "response_item",
    timestamp,
    turn_id: turnId,
    payload,
  });

async function writeRollout(relativePath: string, lines: string[]) {
  const path = join(e2eCodexHome(), relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

export async function writeObservedRolloutFixtures() {
  await rm(join(e2eCodexHome(), ".observatory", "cache", "v1", "rollouts"), { recursive: true, force: true });

  const parentLines = [
    observedEventMsg("2026-05-26T18:00:00.000Z", "turn-observed-parent", {
      type: "task_started",
      text: "Observed task started from event_msg",
    }),
    observedEventMsg("2026-05-26T18:00:01.000Z", "turn-observed-parent", {
      type: "turn_context",
      model: "gpt-5-codex",
      reasoning_effort: "high",
      sandbox_policy: "workspace-write",
      approval_mode: "never",
    }),
    observedResponseItem("2026-05-26T18:00:02.000Z", "turn-observed-parent", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Observed user event group" }],
    }),
    observedResponseItem("2026-05-26T18:00:03.000Z", "turn-observed-parent", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Observed assistant event group" }],
    }),
    observedResponseItem("2026-05-26T18:00:04.000Z", "turn-observed-parent", {
      type: "function_call",
      call_id: "call-observed-shell",
      name: "shell",
      arguments: { cmd: "npm run test -- --run observed-ui" },
    }),
    observedResponseItem("2026-05-26T18:00:05.234Z", "turn-observed-parent", {
      type: "function_call_output",
      call_id: "call-observed-shell",
      name: "shell",
      output: JSON.stringify({
        output: "observed joined shell output",
        exit_code: 7,
        duration_ms: 1234,
        output_token_count: 18,
      }),
    }),
    observedEventMsg("2026-05-26T18:00:06.000Z", "turn-observed-parent", {
      type: "token_count",
      total_token_usage: {
        input_tokens: 7200,
        cached_input_tokens: 320,
        output_tokens: 1220,
        reasoning_output_tokens: 44,
        total_tokens: 8420,
      },
      last_token_usage: {
        input_tokens: 111,
        output_tokens: 222,
      },
      context_window: 128000,
      plan_type: "pro",
      rate_limits: {
        primary_percent: 57,
        secondary_percent: 9,
        reset_at: "2026-05-26T19:00:00.000Z",
      },
    }),
    observedResponseItem("2026-05-26T18:00:07.000Z", "turn-observed-parent", {
      type: "spawn_agent",
      call_id: "call-observed-spawn",
      child_thread_id: "thread-subagent-implementation",
      nickname: "ui-worker",
      role: "implementation",
      task: "Consume enriched API fields in the UI",
    }),
    observedResponseItem("2026-05-26T18:00:08.000Z", "turn-observed-parent", {
      type: "wait_agent",
      call_id: "call-observed-spawn",
      child_thread_id: "thread-subagent-implementation",
      status: "open",
      output: "Observed child report: UI needs enriched fields",
    }),
    observedEventMsg("2026-05-26T18:00:09.000Z", "turn-observed-parent", {
      type: "task_complete",
      last_agent_message: "Observed agent report row: frontend consumed enriched data",
    }),
  ];

  const subagentLines = [
    observedEventMsg("2026-05-26T18:05:00.000Z", "turn-observed-subagent", {
      type: "task_started",
      text: "Observed subagent task started",
    }),
    observedResponseItem("2026-05-26T18:05:01.000Z", "turn-observed-subagent", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Implementation prompt response" }],
    }),
    observedResponseItem("2026-05-26T18:05:02.000Z", "turn-observed-subagent", {
      type: "function_call",
      call_id: "call-subagent-failed",
      name: "shell",
      arguments: { cmd: "npm run e2e -- observed-schema" },
    }),
    observedResponseItem("2026-05-26T18:05:03.000Z", "turn-observed-subagent", {
      type: "function_call_output",
      call_id: "call-subagent-failed",
      name: "shell",
      output: JSON.stringify({
        output: "observed schema failed command summary",
        exit_code: 2,
        duration_ms: 456,
      }),
    }),
    observedEventMsg("2026-05-26T18:05:04.000Z", "turn-observed-subagent", {
      type: "token_count",
      total_token_usage: {
        input_tokens: 0,
        cached_input_tokens: 50,
        output_tokens: 200,
        total_tokens: 200,
      },
      last_token_usage: {
        input_tokens: 17,
        output_tokens: 29,
      },
      context_window: 128000,
      plan_type: "pro",
      rate_limits: {
        primary_percent: 64,
        secondary_percent: 12,
        reset_at: "2026-05-26T19:30:00.000Z",
      },
    }),
  ];

  await writeRollout("sessions/parent.jsonl", parentLines);
  await writeRollout("sessions/subagent.jsonl", subagentLines);
  await writeRollout("sessions/archived.jsonl", parentLines);
}

export async function writeLegacyE2eRolloutFixtures() {
  await rm(join(e2eCodexHome(), ".observatory", "cache", "v1", "rollouts"), { recursive: true, force: true });

  // Multi-line so the `cat` output renders through the structured file peek and
  // overflows its inline cap into an Expand affordance (which opens the modal).
  // The secret stays on line 1 so the redaction assertion still has a target.
  const largeOutput = ["OPENAI_API_KEY=sk-test", ...Array.from({ length: 30 }, (_, index) => `config entry ${index}`)].join("\n");
  const timelineLines = [
    { type: "task_started", timestamp: "2026-05-26T18:00:00.000Z", text: "Timeline task started" },
    { type: "user_message", timestamp: "2026-05-26T18:00:01.000Z", role: "user", content: "Open the selected session" },
    { type: "assistant_message", timestamp: "2026-05-26T18:00:02.000Z", role: "assistant", content: "I will inspect the rollout" },
    { type: "tool_call", timestamp: "2026-05-26T18:00:03.000Z", call_id: "call-1", tool_name: "exec_command", arguments: { cmd: "cat secret.txt" } },
    {
      type: "tool_result",
      timestamp: "2026-05-26T18:00:04.000Z",
      call_id: "call-1",
      tool_name: "exec_command",
      output: largeOutput,
      exit_code: 0,
    },
    {
      type: "token_snapshot",
      timestamp: "2026-05-26T18:00:05.000Z",
      usage: { input_tokens: 1000, output_tokens: 200, cached_input_tokens: 50, reasoning_output_tokens: 25 },
    },
    {
      type: "agent_launch",
      timestamp: "2026-05-26T18:00:06.000Z",
      call_id: "agent-1",
      tool_name: "spawn_agent",
      arguments: { nickname: "timeline-worker", role: "implementation" },
    },
    { type: "agent_wait", timestamp: "2026-05-26T18:00:07.000Z", call_id: "agent-1", tool_name: "wait_agent", output: "worker complete" },
    {
      type: "tool_call",
      timestamp: "2026-05-26T18:00:07.400Z",
      call_id: "skill-1",
      tool_name: "invoke_skill",
      arguments: { skill: "read_pdf", summary: "extract the entity model from the spec pdf" },
    },
    {
      type: "tool_result",
      timestamp: "2026-05-26T18:00:07.600Z",
      call_id: "skill-1",
      tool_name: "invoke_skill",
      output: "skill complete",
      exit_code: 0,
    },
    { level: "warn", timestamp: "2026-05-26T18:00:08.000Z", text: "runtime warning" },
    "{malformed",
    ...Array.from({ length: 22 }, (_, index) => ({
      type: "assistant_message",
      timestamp: `2026-05-26T18:00:${String(10 + index).padStart(2, "0")}.000Z`,
      content: `Scrubber event ${index}`,
    })),
  ].map((line) => (typeof line === "string" ? line : JSON.stringify(line)));

  const invalidRatioLines = timelineLines.map((line) =>
    line.replace(
      JSON.stringify({ input_tokens: 1000, output_tokens: 200, cached_input_tokens: 50, reasoning_output_tokens: 25 }),
      JSON.stringify({ input_tokens: 0, output_tokens: 200, cached_input_tokens: 50, reasoning_output_tokens: 25 }),
    ),
  );

  await writeRollout("sessions/parent.jsonl", timelineLines);
  await writeRollout("sessions/subagent.jsonl", invalidRatioLines);
  await writeRollout("sessions/archived.jsonl", timelineLines);
}

export async function writeObservedLogsDb(logs: ObservedLogSeed[]) {
  const logsDbPath = join(e2eCodexHome(), "logs_2.sqlite");
  await rm(logsDbPath, { force: true });

  const db = new DatabaseSync(logsDbPath);
  db.exec(`
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      ts_nanos INTEGER NOT NULL,
      level TEXT NOT NULL,
      target TEXT NOT NULL,
      feedback_log_body TEXT NOT NULL,
      module_path TEXT,
      file TEXT,
      line INTEGER,
      thread_id TEXT,
      process_uuid TEXT,
      estimated_bytes INTEGER
    );

    CREATE INDEX idx_logs_observed_order ON logs(ts DESC, ts_nanos DESC, id DESC);
    CREATE INDEX idx_logs_observed_filters ON logs(level, target, thread_id);
  `);

  const insert = db.prepare(`
    INSERT INTO logs (
      ts, ts_nanos, level, target, feedback_log_body, module_path, file, line,
      thread_id, process_uuid, estimated_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const log of logs) {
    insert.run(
      log.ts,
      log.tsNanos,
      log.level,
      log.target,
      log.body,
      log.modulePath ?? null,
      log.file ?? null,
      log.line ?? null,
      log.threadId ?? null,
      log.processUuid ?? null,
      log.estimatedBytes ?? Buffer.byteLength(log.body, "utf8"),
    );
  }

  db.close();
}
