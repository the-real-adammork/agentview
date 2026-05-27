import { stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  createCodexHomeFixture,
  createUnsupportedCodexHomeFixture,
} from "../fixtures/codexHome";

interface StateStore {
  getHealth(): Promise<unknown>;
  listSessions(filter: unknown, page: unknown): Promise<unknown>;
  close(): Promise<void>;
}

interface StateStoreModule {
  openStateStore(options: { codexHome: string }): Promise<StateStore>;
}

const stateStoreSpecifier = ["..", "..", "src", "backend", "sqlite", "stateStore"].join("/");

const loadStateStore = async () =>
  (await import(/* @vite-ignore */ stateStoreSpecifier)) as StateStoreModule;

describe("read-only Codex state store", () => {
  it("opens state_5.sqlite read-only and reports supported schema health", async () => {
    const { openStateStore } = await loadStateStore();
    const fixture = await createCodexHomeFixture();

    try {
      const before = await stat(fixture.stateDbPath);
      const store = await openStateStore({ codexHome: fixture.codexHome });

      try {
        await expect(store.getHealth()).resolves.toMatchObject({
          ok: true,
          source: "state-db",
          schema: {
            readOnly: true,
            supported: true,
            tables: expect.arrayContaining(["threads", "thread_spawn_edges"]),
          },
        });
      } finally {
        await store.close();
      }

      const after = await stat(fixture.stateDbPath);
      expect(after.mtimeMs).toBe(before.mtimeMs);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects unsupported state_5.sqlite schemas before serving rows", async () => {
    const { openStateStore } = await loadStateStore();
    const fixture = await createUnsupportedCodexHomeFixture();

    try {
      await expect(openStateStore({ codexHome: fixture.codexHome })).rejects.toMatchObject({
        code: "SCHEMA_UNSUPPORTED",
        missing: expect.arrayContaining([
          "threads.rollout_path",
          "threads.updated_at_ms",
          "thread_spawn_edges",
        ]),
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("normalizes SessionSummary rows from temp SQLite fixtures sorted by updated_at_ms desc", async () => {
    const { openStateStore } = await loadStateStore();
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-parent",
          rolloutPath: "sessions/2026/parent.jsonl",
          createdAtMs: 1_800_000,
          updatedAtMs: 2_000_000,
          cwd: "/worktrees/agentview",
          title: "Parent title",
          firstUserMessage: "First parent prompt",
          preview: "Parent preview",
          model: "gpt-5-codex",
          reasoningEffort: "high",
          tokensUsed: 42_000,
          gitSha: "abc123",
          gitBranch: "impl/phase-2",
          gitOriginUrl: "https://github.com/example/agentview.git",
          threadSource: "user",
        },
        {
          id: "thread-child-open",
          createdAtMs: 1_850_000,
          updatedAtMs: 2_100_000,
          cwd: "/worktrees/agentview",
          title: "",
          firstUserMessage: "Investigate backend state store",
          preview: "Child preview fallback",
          model: "gpt-5-codex",
          tokensUsed: 12_500,
          threadSource: "subagent",
          agentNickname: "backend-state",
          agentRole: "implementation",
        },
        {
          id: "thread-archived",
          createdAtMs: 1_700_000,
          updatedAtMs: 2_200_000,
          cwd: "/worktrees/agentview",
          title: "Archived row",
          archived: true,
          model: "gpt-5-codex-mini",
          tokensUsed: 100,
        },
      ],
      edges: [
        {
          parentThreadId: "thread-parent",
          childThreadId: "thread-child-open",
          status: "open",
        },
        {
          parentThreadId: "thread-parent",
          childThreadId: "thread-child-closed",
          status: "closed",
        },
      ],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });

      try {
        await expect(store.listSessions({ archived: "exclude" }, { limit: 25 })).resolves.toEqual([
          expect.objectContaining({
            id: "thread-child-open",
            rolloutPath: "sessions/thread-child-open.jsonl",
            createdAtMs: 1_850_000,
            updatedAtMs: 2_100_000,
            cwd: "/worktrees/agentview",
            repoLabel: "agentview",
            titlePreview: "Investigate backend state store",
            firstUserMessagePreview: "Investigate backend state store",
            preview: "Child preview fallback",
            model: "gpt-5-codex",
            reasoningEffort: null,
            tokensUsed: 12_500,
            threadSource: "subagent",
            agentNickname: "backend-state",
            agentRole: "implementation",
            gitSha: null,
            gitBranch: null,
            gitOriginUrlPreview: null,
            archived: false,
            childCount: 0,
            openChildCount: 0,
            warningCountStatus: "not_requested",
            warningCount: null,
            failedToolCountStatus: "unknown",
            failedToolCount: null,
          }),
          expect.objectContaining({
            id: "thread-parent",
            rolloutPath: "sessions/2026/parent.jsonl",
            createdAtMs: 1_800_000,
            updatedAtMs: 2_000_000,
            repoLabel: "agentview",
            titlePreview: "Parent title",
            firstUserMessagePreview: "First parent prompt",
            childCount: 2,
            openChildCount: 1,
            gitBranch: "impl/phase-2",
            gitOriginUrlPreview: "github.com/example/agentview.git",
          }),
        ]);
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("filters sessions by repository basename while preserving full cwd compatibility", async () => {
    const { openStateStore } = await loadStateStore();
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-agentview-main",
          createdAtMs: 2_500,
          cwd: "/worktrees/agentview",
          title: "AgentView main",
          updatedAtMs: 3_000,
        },
        {
          id: "thread-agentview-sibling",
          createdAtMs: 1_500,
          cwd: "/tmp/sibling/agentview",
          title: "AgentView sibling",
          updatedAtMs: 2_000,
        },
        {
          id: "thread-other",
          createdAtMs: 500,
          cwd: "/worktrees/agentview-fixture",
          title: "Other repo",
          updatedAtMs: 1_000,
        },
      ],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });

      try {
        await expect(store.listSessions({ cwd: "agentview", archived: "include" }, { limit: 25 })).resolves.toEqual([
          expect.objectContaining({ id: "thread-agentview-main", repoLabel: "agentview" }),
          expect.objectContaining({ id: "thread-agentview-sibling", repoLabel: "agentview" }),
        ]);
        await expect(store.listSessions({ cwd: "/worktrees/agentview", archived: "include" }, { limit: 25 })).resolves.toEqual([
          expect.objectContaining({ id: "thread-agentview-main", repoLabel: "agentview" }),
        ]);
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
