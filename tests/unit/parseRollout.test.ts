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
});
