import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { CachedRolloutFacts, TimelineEventKind } from "../../src/shared/contracts";

interface ParseClaudeModule {
  CLAUDE_PARSER_VERSION: number;
  parseClaudeSessionLines(
    lines: string[],
    options: {
      threadId: string;
      rolloutPath: string;
      sourceMtimeMs: number;
      sourceSizeBytes: number;
    },
  ): CachedRolloutFacts;
}

const parseClaudeSpecifier = [
  "..",
  "..",
  "src",
  "backend",
  "sources",
  "claudeCode",
  "parseClaudeSession",
].join("/");

const loadParseClaude = async () =>
  (await import(/* @vite-ignore */ parseClaudeSpecifier)) as ParseClaudeModule;

const fixturePath = join(process.cwd(), "tests", "fixtures", "claude-code", "plain-session.jsonl");

const loadFixtureLines = async () => {
  const body = await readFile(fixturePath, "utf8");
  return body.split("\n").filter((line) => line.trim().length > 0);
};

const parseFixture = async (): Promise<{ facts: CachedRolloutFacts; module: ParseClaudeModule }> => {
  const module = await loadParseClaude();
  const lines = await loadFixtureLines();
  const facts = module.parseClaudeSessionLines(lines, {
    threadId: "cc-plain-0001",
    rolloutPath: fixturePath,
    sourceMtimeMs: 111,
    sourceSizeBytes: 222,
  });
  return { facts, module };
};

const kindsOf = (facts: CachedRolloutFacts): TimelineEventKind[] => facts.events.map((event) => event.kind);

describe("parseClaudeSessionLines", () => {
  it("maps CC line/block shapes to the same TimelineEventKind sequence Codex would emit", async () => {
    const { facts, module } = await parseFixture();

    // user text → user_message; assistant thinking → reasoning; assistant text →
    // assistant_message; an assistant line with usage synthesizes a token_snapshot;
    // tool_use → tool_call (Read/Bash/Edit); the following tool_result → tool_result;
    // Agent → agent_launch. Metadata lines (ai-title) are skipped.
    expect(kindsOf(facts)).toEqual([
      "user_message",
      "reasoning",
      "assistant_message",
      "token_snapshot",
      "tool_call", // Read
      "tool_result",
      "tool_call", // Bash
      "tool_result",
      "tool_call", // Edit
      "tool_result",
      "agent_launch",
    ]);

    expect(facts.parserVersion).toBe(module.CLAUDE_PARSER_VERSION);
    expect(facts.threadId).toBe("cc-plain-0001");
    expect(facts.sourceMtimeMs).toBe(111);
    expect(facts.sourceSizeBytes).toBe(222);
  });

  it("redacts every preview through maskPreviewSecrets and never spills the thinking signature", async () => {
    const { facts } = await parseFixture();
    const serialized = JSON.stringify(facts);

    // The planted secret must be redacted, never raw.
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("sk-cc-should-not-render");
    // The thinking signature must never reach the row.
    expect(serialized).not.toContain("sig-do-not-render");

    const reasoning = facts.events.find((event) => event.kind === "reasoning");
    expect(reasoning?.previewText).toContain("find the build break");
    expect(reasoning?.previewText).not.toContain("sig-do-not-render");
  });

  it("synthesizes a token_snapshot from message.usage per the §D mapping", async () => {
    const { facts } = await parseFixture();
    const snapshot = facts.events.find((event) => event.kind === "token_snapshot")?.tokenSnapshot;

    expect(snapshot).toBeDefined();
    // input = input_tokens + cache_creation_input_tokens (folded into input)
    expect(snapshot?.input).toBe(1200 + 40);
    expect(snapshot?.output).toBe(80);
    expect(snapshot?.cachedInput).toBe(600);
    // total = input + output + cachedInput
    expect(snapshot?.total).toBe(1200 + 40 + 80 + 600);
    expect(facts.tokenSnapshots).toHaveLength(1);
  });

  it("classifies the Bash result via classifyExecOutput (git status → status render)", async () => {
    const { facts } = await parseFixture();
    const bashCall = facts.events.find((event) => event.kind === "tool_call" && event.toolName === "Bash");
    expect(bashCall?.outputRender?.kind).toBe("status");
  });

  it("builds a read callRender for Read and a diff outputRender for Edit", async () => {
    const { facts } = await parseFixture();
    const readCall = facts.events.find((event) => event.kind === "tool_call" && event.toolName === "Read");
    expect(readCall?.callRender).toMatchObject({ kind: "read", path: "/repo/cc-app/src/broken.ts" });

    const editCall = facts.events.find((event) => event.kind === "tool_call" && event.toolName === "Edit");
    expect(editCall?.outputRender?.kind).toBe("diff");
    const diff = editCall?.outputRender;
    if (diff?.kind === "diff") {
      expect(diff.files[0]?.path).toBe("/repo/cc-app/src/broken.ts");
      expect(diff.files[0]?.removed).toBeGreaterThan(0);
      expect(diff.files[0]?.added).toBeGreaterThan(0);
    }
  });

  it("emits an agent_launch with role + task preview for the Agent tool_use", async () => {
    const { facts } = await parseFixture();
    const launch = facts.events.find((event) => event.kind === "agent_launch");
    expect(launch?.agentRole).toBe("verifier");
    expect(launch?.agentTaskPreview).toContain("Verify the fix");
    expect(facts.agentLaunches).toHaveLength(1);
    expect(facts.agentLaunches[0]?.role).toBe("verifier");
  });

  it("reconstructs a shared turnId across the user→assistant→tool_result chain", async () => {
    const { facts } = await parseFixture();
    const userMessage = facts.events.find((event) => event.kind === "user_message");
    const turnId = userMessage?.turnId;
    expect(turnId).toBeTruthy();

    // The assistant reply, its token snapshot, the tool calls, and the joined
    // tool_result rows all chain back to the same top-level user message.
    const reasoning = facts.events.find((event) => event.kind === "reasoning");
    const readCall = facts.events.find((event) => event.kind === "tool_call" && event.toolName === "Read");
    const readResult = facts.events.find((event) => event.kind === "tool_result");
    expect(reasoning?.turnId).toBe(turnId);
    expect(readCall?.turnId).toBe(turnId);
    expect(readResult?.turnId).toBe(turnId);

    expect(facts.turns).toHaveLength(1);
    expect(facts.turns[0]?.turnId).toBe(turnId);
  });

  it("leaves warnings empty for an all-known-types fixture", async () => {
    const { facts } = await parseFixture();
    expect(facts.warnings).toEqual([]);
    expect(facts.summary.warningCount).toBe(0);
    expect(facts.summary.toolCallCount).toBe(3);
  });

  it("strips the carried fullOutput/fullArguments helpers from emitted events", async () => {
    const { facts } = await parseFixture();
    for (const event of facts.events) {
      expect(event).not.toHaveProperty("fullOutput");
      expect(event).not.toHaveProperty("fullArguments");
    }
  });
});
