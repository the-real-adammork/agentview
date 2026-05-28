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
});
