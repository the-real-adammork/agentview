import { describe, expect, it } from "vitest";

import { parseRolloutLines } from "../../src/backend/rollout/parseRollout";
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
});
