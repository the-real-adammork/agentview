import { describe, expect, it } from "vitest";

import { deriveSessionTitle } from "../../src/backend/sqlite/threadTitle";

const base = {
  id: "thread-id",
  title: null,
  firstUserMessage: null,
  preview: null,
  threadSource: null,
  agentRole: null,
  agentNickname: null,
};

describe("deriveSessionTitle", () => {
  it("uses the thread title for user threads", () => {
    expect(deriveSessionTitle({ ...base, threadSource: "user", title: "Summarize the PRD" })).toBe(
      "Summarize the PRD",
    );
  });

  it("falls back through first user message, preview, then id for user threads", () => {
    expect(deriveSessionTitle({ ...base, firstUserMessage: "first msg" })).toBe("first msg");
    expect(deriveSessionTitle({ ...base, preview: "a preview" })).toBe("a preview");
    expect(deriveSessionTitle({ ...base })).toBe("thread-id");
  });

  it("leads a sub-agent title with its own nickname when the title is inherited from the parent", () => {
    // Real-world case: child threads carry the parent's prompt as title/firstUserMessage,
    // but each has its own nickname.
    expect(
      deriveSessionTitle({
        ...base,
        threadSource: "subagent",
        title: "ok summarize the PRD",
        firstUserMessage: "ok summarize the PRD",
        agentNickname: "Jason",
      }),
    ).toBe("Jason · ok summarize the PRD");
  });

  it("includes role and nickname when both are present", () => {
    expect(
      deriveSessionTitle({
        ...base,
        threadSource: "subagent",
        title: "review the diff",
        agentRole: "task-reviewer",
        agentNickname: "Poincare",
      }),
    ).toBe("task-reviewer · Poincare · review the diff");
  });

  it("keeps the base title for sub-agents that have no identity fields", () => {
    expect(
      deriveSessionTitle({
        ...base,
        threadSource: "subagent",
        title: "agent_name: design-reviewer: meridian",
      }),
    ).toBe("agent_name: design-reviewer: meridian");
  });

  it("does not duplicate identity when the base title already equals it", () => {
    expect(
      deriveSessionTitle({ ...base, threadSource: "subagent", title: "Jason", agentNickname: "Jason" }),
    ).toBe("Jason");
  });
});
