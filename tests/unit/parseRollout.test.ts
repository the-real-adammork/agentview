import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CachedRolloutFacts } from "../../src/shared/contracts";

interface ParseRolloutModule {
  parseRolloutFile(
    path: string,
    options: {
      threadId: string;
      rolloutPath: string;
      sourceMtimeMs: number;
      sourceSizeBytes: number;
    },
  ): Promise<CachedRolloutFacts>;
}

const parseRolloutSpecifier = ["..", "..", "src", "backend", "rollout", "jsonlStream"].join("/");

const tempRoots: string[] = [];

const loadParseRollout = async () => (await import(/* @vite-ignore */ parseRolloutSpecifier)) as ParseRolloutModule;

const createTempRollout = async (lines: Array<Record<string, unknown> | string>) => {
  const root = await mkdtemp(join(tmpdir(), "agentview-rollout-parser-"));
  tempRoots.push(root);
  const rolloutPath = join(root, "session.jsonl");
  await writeFile(
    rolloutPath,
    `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`,
  );
  return rolloutPath;
};

const parseFixture = async (threadId: string, rolloutPath: string) => {
  const { parseRolloutFile } = await loadParseRollout();
  const sourceStat = await stat(rolloutPath);
  return parseRolloutFile(rolloutPath, {
    threadId,
    rolloutPath,
    sourceMtimeMs: sourceStat.mtimeMs,
    sourceSizeBytes: sourceStat.size,
  });
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("parseRolloutFile", () => {
  it("parses observed event_msg and response_item envelopes with nested payload types and message content arrays", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-27T14:00:00.000Z",
        type: "event_msg",
        turn_id: "turn-observed-1",
        payload: {
          type: "task_started",
          task: "Close rollout parser gaps",
        },
      },
      {
        timestamp: "2026-05-27T14:00:01.000Z",
        type: "event_msg",
        turn_id: "turn-observed-1",
        payload: {
          type: "message",
          message: {
            role: "user",
            content: [
              { type: "input_text", text: "Parse the observed rollout envelope." },
              { type: "input_text", text: "Keep previews compact." },
            ],
          },
        },
      },
      {
        timestamp: "2026-05-27T14:00:02.000Z",
        type: "response_item",
        turn_id: "turn-observed-1",
        payload: {
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "output_text", text: "I will add parser coverage first." }],
          },
        },
      },
      {
        timestamp: "2026-05-27T14:00:03.000Z",
        type: "event_msg",
        turn_id: "turn-observed-1",
        payload: {
          type: "task_complete",
          last_agent_message: "Tests proposed for rollout parser.",
        },
      },
    ]);

    const facts = await parseFixture("thread-observed-envelope", rolloutPath);

    expect(facts.warnings).toEqual([]);
    expect(facts.events.map((event) => event.kind)).toEqual([
      "task_started",
      "user_message",
      "assistant_message",
      "task_complete",
    ]);
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "user_message",
          turnId: "turn-observed-1",
          previewText: "Parse the observed rollout envelope. Keep previews compact.",
        }),
        expect.objectContaining({
          kind: "assistant_message",
          previewText: "I will add parser coverage first.",
        }),
        expect.objectContaining({
          kind: "task_complete",
          previewText: "Tests proposed for rollout parser.",
        }),
      ]),
    );
    expect(facts.turns).toEqual([
      expect.objectContaining({
        turnId: "turn-observed-1",
        startedAt: "2026-05-27T14:00:00.000Z",
        completedAt: "2026-05-27T14:00:03.000Z",
        lastAgentMessagePreview: "Tests proposed for rollout parser.",
      }),
    ]);
  });

  it("normalizes known Codex rollout variants into stable timeline events", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-26T18:00:00.000Z",
        type: "thread.started",
        task: "Build the Timeline view",
      },
      {
        timestamp: "2026-05-26T18:00:01.000Z",
        type: "turn_context",
        turn_id: "turn-1",
        cwd: "/repo/agentview",
        model: "gpt-5-codex",
      },
      {
        timestamp: "2026-05-26T18:00:02.000Z",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Show the selected session timeline." }],
      },
      {
        timestamp: "2026-05-26T18:00:03.000Z",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "I will inspect the rollout." }],
      },
      {
        timestamp: "2026-05-26T18:00:04.000Z",
        type: "reasoning",
        text: "Need parser coverage before implementation.",
      },
      {
        timestamp: "2026-05-26T18:00:05.000Z",
        type: "message",
        role: "agent",
        agent_nickname: "parser-cache",
        content: [{ type: "output_text", text: "Worker accepted the parser/cache lane." }],
      },
      {
        timestamp: "2026-05-26T18:00:06.000Z",
        type: "thread.completed",
        status: "complete",
      },
    ]);

    const facts = await parseFixture("thread-parser", rolloutPath);

    expect(facts).toMatchObject({
      threadId: "thread-parser",
      rolloutPath,
      parserVersion: expect.any(Number),
      sourceSizeBytes: expect.any(Number),
      parsedThroughByte: expect.any(Number),
      warnings: [],
    });
    expect(facts.events.map((event) => event.kind)).toEqual([
      "task_started",
      "turn_context",
      "user_message",
      "assistant_message",
      "reasoning",
      "agent_message",
      "task_complete",
    ]);
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          threadId: "thread-parser",
          sourceLine: 3,
          kind: "user_message",
          previewText: "Show the selected session timeline.",
        }),
        expect.objectContaining({
          kind: "agent_message",
          previewText: "Worker accepted the parser/cache lane.",
        }),
      ]),
    );
  });

  it("emits parse-error and warning events for malformed lines and unknown rollout events", async () => {
    const rolloutPath = await createTempRollout([
      { timestamp: "2026-05-26T18:01:00.000Z", type: "message", role: "user", text: "Start" },
      "{ this is not valid json",
      { timestamp: "2026-05-26T18:01:02.000Z", type: "codex.future_event", payload: { shape: "new" } },
    ]);

    const facts = await parseFixture("thread-errors", rolloutPath);

    expect(facts.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("line 2"),
        expect.stringContaining("codex.future_event"),
      ]),
    );
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceLine: 2,
          kind: "parse_error",
          severity: "error",
          previewText: expect.stringContaining("Malformed JSON"),
        }),
        expect.objectContaining({
          sourceLine: 3,
          kind: "warning",
          severity: "warning",
          previewText: expect.stringContaining("codex.future_event"),
        }),
      ]),
    );
  });

  it("joins tool call arguments with matching output and redacts previews before caching", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-26T18:02:00.000Z",
        type: "function_call",
        call_id: "call-shell-1",
        name: "shell",
        arguments: JSON.stringify({ cmd: "curl -H 'Authorization: Bearer sk-live-secret' https://api.example.test" }),
      },
      {
        timestamp: "2026-05-26T18:02:01.000Z",
        type: "function_call_output",
        call_id: "call-shell-1",
        output: "TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890abcd\nfinished",
        exit_code: 0,
        duration_ms: 345,
      },
    ]);

    const facts = await parseFixture("thread-tools", rolloutPath);

    expect(facts.toolCalls).toEqual([
      expect.objectContaining({
        callId: "call-shell-1",
        toolName: "shell",
        argumentsPreview: expect.stringContaining("[REDACTED]"),
        outputPreview: expect.stringContaining("TOKEN=[REDACTED]"),
        outputBytes: expect.any(Number),
        exitCode: 0,
      }),
    ]);
    expect(JSON.stringify(facts.events)).not.toContain("sk-live-secret");
    expect(JSON.stringify(facts.events)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890abcd");
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          callId: "call-shell-1",
          toolName: "shell",
          argumentsPreview: expect.stringContaining("[REDACTED]"),
        }),
        expect.objectContaining({
          kind: "tool_result",
          callId: "call-shell-1",
          outputPreview: expect.stringContaining("TOKEN=[REDACTED]"),
          hasRawAvailable: true,
        }),
      ]),
    );
  });

  it("normalizes token snapshots and agent spawn/wait events", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-26T18:03:00.000Z",
        type: "token_count",
        total_token_usage: {
          input_tokens: 1200,
          cached_input_tokens: 300,
          output_tokens: 400,
          reasoning_output_tokens: 50,
          total_tokens: 1600,
        },
        context_window: 200000,
        rate_limits: { primary_percent: 25, secondary_percent: 10, reset_at: "2026-05-26T19:00:00.000Z" },
      },
      {
        timestamp: "2026-05-26T18:03:01.000Z",
        type: "agent.spawn",
        child_thread_id: "thread-child",
        agent_nickname: "timeline-ui",
        agent_role: "implementation",
      },
      {
        timestamp: "2026-05-26T18:03:02.000Z",
        type: "agent.wait",
        child_thread_id: "thread-child",
        status: "closed",
        duration_ms: 2000,
      },
    ]);

    const facts = await parseFixture("thread-tokens", rolloutPath);

    expect(facts.tokenSnapshots).toEqual([
      expect.objectContaining({
        timestamp: "2026-05-26T18:03:00.000Z",
        input: 1200,
        cachedInput: 300,
        output: 400,
        reasoningOutput: 50,
        total: 1600,
        contextUtilization: 0.008,
        rateLimitPrimaryPercent: 25,
        rateLimitSecondaryPercent: 10,
        resetAt: "2026-05-26T19:00:00.000Z",
      }),
    ]);
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "token_snapshot",
          previewText: expect.stringContaining("1,600"),
        }),
        expect.objectContaining({
          kind: "agent_launch",
          previewText: expect.stringContaining("timeline-ui"),
        }),
        expect.objectContaining({
          kind: "agent_wait",
          durationMs: 2000,
          previewText: expect.stringContaining("thread-child"),
        }),
      ]),
    );
  });

  it("reads token usage nested under payload.info and rate_limits.primary.used_percent (real Codex shape)", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-28T22:43:55.379Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 18730,
              cached_input_tokens: 14720,
              output_tokens: 281,
              reasoning_output_tokens: 124,
              total_tokens: 19011,
            },
            last_token_usage: { input_tokens: 18730, output_tokens: 281 },
            model_context_window: 258400,
          },
          rate_limits: {
            primary: { used_percent: 29, window_minutes: 300, resets_at: 1780014161 },
            secondary: { used_percent: 85, window_minutes: 10080 },
            plan_type: "pro",
          },
        },
      },
    ]);

    const facts = await parseFixture("thread-token-info", rolloutPath);

    expect(facts.warnings).toEqual([]);
    expect(facts.tokenSnapshots).toEqual([
      expect.objectContaining({
        input: 18730,
        cachedInput: 14720,
        output: 281,
        reasoningOutput: 124,
        total: 19011,
        lastInput: 18730,
        lastOutput: 281,
        modelContextWindow: 258400,
        planType: "pro",
        rateLimitPrimaryPercent: 29,
        rateLimitSecondaryPercent: 85,
      }),
    ]);
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "token_snapshot", previewText: expect.stringContaining("19,011") }),
      ]),
    );
    // The raw token_count JSON must never leak into a preview row.
    expect(JSON.stringify(facts.events)).not.toContain("total_token_usage");
  });

  it("does not dump encrypted reasoning content into the preview", async () => {
    const encrypted = "gAAAAABqGMUo9ouw-NttNvTrJ76ZGf6xIHyZ1xf9l1lVwSLc5KLaKcf";
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-28T22:43:52.485Z",
        type: "response_item",
        payload: { type: "reasoning", summary: [], content: null, encrypted_content: encrypted },
      },
    ]);

    const facts = await parseFixture("thread-reasoning", rolloutPath);

    expect(facts.warnings).toEqual([]);
    const reasoning = facts.events.find((event) => event.kind === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning?.previewText).not.toContain("gAAAAAB");
    expect(JSON.stringify(facts.events)).not.toContain(encrypted);
  });

  it("recognizes Codex metadata and tool event types instead of flagging them as unknown", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T01:21:20.536Z",
        type: "event_msg",
        payload: { type: "thread_goal_updated", goal: { objective: "Ship the timeline parser fixes." } },
      },
      {
        timestamp: "2026-05-28T22:48:36.447Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call-patch-1",
          stdout: "Success. Updated the following files:\nA docs/overview.md\n",
          success: true,
        },
      },
      {
        timestamp: "2026-05-28T23:36:54.170Z",
        type: "response_item",
        payload: { type: "web_search_call", status: "completed", action: { type: "search", query: "Robinhood trading UI" } },
      },
      { timestamp: "2026-05-29T01:38:11.466Z", type: "event_msg", payload: { type: "context_compacted" } },
      { timestamp: "2026-05-28T17:42:49.000Z", type: "session_meta", payload: { cwd: "/repo" } },
    ]);

    const facts = await parseFixture("thread-codex-types", rolloutPath);

    expect(facts.warnings.filter((warning) => /unknown rollout event/i.test(warning))).toEqual([]);
    expect(facts.events.filter((event) => event.previewText?.includes("Unknown rollout event"))).toEqual([]);
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "turn_context", previewText: expect.stringContaining("Ship the timeline parser fixes") }),
        expect.objectContaining({ kind: "tool_result", callId: "call-patch-1", outputPreview: expect.stringContaining("Success") }),
        expect.objectContaining({ kind: "tool_call" }),
      ]),
    );
  });

  it("parses custom_tool_call apply_patch input and treats its output as a result", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-28T22:48:36.445Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          status: "completed",
          call_id: "call-apply-1",
          name: "apply_patch",
          input: "*** Begin Patch\n*** Add File: docs/overview.md\n+# Overview\n*** End Patch",
        },
      },
      {
        timestamp: "2026-05-28T22:48:36.460Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "call-apply-1",
          output: "Success. Updated docs/overview.md",
        },
      },
    ]);

    const facts = await parseFixture("thread-custom-tool", rolloutPath);

    expect(facts.warnings).toEqual([]);
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          toolName: "apply_patch",
          callId: "call-apply-1",
          argumentsPreview: expect.stringContaining("Begin Patch"),
        }),
        expect.objectContaining({ kind: "tool_result", callId: "call-apply-1" }),
      ]),
    );
  });

  it("reads a string agent_message payload instead of dumping the raw envelope", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T02:45:51.503Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "The dev server is running now.", phase: "commentary" },
      },
    ]);

    const facts = await parseFixture("thread-agent-message", rolloutPath);

    expect(facts.warnings).toEqual([]);
    const agent = facts.events.find((event) => event.kind === "agent_message");
    expect(agent?.previewText).toBe("The dev server is running now.");
    expect(JSON.stringify(facts.events)).not.toContain('"type":"agent_message"');
  });

  it("derives observed token, tool, spawn, and wait facts from payload envelopes", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-27T14:05:00.000Z",
        type: "event_msg",
        turn_id: "turn-observed-2",
        payload: {
          type: "token_count",
          last_token_usage: { input_tokens: 11, output_tokens: 7 },
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 250,
            output_tokens: 300,
            reasoning_output_tokens: 25,
            total_tokens: 1325,
          },
          model_context_window: 200000,
          plan_type: "pro",
          rate_limits: {
            primary_percent: 12.5,
            secondary_percent: 4,
            reset_at: "2026-05-27T15:00:00.000Z",
          },
        },
      },
      {
        timestamp: "2026-05-27T14:05:01.000Z",
        type: "response_item",
        turn_id: "turn-observed-2",
        payload: {
          type: "function_call",
          call_id: "call-fail-1",
          name: "shell",
          arguments: JSON.stringify({ cmd: "npm run missing-script" }),
        },
      },
      {
        timestamp: "2026-05-27T14:05:04.500Z",
        type: "event_msg",
        turn_id: "turn-observed-2",
        payload: {
          type: "function_call_output",
          call_id: "call-fail-1",
          output: JSON.stringify({
            exit_code: 127,
            duration_ms: 3500,
            output: "npm ERR! Missing script: missing-script\nOPENAI_API_KEY=sk-proj-rollout-secret",
          }),
        },
      },
      {
        timestamp: "2026-05-27T14:05:05.000Z",
        type: "response_item",
        turn_id: "turn-observed-2",
        payload: {
          type: "spawn_agent",
          call_id: "call-spawn-1",
          child_thread_id: "thread-child-observed",
          agent_nickname: "rollout-parser",
          agent_role: "test-only worker",
          task: "Write failing parser tests.",
        },
      },
      {
        timestamp: "2026-05-27T14:05:08.000Z",
        type: "event_msg",
        turn_id: "turn-observed-2",
        payload: {
          type: "wait_agent",
          call_id: "call-spawn-1",
          child_thread_id: "thread-child-observed",
          status: "closed",
          last_agent_message: "Parser tests are ready.",
        },
      },
    ]);

    const facts = await parseFixture("thread-observed-facts", rolloutPath);

    expect(facts.tokenSnapshots).toEqual([
      expect.objectContaining({
        input: 1000,
        cachedInput: 250,
        output: 300,
        reasoningOutput: 25,
        total: 1325,
        lastInput: 11,
        lastOutput: 7,
        modelContextWindow: 200000,
        planType: "pro",
        rateLimitPrimaryPercent: 12.5,
        rateLimitSecondaryPercent: 4,
        resetAt: "2026-05-27T15:00:00.000Z",
      }),
    ]);
    expect(facts.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callId: "call-fail-1",
          toolName: "shell",
          startedAt: "2026-05-27T14:05:01.000Z",
          completedAt: "2026-05-27T14:05:04.500Z",
          durationMs: 3500,
          exitCode: 127,
          resultEventId: expect.any(String),
          commandPreview: "npm run missing-script",
          failureReasonPreview: expect.stringContaining("Missing script"),
          outputPreview: expect.stringContaining("OPENAI_API_KEY=[REDACTED]"),
        }),
      ]),
    );
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          callId: "call-fail-1",
          joinedOutputPreview: expect.stringContaining("Missing script"),
          joinedExitCode: 127,
          joinedDurationMs: 3500,
          severity: "error",
        }),
        expect.objectContaining({
          kind: "agent_launch",
          callId: "call-spawn-1",
          childThreadId: "thread-child-observed",
          agentNickname: "rollout-parser",
          agentRole: "test-only worker",
          agentTaskPreview: "Write failing parser tests.",
        }),
        expect.objectContaining({
          kind: "agent_wait",
          callId: "call-spawn-1",
          childThreadId: "thread-child-observed",
          previewText: expect.stringContaining("Parser tests are ready."),
        }),
      ]),
    );
    expect(facts.agentLaunches).toEqual([
      expect.objectContaining({
        callId: "call-spawn-1",
        childThreadId: "thread-child-observed",
        nickname: "rollout-parser",
        role: "test-only worker",
        taskPreview: "Write failing parser tests.",
      }),
    ]);
    expect(facts.agentWaits).toEqual([
      expect.objectContaining({
        callId: "call-spawn-1",
        childThreadId: "thread-child-observed",
        status: "closed",
        reportPreview: "Parser tests are ready.",
      }),
    ]);
    expect(JSON.stringify(facts)).not.toContain("sk-proj-rollout-secret");
  });

  it("strips the Codex exec_command streaming envelope (Chunk ID / Process exited / Output:)", async () => {
    const wrapped = [
      "Chunk ID: abc123",
      "Wall time: 0.0000 seconds",
      "Process exited with code 0",
      "Original token count: 42",
      "Output:",
      " M src/app.tsx",
      "?? scratch/notes.md",
    ].join("\n");
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T13:00:00.000Z",
        type: "function_call",
        call_id: "c-env",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "git status --short" }),
      },
      { timestamp: "2026-05-29T13:00:01.000Z", type: "function_call_output", call_id: "c-env", output: wrapped },
    ]);
    const facts = await parseFixture("thread-env", rolloutPath);
    const call = facts.events.find((e) => e.kind === "tool_call" && e.callId === "c-env");
    // The wrapper must never reach the UI — not in any preview, not in the render.
    expect(JSON.stringify(facts.events)).not.toContain("Chunk ID");
    expect(JSON.stringify(facts.events)).not.toContain("Process exited with code");
    expect(call?.joinedOutputPreview ?? "").not.toContain("Original token count");
    // With the envelope gone, the real output classifies and the exit code is read from it.
    expect(call?.outputRender).toMatchObject({ kind: "status" });
    expect(call?.joinedExitCode).toBe(0);
  });

  it("classifies a git diff tool call into a structured outputRender on the joined call", async () => {
    const diff = [
      "diff --git a/src/db.rs b/src/db.rs",
      "--- a/src/db.rs",
      "+++ b/src/db.rs",
      "@@ -40,2 +40,3 @@ fn open() {",
      " let db = 1;",
      "-old line",
      "+new line one",
      "+new line two",
    ].join("\n");
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T10:00:00.000Z",
        type: "function_call",
        call_id: "call-diff-1",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "git diff -- src/db.rs" }),
      },
      {
        timestamp: "2026-05-29T10:00:01.000Z",
        type: "function_call_output",
        call_id: "call-diff-1",
        output: diff,
        exit_code: 0,
      },
    ]);

    const facts = await parseFixture("thread-diff", rolloutPath);
    const call = facts.events.find((event) => event.kind === "tool_call" && event.callId === "call-diff-1");
    expect(call?.outputRender).toMatchObject({
      kind: "diff",
      files: [expect.objectContaining({ path: "src/db.rs", added: 2, removed: 1 })],
    });
    // The transient full output must never reach the serialized payload.
    expect(JSON.stringify(facts.events)).not.toContain("fullOutput");
  });

  it("recognizes image_generation events as tool calls/results instead of unknown warnings", async () => {
    const rolloutPath = await createTempRollout([
      { timestamp: "2026-05-29T12:20:00.000Z", type: "response_item", payload: { type: "image_generation_call", call_id: "img1", prompt: "a cat" } },
      { timestamp: "2026-05-29T12:20:01.000Z", type: "response_item", payload: { type: "image_generation_end", call_id: "img1", output: "saved image.png" } },
    ]);
    const facts = await parseFixture("thread-img", rolloutPath);
    expect(facts.warnings.filter((w) => /unknown rollout event/i.test(w))).toEqual([]);
    expect(facts.events.find((e) => e.callId === "img1" && e.kind === "tool_call")).toBeDefined();
    expect(facts.events.find((e) => e.callId === "img1" && e.kind === "tool_result")).toBeDefined();
  });

  it("labels a truly unknown event type cleanly without dumping its raw JSON", async () => {
    const rolloutPath = await createTempRollout([
      { timestamp: "2026-05-29T12:21:00.000Z", type: "event_msg", payload: { type: "codex_brand_new_thing", detail: { nested: 1 } } },
    ]);
    const facts = await parseFixture("thread-unknown", rolloutPath);
    const warning = facts.events.find((e) => e.kind === "warning");
    expect(warning?.previewText).toContain("codex_brand_new_thing");
    expect(warning?.previewText).not.toContain("{");
  });

  it("recognizes web_search_call / tool_search_call and gives them clean labels, not raw JSON", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T12:10:00.000Z",
        type: "response_item",
        payload: { type: "web_search_call", status: "completed", action: { type: "search", query: "Replicate API pricing" } },
      },
      {
        timestamp: "2026-05-29T12:10:01.000Z",
        type: "response_item",
        payload: { type: "tool_search_call", call_id: "call-ts", status: "completed", query: "ripgrep flags" },
      },
    ]);
    const facts = await parseFixture("thread-search", rolloutPath);
    expect(facts.warnings.filter((w) => /unknown rollout event/i.test(w))).toEqual([]);
    const web = facts.events.find((e) => e.previewText.includes("Replicate API pricing"));
    expect(web?.kind).toBe("tool_call");
    expect(web?.previewText).not.toContain("{");
    const toolSearch = facts.events.find((e) => e.kind === "tool_call" && e.callId === "call-ts");
    expect(toolSearch).toBeDefined();
    expect(toolSearch?.previewText).not.toContain("{");
  });

  it("gives a function_call_output with no tool name a clean preview instead of raw JSON", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T12:11:00.000Z",
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call-x", output: "done", exit_code: 0 },
      },
    ]);
    const facts = await parseFixture("thread-result", rolloutPath);
    const result = facts.events.find((e) => e.kind === "tool_result");
    expect(result?.previewText).not.toContain("{");
    expect(result?.previewText).toMatch(/completed/i);
  });

  it("summarizes turn_context as compact context instead of dumping the raw payload", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T12:00:00.000Z",
        type: "event_msg",
        turn_id: "turn-ctx",
        payload: { type: "turn_context", cwd: "/repo/agentview", model: "gpt-5-codex", reasoning_effort: "high" },
      },
    ]);
    const facts = await parseFixture("thread-turn-context", rolloutPath);
    const context = facts.events.find((event) => event.kind === "turn_context");
    expect(context?.previewText).not.toContain("{");
    expect(context?.previewText).toContain("gpt-5-codex");
    expect(context?.previewText).toContain("/repo/agentview");
  });

  it("renders an aborted-turn warning from its reason, not the raw payload", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T12:01:00.000Z",
        type: "event_msg",
        payload: { type: "turn_aborted", turn_id: "turn-ab", reason: "interrupted by user" },
      },
    ]);
    const facts = await parseFixture("thread-abort", rolloutPath);
    const warning = facts.events.find((event) => event.kind === "warning");
    expect(warning?.previewText).toContain("interrupted by user");
    expect(warning?.previewText).not.toContain("{");
  });

  it("maps invoke_skill tool calls to skill_invoke and keeps them out of the Tools count", async () => {
    const rolloutPath = await createTempRollout([
      {
        timestamp: "2026-05-29T11:00:00.000Z",
        type: "function_call",
        call_id: "call-skill-1",
        name: "invoke_skill",
        arguments: JSON.stringify({ skill: "read_pdf", summary: "extract entity model from spec.pdf (12 pp)" }),
      },
      {
        timestamp: "2026-05-29T11:00:02.000Z",
        type: "function_call_output",
        call_id: "call-skill-1",
        output: "ok",
        exit_code: 0,
      },
    ]);

    const facts = await parseFixture("thread-skill", rolloutPath);
    const skill = facts.events.find((event) => event.kind === "skill_invoke");
    expect(skill).toMatchObject({
      kind: "skill_invoke",
      skillName: "read_pdf",
      skillStatus: "ok",
      previewText: expect.stringContaining("entity model"),
    });
    // Skills are isolated from tool calls so the Tools tab/count excludes them.
    expect(facts.toolCalls.find((call) => call.callId === "call-skill-1")).toBeUndefined();
    expect(facts.summary.toolCallCount).toBe(0);
  });
});
