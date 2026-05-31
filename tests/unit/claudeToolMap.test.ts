import { describe, expect, it } from "vitest";

import { classifyExecOutput } from "../../src/backend/rollout/classifyExecOutput";
import { mapClaudeTool, normalizeResultText } from "../../src/backend/sources/claudeCode/toolMap";

const toolUse = (name: string, input: Record<string, unknown>, id = "toolu_1") => ({
  type: "tool_use",
  id,
  name,
  input,
});

describe("mapClaudeTool", () => {
  it("Bash → exec: command preview + classify-at-join, and a git diff output classifies to a diff render", () => {
    const mapped = mapClaudeTool(toolUse("Bash", { command: "git diff", description: "Show changes" }));
    expect(mapped.kind).toBe("tool_call");
    expect(mapped.toolName).toBe("Bash");
    expect(mapped.commandPreview).toBe("git diff");
    expect(mapped.classifyAtJoin).toBe(true);
    expect(mapped.callRender).toBeUndefined();

    // The parser classifies the joined result text at join time via classifyExecOutput.
    const diffOutput = [
      "diff --git a/src/x.ts b/src/x.ts",
      "index 111..222 100644",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1 +1 @@",
      "-old line",
      "+new line",
    ].join("\n");
    const render = classifyExecOutput(mapped.commandPreview, diffOutput);
    expect(render?.kind).toBe("diff");
  });

  it("Bash output redaction: a planted secret in the result text is [REDACTED]", () => {
    const normalized = normalizeResultText("API_KEY=sk-leak-me\nok");
    expect(normalized).toContain("[REDACTED]");
    expect(normalized).not.toContain("sk-leak-me");
  });

  it("Read → read CallRender", () => {
    const mapped = mapClaudeTool(toolUse("Read", { file_path: "/repo/src/x.ts" }));
    expect(mapped.callRender).toMatchObject({ kind: "read", path: "/repo/src/x.ts" });
  });

  it("Grep → search_call CallRender", () => {
    const mapped = mapClaudeTool(toolUse("Grep", { pattern: "needle", path: "src", output_mode: "content" }));
    expect(mapped.callRender).toMatchObject({ kind: "search_call", pattern: "needle", path: "src" });
  });

  it("Glob → search_call CallRender", () => {
    const mapped = mapClaudeTool(toolUse("Glob", { pattern: "**/*.ts", path: "src" }));
    expect(mapped.callRender).toMatchObject({ kind: "search_call", pattern: "**/*.ts", path: "src" });
  });

  it("Edit → diff built directly from old_string/new_string (not classifyPatch)", () => {
    const mapped = mapClaudeTool(
      toolUse("Edit", { file_path: "/repo/a.ts", old_string: "const a = 1;", new_string: "const a = 2;" }),
    );
    expect(mapped.outputRenderInput?.kind).toBe("diff");
    if (mapped.outputRenderInput?.kind === "diff") {
      const file = mapped.outputRenderInput.files[0];
      expect(file.path).toBe("/repo/a.ts");
      expect(file.removed).toBe(1);
      expect(file.added).toBe(1);
      expect(file.hunks[0].lines).toEqual([
        { t: "del", text: "const a = 1;" },
        { t: "add", text: "const a = 2;" },
      ]);
    }
  });

  it("MultiEdit → one file with N hunks", () => {
    const mapped = mapClaudeTool(
      toolUse("MultiEdit", {
        file_path: "/repo/b.ts",
        edits: [
          { old_string: "x", new_string: "y" },
          { old_string: "p", new_string: "q" },
        ],
      }),
    );
    expect(mapped.outputRenderInput?.kind).toBe("diff");
    if (mapped.outputRenderInput?.kind === "diff") {
      const file = mapped.outputRenderInput.files[0];
      expect(file.path).toBe("/repo/b.ts");
      expect(file.hunks).toHaveLength(2);
      expect(file.added).toBe(2);
      expect(file.removed).toBe(2);
    }
  });

  it("Write → all-adds diff", () => {
    const mapped = mapClaudeTool(
      toolUse("Write", { file_path: "/repo/c.ts", content: "line one\nline two\nline three" }),
    );
    expect(mapped.outputRenderInput?.kind).toBe("diff");
    if (mapped.outputRenderInput?.kind === "diff") {
      const file = mapped.outputRenderInput.files[0];
      expect(file.path).toBe("/repo/c.ts");
      expect(file.removed).toBe(0);
      expect(file.added).toBe(3);
      expect(file.hunks[0].lines.every((line) => line.t === "add")).toBe(true);
    }
  });

  it("WebSearch → fetch search CallRender", () => {
    const mapped = mapClaudeTool(toolUse("WebSearch", { query: "claude code" }));
    expect(mapped.callRender).toMatchObject({ kind: "fetch", mode: "search", query: "claude code" });
  });

  it("WebFetch → fetch CallRender", () => {
    const mapped = mapClaudeTool(toolUse("WebFetch", { url: "https://example.test", prompt: "summarize" }));
    expect(mapped.callRender).toMatchObject({ kind: "fetch", mode: "fetch", url: "https://example.test" });
  });

  it("Agent → agent_launch fields (role + redacted task)", () => {
    const mapped = mapClaudeTool(
      toolUse("Agent", { description: "Investigate", prompt: "Find the bug", subagent_type: "explorer" }),
    );
    expect(mapped.kind).toBe("agent_launch");
    expect(mapped.agentRole).toBe("explorer");
    expect(mapped.agentTaskPreview).toContain("Investigate");
  });

  it("Task → agent_launch (spec name maps the same as Agent)", () => {
    const mapped = mapClaudeTool(toolUse("Task", { description: "do it", subagent_type: "general" }));
    expect(mapped.kind).toBe("agent_launch");
    expect(mapped.agentRole).toBe("general");
  });

  it("Skill → skill_invoke with skillName", () => {
    const mapped = mapClaudeTool(toolUse("Skill", { skill: "read_pdf" }));
    expect(mapped.kind).toBe("skill_invoke");
    expect(mapped.skillName).toBe("read_pdf");
  });

  it("unknown tool (Zzz) → generic tool_call with redacted args + classify-at-join", () => {
    // The arg value is a credential assignment the redaction layer masks.
    const mapped = mapClaudeTool(toolUse("Zzz", { note: "API_KEY=sk-leak-me", other: 1 }));
    expect(mapped.kind).toBe("tool_call");
    expect(mapped.toolName).toBe("Zzz");
    expect(mapped.callRender).toBeUndefined();
    expect(mapped.classifyAtJoin).toBe(true);
    expect(mapped.argumentsPreview).toContain("[REDACTED]");
    expect(mapped.argumentsPreview).not.toContain("sk-leak-me");
  });
});

describe("normalizeResultText", () => {
  it("joins a list of text blocks and redacts, noting non-text blocks", () => {
    const text = normalizeResultText([
      { type: "text", text: "first chunk API_KEY=sk-leak" },
      { type: "image", source: {} },
      { type: "text", text: "second chunk" },
    ]);
    expect(text).toContain("first chunk");
    expect(text).toContain("second chunk");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("sk-leak");
    expect(text).toContain("1 non-text block");
  });

  it("surfaces a failure note when content is empty but toolUseResult.success is false", () => {
    const text = normalizeResultText("", { commandName: "x", success: false });
    expect(text).toBe("command failed");
  });

  it("returns the string content verbatim (redacted) for a string result", () => {
    expect(normalizeResultText("plain output")).toBe("plain output");
  });
});
