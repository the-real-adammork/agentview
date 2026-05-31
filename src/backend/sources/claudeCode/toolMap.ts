import type { CallRender, DiffFile, DiffHunk, OutputRender, TimelineEventKind } from "../../../shared/contracts";
import { classifyCall } from "../../rollout/classifyCall";
import { maskPreviewSecrets } from "../../../shared/redaction";

/**
 * Adapts a Claude Code (CC) `tool_use` block (+ its joined `tool_result`) into the
 * normalized render inputs the existing classifiers/renderers consume — mirroring
 * the Codex parser's per-tool handling without changing any renderer or contract.
 * The output type is the same `CallRender` / `OutputRender` / first-class-event
 * fields a Codex tool call produces; only the *adapter* is CC-specific.
 *
 * §B of the Phase-4 plan: `Bash` → exec (classified at join via `classifyExecOutput`),
 * `Read`/`Grep`/`Glob` → call renders, `Edit`/`Write`/`MultiEdit` → diff renders built
 * directly from the CC block (CC blocks lack Codex's `*** Begin Patch` envelope that
 * `classifyPatch` requires), `WebFetch`/`WebSearch` → fetch renders, `Agent`/`Task` →
 * `agent_launch`, `Skill` → `skill_invoke`, anything else → a generic tool_call.
 */

/** Bound on the (redacted) result text kept for classification — mirrors the Codex parser cap. */
export const CLASSIFY_OUTPUT_CAP = 128 * 1024;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (...values: unknown[]): string | undefined => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value;
  return undefined;
};

