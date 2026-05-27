import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface CodexPathsModule {
  resolveCodexHome(options: {
    env: Record<string, string | undefined>;
    homeDir: string;
  }): Promise<string>;
  resolveCodexSourcePath(codexHome: string, sourcePath: string): Promise<string>;
}

const codexPathsSpecifier = ["..", "..", "src", "backend", "codexPaths"].join("/");

const loadCodexPaths = async () =>
  (await import(/* @vite-ignore */ codexPathsSpecifier)) as CodexPathsModule;

describe("Codex source path guard", () => {
  it("resolves CODEX_HOME from an injected environment to a normalized absolute path", async () => {
    const { resolveCodexHome } = await loadCodexPaths();
    const root = await mkdtemp(join(tmpdir(), "agentview-codex-paths-home-"));

    try {
      await expect(
        resolveCodexHome({
          env: { CODEX_HOME: join(root, ".") },
          homeDir: "/should/not/be/used",
        }),
      ).resolves.toBe(await realpath(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("defaults CODEX_HOME to .codex under the injected home directory", async () => {
    const { resolveCodexHome } = await loadCodexPaths();
    const homeDir = await mkdtemp(join(tmpdir(), "agentview-codex-paths-default-home-"));
    const codexHome = join(homeDir, ".codex");
    await mkdir(codexHome, { recursive: true });

    try {
      await expect(resolveCodexHome({ env: {}, homeDir })).resolves.toBe(await realpath(codexHome));
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("rejects traversal outside the resolved Codex home", async () => {
    const { resolveCodexSourcePath } = await loadCodexPaths();
    const homeDir = await mkdtemp(join(tmpdir(), "agentview-codex-paths-traversal-home-"));
    const codexHome = join(homeDir, ".codex");
    await mkdir(join(codexHome, "sessions"), { recursive: true });

    try {
      await expect(resolveCodexSourcePath(codexHome, "sessions/2026/thread.jsonl")).resolves.toBe(
        join(await realpath(codexHome), "sessions/2026/thread.jsonl"),
      );

      await expect(resolveCodexSourcePath(codexHome, "../state_5.sqlite")).rejects.toMatchObject({
        code: "CODEX_PATH_TRAVERSAL",
      });

      await expect(resolveCodexSourcePath(codexHome, "/tmp/outside.jsonl")).rejects.toMatchObject({
        code: "CODEX_PATH_TRAVERSAL",
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
