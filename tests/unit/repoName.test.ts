import { describe, expect, it } from "vitest";

import { deriveRepoName } from "../../src/shared/repoName";

describe("deriveRepoName", () => {
  it("uses the repo name from an https origin, stripping the .git suffix", () => {
    expect(deriveRepoName("https://github.com/example/agentview.git", "/worktrees/agentview-feat-x")).toBe("agentview");
  });

  it("uses the repo name from an scp-style origin, preserving case and underscores", () => {
    expect(deriveRepoName("git@github.com:acme/My_Repo.git", "/tmp/whatever")).toBe("My_Repo");
  });

  it("handles origins without a .git suffix or a trailing slash", () => {
    expect(deriveRepoName("https://github.com/example/workflowkit", "/x")).toBe("workflowkit");
    expect(deriveRepoName("https://github.com/example/workflowkit/", "/x")).toBe("workflowkit");
  });

  it("merges same-named repos from different owners (name only, not owner/repo)", () => {
    expect(deriveRepoName("https://github.com/acme/agentview.git", "/a")).toBe(
      deriveRepoName("https://github.com/example/agentview.git", "/b"),
    );
  });

  it("falls back to the cwd basename when there is no origin URL", () => {
    expect(deriveRepoName(null, "/Users/adam/Projects/agentview-feat-x")).toBe("agentview-feat-x");
    expect(deriveRepoName("", "/Users/adam/Projects/agentview-feat-x")).toBe("agentview-feat-x");
    expect(deriveRepoName(undefined, "/worktrees/agentview/")).toBe("agentview");
  });

  it("falls back to the raw cwd when there is neither an origin nor a path segment", () => {
    expect(deriveRepoName(null, "")).toBe("");
  });

  it("collapses a `.worktrees/<slug>` checkout to the parent repo's name (no origin)", () => {
    expect(deriveRepoName(null, "/Users/adam/Projects/agentview/.worktrees/impl-phase-4-graph-tokens")).toBe(
      "agentview",
    );
    expect(deriveRepoName(null, "/Users/adam/Gauntlet/replicated/.worktrees/impl-phase-2-first-rca-thin-slice")).toBe(
      "replicated",
    );
  });

  it("groups every worktree of the same repo under one name", () => {
    const a = deriveRepoName(null, "/Users/adam/Projects/agentview/.worktrees/impl-phase-2-sessions-index");
    const b = deriveRepoName(null, "/Users/adam/Projects/agentview/.worktrees/impl-phase-5-diagnostics-hardening");
    const main = deriveRepoName(null, "/Users/adam/Projects/agentview");
    expect(a).toBe("agentview");
    expect(b).toBe("agentview");
    expect(main).toBe("agentview");
  });

  it("tolerates a trailing slash on a worktree path", () => {
    expect(deriveRepoName(null, "/Users/adam/Projects/agentview/.worktrees/impl-phase-4-graph-tokens/")).toBe(
      "agentview",
    );
  });

  it("leaves a non-dotted `worktrees/<slug>` path as its own basename", () => {
    // The existing fallback semantics treat a bare `worktrees` dir as a normal path.
    expect(deriveRepoName(undefined, "/worktrees/agentview/")).toBe("agentview");
  });
});