const compactJson = (value: unknown, maxLength = 800): string => {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}...` : oneLine;
};

const redactedPreview = (value: unknown, maxLength = 800): string =>
  maskPreviewSecrets(compactJson(value, maxLength));

/**
 * Normalize a `tool_result.content` (string | block-list) into a single redacted,
 * capped string. Text blocks are joined; `image`/`tool_reference` blocks are
 * skipped (their presence is noted as a terse marker). When `content` is empty
 * but the supplementary `toolUseResult.success === false`, surface a failure note.
 */
export const normalizeResultText = (
  content: unknown,
  toolUseResult?: unknown,
): string | undefined => {
  let text: string | undefined;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    let skipped = 0;
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      } else if (block.type === "image" || block.type === "tool_reference") {
        skipped += 1;
      }
    }
    if (skipped > 0) parts.push(`[${skipped} non-text block${skipped === 1 ? "" : "s"}]`);
    text = parts.length ? parts.join("\n") : undefined;
  }

  if ((text === undefined || text.trim() === "") && isRecord(toolUseResult) && toolUseResult.success === false) {
    text = "command failed";
  }

  if (text === undefined) return undefined;
  return maskPreviewSecrets(text).slice(0, CLASSIFY_OUTPUT_CAP);
};

/** Sub-agent launch tools — the real fleet uses `Agent`; the spec also names `Task`. */
const AGENT_TOOL_NAMES = new Set(["Agent", "Task"]);

/** A unified-diff render built directly from CC `Edit`/`Write`/`MultiEdit` blocks. */
const buildDiffFile = (path: string, oldString: string, newString: string): DiffFile => {
  const delLines = oldString === "" ? [] : oldString.split("\n");
  const addLines = newString === "" ? [] : newString.split("\n");
  const hunk: DiffHunk = {
    header: "@@",
    lines: [
      ...delLines.map((text) => ({ t: "del" as const, text })),
      ...addLines.map((text) => ({ t: "add" as const, text })),
    ],
  };
  return { path, added: addLines.length, removed: delLines.length, hunks: [hunk] };
};

const buildEditDiff = (input: JsonRecord): OutputRender | undefined => {
  const filePath = str(input.file_path) ?? "";
  // MultiEdit → one file, N hunks from edits[].
  if (Array.isArray(input.edits)) {
    const file: DiffFile = { path: filePath, added: 0, removed: 0, hunks: [] };
    for (const edit of input.edits) {
      if (!isRecord(edit)) continue;
      const oldString = typeof edit.old_string === "string" ? edit.old_string : "";
      const newString = typeof edit.new_string === "string" ? edit.new_string : "";
      const built = buildDiffFile(filePath, oldString, newString);
      file.added += built.added;
      file.removed += built.removed;
      file.hunks.push(...built.hunks);
    }
    if (file.hunks.length === 0) return undefined;
    return { kind: "diff", files: [file] };
  }
  const oldString = typeof input.old_string === "string" ? input.old_string : "";
  const newString = typeof input.new_string === "string" ? input.new_string : "";
  return { kind: "diff", files: [buildDiffFile(filePath, oldString, newString)] };
};

const buildWriteDiff = (input: JsonRecord): OutputRender => {
  const filePath = str(input.file_path) ?? "";
  const content = typeof input.content === "string" ? input.content : "";
  const addLines = content === "" ? [] : content.split("\n");
  const hunk: DiffHunk = { header: "@@", lines: addLines.map((text) => ({ t: "add" as const, text })) };
  return { kind: "diff", files: [{ path: filePath, added: addLines.length, removed: 0, hunks: [hunk] }] };
};

/**
 * The normalized render inputs the parser applies to the `tool_call` (or first-class)
 * event. The parser owns the call↔result join; `outputRenderInput` is a render the
 * `toolMap` could fully build from the call alone (Edit/Write/MultiEdit diffs).
 * `classifyAtJoin` marks tools whose `outputRender` must be classified from the
 * joined result text (Bash → exec, generic → self-identifying output).
 */
export interface MappedClaudeTool {
  /** The event kind for this block: tool_call (default), agent_launch, or skill_invoke. */
  kind: Extract<TimelineEventKind, "tool_call" | "agent_launch" | "skill_invoke">;
  toolName: string;
  /** Redacted command line for exec-style tools (Bash). */
  commandPreview?: string;
  /** Redacted compact arguments preview. */
  argumentsPreview?: string;
  /** Call-side one-liner (read/search/fetch) from `classifyCall`. */
  callRender?: CallRender;
  /** A render fully constructed from the call (Edit/Write/MultiEdit → diff). */
  outputRenderInput?: OutputRender;
  /** When set, the parser classifies `outputRender` from the joined result text via classifyExecOutput. */
  classifyAtJoin?: boolean;
  /** agent_launch: the sub-agent role + redacted task preview. */
  agentRole?: string;
  agentTaskPreview?: string;
  /** skill_invoke: the invoked skill name. */
  skillName?: string;
}

/**
 * Map a CC `tool_use` block into the normalized render inputs. `result` (the joined
 * `tool_result` content) is accepted for symmetry with the Codex join, but the
 * heavy result-side classification (Bash → exec) is deferred to the parser's join
 * pass so it sees the same bounded `fullOutput` the Codex parser does.
 */
export const mapClaudeTool = (block: JsonRecord): MappedClaudeTool => {
  const name = str(block.name) ?? "tool";
  const input = isRecord(block.input) ? block.input : {};

  if (AGENT_TOOL_NAMES.has(name)) {
    return {
      kind: "agent_launch",
      toolName: name,
      agentRole: str(input.subagent_type, input.agent_type, input.role),
      agentTaskPreview: redactedPreview(str(input.description, input.prompt, input.task)),
    };
  }

  if (name === "Skill") {
    return {
      kind: "skill_invoke",
      toolName: name,
      skillName: str(input.skill, input.name, input.command),
      argumentsPreview: redactedPreview(input),
    };
  }

  switch (name) {
    case "Bash": {
      return {
        kind: "tool_call",
        toolName: name,
        commandPreview: redactedPreview(str(input.command)),
        argumentsPreview: redactedPreview(input),
        classifyAtJoin: true,
      };
    }
    case "Read": {
      const filePath = str(input.file_path, input.path);
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        callRender: classifyCall("read", { path: filePath }, undefined),
      };
    }
    case "Grep": {
      const pattern = str(input.pattern);
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        callRender: classifyCall("grep", { pattern, path: str(input.path) }, pattern),
      };
    }
    case "Glob": {
      const pattern = str(input.pattern);
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        callRender: classifyCall("search_files", { pattern, path: str(input.path) }, pattern),
      };
    }
    case "Edit":
    case "MultiEdit": {
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        outputRenderInput: buildEditDiff(input),
      };
    }
    case "Write": {
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        outputRenderInput: buildWriteDiff(input),
      };
    }
    case "WebFetch": {
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        callRender: classifyCall("web_fetch", { url: str(input.url) }, undefined),
      };
    }
    case "WebSearch": {
      const query = str(input.query);
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        callRender: classifyCall("web_search", {}, query),
      };
    }
    case "ToolSearch": {
      const query = str(input.query);
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        callRender: classifyCall("tool_search", { limit: input.limit }, query),
      };
    }
    default: {
      // Generic tool: keep the redacted args; still attempt to classify a
      // self-identifying output (e.g. JSON) from the joined result at join time.
      return {
        kind: "tool_call",
        toolName: name,
        argumentsPreview: redactedPreview(input),
        classifyAtJoin: true,
      };
    }
  }
};
