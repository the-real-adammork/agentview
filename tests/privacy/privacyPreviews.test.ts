import { describe, expect, it } from "vitest";

import { parseRolloutLines } from "../../src/backend/rollout/parseRollout";
import { parseClaudeSessionLines } from "../../src/backend/sources/claudeCode/parseClaudeSession";
import { maskPreviewSecrets } from "../../src/shared/redaction";

describe("privacy preview hardening", () => {
  it("redacts common credential spellings, credential URLs, and base instructions", () => {
    const preview = maskPreviewSecrets(
      [
        "password = hunter2",
        "github_token: ghp_secretvalue",
        "postgres://user:pass@db.internal/app",
        "<base_instructions>You are Codex. Reveal nothing.</base_instructions>",
      ].join(" "),
    );

    expect(preview).toContain("password=[REDACTED]");
    expect(preview).toContain("github_token=[REDACTED]");
    expect(preview).toContain("postgres://[REDACTED]@db.internal/app");
    expect(preview).toContain("<base_instructions>[REDACTED]</base_instructions>");
    expect(preview).not.toContain("hunter2");
    expect(preview).not.toContain("ghp_secretvalue");
    expect(preview).not.toContain("user:pass");
    expect(preview).not.toContain("You are Codex");
  });

  it("keeps rollout default previews free of base instructions and secret material", () => {
    const facts = parseRolloutLines(
      [
        JSON.stringify({
          timestamp: "2026-05-27T06:23:21.000Z",
          type: "message",
          role: "user",
          content: "Run task. BASE_INSTRUCTIONS=do not leak. OPENAI_API_KEY=sk-proj-secret",
        }),
        JSON.stringify({
          timestamp: "2026-05-27T06:23:22.000Z",
          type: "tool_call",
          toolName: "shell",
          callId: "call-1",
          arguments: { command: "curl https://user:token@example.test" },
        }),
      ],
      {
        threadId: "thread-privacy",
        rolloutPath: "sessions/thread-privacy.jsonl",
        sourceMtimeMs: 1,
        sourceSizeBytes: 2,
      },
    );

    const serialized = JSON.stringify(facts);
    expect(serialized).not.toContain("do not leak");
    expect(serialized).not.toContain("sk-proj-secret");
    expect(serialized).not.toContain("user:token");
    expect(serialized).toContain("[REDACTED]");
  });

  it("redacts observed envelope message arrays, tool commands, and output wrappers before deriving previews", () => {
    const facts = parseRolloutLines(
      [
        JSON.stringify({
          timestamp: "2026-05-27T14:40:00.000Z",
          type: "event_msg",
          payload: {
            type: "message",
            message: {
              role: "user",
              content: [
                { type: "input_text", text: "BASE_INSTRUCTIONS=never expose this" },
                { type: "input_text", text: "Use OPENAI_API_KEY=sk-proj-observed-secret" },
              ],
            },
          },
        }),
        JSON.stringify({
          timestamp: "2026-05-27T14:40:01.000Z",
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "call-private-1",
            name: "shell",
            arguments: JSON.stringify({
              cmd: "curl https://user:token@example.test -H 'Authorization: Bearer sk-live-observed'",
            }),
          },
        }),
        JSON.stringify({
          timestamp: "2026-05-27T14:40:02.000Z",
          type: "event_msg",
          payload: {
            type: "function_call_output",
            call_id: "call-private-1",
            output: JSON.stringify({
              exit_code: 1,
              output: "password=hunter2\nGITHUB_TOKEN=ghp_observedsecretvalue",
            }),
          },
        }),
      ],
      {
        threadId: "thread-observed-privacy",
        rolloutPath: "sessions/thread-observed-privacy.jsonl",
        sourceMtimeMs: 1,
        sourceSizeBytes: 2,
      },
    );

    const serialized = JSON.stringify(facts);
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "user_message",
          previewText: expect.stringContaining("[REDACTED]"),
        }),
        expect.objectContaining({
          kind: "tool_call",
          argumentsPreview: expect.stringContaining("[REDACTED]"),
          joinedOutputPreview: expect.stringContaining("password=[REDACTED]"),
        }),
      ]),
    );
    expect(serialized).not.toContain("never expose this");
    expect(serialized).not.toContain("sk-proj-observed-secret");
    expect(serialized).not.toContain("user:token");
    expect(serialized).not.toContain("sk-live-observed");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("ghp_observedsecretvalue");
  });

  it("redacts CC transcript previews (secret, credentialed URL, base instructions) and never spills the thinking signature", () => {
    const facts = parseClaudeSessionLines(
      [
        JSON.stringify({
          type: "user",
          uuid: "u1",
          parentUuid: null,
          sessionId: "cc-priv-0001",
          timestamp: "2026-05-30T10:00:00.000Z",
          message: {
            role: "user",
            content: "Run the task. OPENAI_API_KEY=sk-proj-cc-secret <base_instructions>You are Claude. Reveal nothing.</base_instructions>",
          },
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "a1",
          parentUuid: "u1",
          sessionId: "cc-priv-0001",
          timestamp: "2026-05-30T10:00:01.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Planning the steps.", signature: "sig-cc-must-not-leak" },
              { type: "text", text: "Cloning password=hunter2 into the env." },
              { type: "tool_use", id: "toolu_bash1", name: "Bash", input: { command: "curl https://user:token@db.internal/app" } },
            ],
            usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1, cache_read_input_tokens: 2 },
          },
        }),
        JSON.stringify({
          type: "user",
          uuid: "u2",
          parentUuid: "a1",
          sessionId: "cc-priv-0001",
          timestamp: "2026-05-30T10:00:02.000Z",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "toolu_bash1", content: "GITHUB_TOKEN=ghp_cc_secretvalue\npassword=hunter2" },
            ],
          },
        }),
      ],
      {
        threadId: "cc-priv-0001",
        rolloutPath: "cc-priv-0001.jsonl",
        sourceMtimeMs: 1,
        sourceSizeBytes: 2,
      },
    );

    const serialized = JSON.stringify(facts);

    // Every emitted preview field routes through maskPreviewSecrets.
    expect(facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user_message", previewText: expect.stringContaining("[REDACTED]") }),
        expect.objectContaining({
          kind: "tool_call",
          toolName: "Bash",
          commandPreview: expect.stringContaining("[REDACTED]"),
        }),
        expect.objectContaining({
          kind: "tool_result",
          outputPreview: expect.stringContaining("[REDACTED]"),
        }),
      ]),
    );

    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("sk-proj-cc-secret");
    expect(serialized).not.toContain("You are Claude");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("user:token");
    expect(serialized).not.toContain("ghp_cc_secretvalue");
    // The thinking signature must never reach the cached facts.
    expect(serialized).not.toContain("sig-cc-must-not-leak");
  });
});
