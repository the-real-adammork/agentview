import { describe, expect, it } from "vitest";

import { createClaudeCodeSource } from "../../src/backend/sources/claudeCode/ClaudeCodeSource";
import { createCodexSource, isCodexSource } from "../../src/backend/sources/codex/CodexSource";

// Construction is pure (closures only — no filesystem/DB I/O until a method runs),
// so dummy paths are enough to assert which capabilities each source advertises.
const codex = createCodexSource({ codexHome: "/tmp/does-not-exist" });
const claude = createClaudeCodeSource({ projectsDir: "/tmp/does-not-exist" });

const hasFn = (value: unknown, name: string): boolean =>
  typeof (value as Record<string, unknown>)[name] === "function";

const TIMELINE_METHODS = ["parseCached", "tailParsed", "resolveChild"] as const;

describe("source capabilities — the handler seam invariant", () => {
  // The timeline handler dispatches every source through the TimelineSource
  // capability (parseCached/tailParsed/resolveChild) instead of an `if (source)`
  // branch. If a source ever drops one of these, the handler would have to special-
  // case it again — this test fails first.
  it("every dispatchable source implements the full TimelineSource capability", () => {
    for (const source of [codex, claude]) {
      for (const method of TIMELINE_METHODS) {
        expect(hasFn(source, method), `${source.id}.${method}`).toBe(true);
      }
    }
  });

  // The live token feed is Codex-only via capability, not a `source === "codex"`
  // check: Codex advertises LiveTokenSource, Claude Code deliberately does not, so
  // liveSources pushes a tokens frame for Codex and silently none for CC.
  it("only Codex advertises the LiveTokenSource capability", () => {
    expect(hasFn(codex, "liveTokenSeries")).toBe(true);
    expect(hasFn(claude, "liveTokenSeries")).toBe(false);
  });

  // Both stream live (LiveTailSource); the health endpoint narrows to the concrete
  // Codex source via isCodexSource rather than an `as CodexSource` cast.
  it("both sources implement LiveTailSource; isCodexSource narrows only Codex", () => {
    expect(hasFn(codex, "tailLive")).toBe(true);
    expect(hasFn(claude, "tailLive")).toBe(true);
    expect(isCodexSource(codex)).toBe(true);
    expect(isCodexSource(claude)).toBe(false);
  });
});
