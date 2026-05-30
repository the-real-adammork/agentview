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
