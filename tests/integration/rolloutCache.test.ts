import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CachedRolloutFacts, TimelinePayload } from "../../src/shared/contracts";

interface RolloutCacheModule {
  getRolloutFactsWithCache(options: {
    codexHome: string;
    threadId: string;
    rolloutPath: string;
    parse: (sourceMtimeMs: number, sourceSizeBytes: number) => Promise<CachedRolloutFacts>;
  }): Promise<{ status: TimelinePayload["cacheStatus"]; facts: CachedRolloutFacts; warnings: string[]; cachePath: string }>;
}

interface ParseRolloutModule {
  parseRolloutFile(
    path: string,
    options: {
      threadId: string;
      rolloutPath: string;
      sourceMtimeMs: number;
      sourceSizeBytes: number;
    },
  ): Promise<CachedRolloutFacts>;
}

const rolloutCacheSpecifier = ["..", "..", "src", "backend", "cache", "rolloutCache"].join("/");
const parseRolloutSpecifier = ["..", "..", "src", "backend", "rollout", "jsonlStream"].join("/");

const tempRoots: string[] = [];

const loadRolloutCache = async () => (await import(/* @vite-ignore */ rolloutCacheSpecifier)) as RolloutCacheModule;
const loadParseRollout = async () => (await import(/* @vite-ignore */ parseRolloutSpecifier)) as ParseRolloutModule;

const createTempRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentview-rollout-cache-"));
  tempRoots.push(root);
  return root;
};

const writeRollout = async (root: string, name: string, lines: Array<Record<string, unknown>>) => {
  const rolloutPath = join(root, name);
  await writeFile(rolloutPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return rolloutPath;
};

const getCachedFacts = async ({
  codexHome,
  threadId,
  rolloutPath,
}: {
  codexHome: string;
  threadId: string;
  rolloutPath: string;
}) => {
  const { getRolloutFactsWithCache } = await loadRolloutCache();
  const { parseRolloutFile } = await loadParseRollout();
  return getRolloutFactsWithCache({
    codexHome,
    threadId,
    rolloutPath,
    parse: (sourceMtimeMs, sourceSizeBytes) =>
      parseRolloutFile(rolloutPath, {
        threadId,
        rolloutPath,
        sourceMtimeMs,
        sourceSizeBytes,
      }),
  });
};

const listFilesRecursive = async (root: string): Promise<string[]> => {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(root, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath);
      }
      return [fullPath];
    }),
  );
  return nested.flat();
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("rollout cache", () => {
  it("cold parses a rollout and writes derived cache facts under the app cache root", async () => {
    const root = await createTempRoot();
    const cacheRoot = join(root, ".observatory", "cache", "v1");
    const rolloutPath = await writeRollout(root, "cold.jsonl", [
      { timestamp: "2026-05-26T18:10:00.000Z", type: "message", role: "user", text: "Cold parse" },
      { timestamp: "2026-05-26T18:10:01.000Z", type: "message", role: "assistant", text: "Cached facts soon" },
    ]);

    const result = await getCachedFacts({ codexHome: root, threadId: "thread-cold", rolloutPath });

    expect(result.status).toBe("cold");
    expect(result.facts).toMatchObject({
      threadId: "thread-cold",
      rolloutPath,
      parserVersion: expect.any(Number),
      events: [
        expect.objectContaining({ kind: "user_message", previewText: "Cold parse" }),
        expect.objectContaining({ kind: "assistant_message", previewText: "Cached facts soon" }),
      ],
    });
    const cacheArtifacts = await listFilesRecursive(cacheRoot);
    expect(cacheArtifacts.length).toBeGreaterThan(0);
    await expect(stat(cacheArtifacts[0])).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("returns warm cache facts without reparsing an unchanged source file", async () => {
    const root = await createTempRoot();
    const rolloutPath = await writeRollout(root, "warm.jsonl", [
      { timestamp: "2026-05-26T18:11:00.000Z", type: "message", role: "user", text: "Warm me" },
    ]);

    const cold = await getCachedFacts({ codexHome: root, threadId: "thread-warm", rolloutPath });
    const warm = await getCachedFacts({ codexHome: root, threadId: "thread-warm", rolloutPath });

    expect(cold.status).toBe("cold");
    expect(warm.status).toBe("warm");
    expect(warm.facts).toEqual(cold.facts);
  });

  it("invalidates stale cache entries when rollout mtime or size changes", async () => {
    const root = await createTempRoot();
    const rolloutPath = await writeRollout(root, "stale.jsonl", [
      { timestamp: "2026-05-26T18:12:00.000Z", type: "message", role: "user", text: "Before stale" },
    ]);

    await getCachedFacts({ codexHome: root, threadId: "thread-stale", rolloutPath });
    await writeFile(
      rolloutPath,
      `${JSON.stringify({ timestamp: "2026-05-26T18:12:00.000Z", type: "message", role: "user", text: "After stale" })}\n`,
    );

    const result = await getCachedFacts({ codexHome: root, threadId: "thread-stale", rolloutPath });

    expect(result.status).toBe("stale");
    expect(result.facts.events).toEqual([
      expect.objectContaining({ kind: "user_message", previewText: "After stale" }),
    ]);
  });

  it("falls back to parsing and rewrites cache when a cache artifact is corrupt", async () => {
    const root = await createTempRoot();
    const cacheRoot = join(root, ".observatory", "cache", "v1");
    const rolloutPath = await writeRollout(root, "corrupt.jsonl", [
      { timestamp: "2026-05-26T18:13:00.000Z", type: "message", role: "assistant", text: "Recover me" },
    ]);

    await getCachedFacts({ codexHome: root, threadId: "thread-corrupt", rolloutPath });
    const [cacheArtifact] = await listFilesRecursive(cacheRoot);
    await writeFile(cacheArtifact, "{ broken cache json");

    const result = await getCachedFacts({ codexHome: root, threadId: "thread-corrupt", rolloutPath });

    expect(result.status).toBe("corrupt");
    expect(result.facts.events).toEqual([
      expect.objectContaining({ kind: "assistant_message", previewText: "Recover me" }),
    ]);
    await expect(stat(cacheArtifact)).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("persists observed rollout facts needed by timeline, graph, tokens, and diagnostics consumers", async () => {
    const root = await createTempRoot();
    const rolloutPath = await writeRollout(root, "observed-cache.jsonl", [
      {
        timestamp: "2026-05-27T14:10:00.000Z",
        type: "event_msg",
        turn_id: "turn-cache-1",
        payload: { type: "task_started", task: "Populate observed cache facts" },
      },
      {
        timestamp: "2026-05-27T14:10:01.000Z",
        type: "event_msg",
        turn_id: "turn-cache-1",
        payload: {
          type: "token_count",
          last_token_usage: { input_tokens: 13, output_tokens: 21 },
          total_token_usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 75, total_tokens: 575 },
          model_context_window: 128000,
          plan_type: "team",
        },
      },
      {
        timestamp: "2026-05-27T14:10:02.000Z",
        type: "response_item",
        turn_id: "turn-cache-1",
        payload: {
          type: "function_call",
          call_id: "call-cache-1",
          name: "shell",
          arguments: JSON.stringify({ cmd: "exit 9" }),
        },
      },
      {
        timestamp: "2026-05-27T14:10:03.250Z",
        type: "event_msg",
        turn_id: "turn-cache-1",
        payload: {
          type: "function_call_output",
          call_id: "call-cache-1",
          output: JSON.stringify({ exit_code: 9, duration_ms: 1250, output: "failed cache command" }),
        },
      },
      {
        timestamp: "2026-05-27T14:10:04.000Z",
        type: "response_item",
        turn_id: "turn-cache-1",
        payload: {
          type: "spawn_agent",
          call_id: "call-cache-spawn",
          child_thread_id: "thread-cache-child",
          agent_nickname: "cache-lane",
          agent_role: "parser",
          task: "Check cache shape.",
        },
      },
      {
        timestamp: "2026-05-27T14:10:05.000Z",
        type: "event_msg",
        turn_id: "turn-cache-1",
        payload: {
          type: "wait_agent",
          call_id: "call-cache-spawn",
          child_thread_id: "thread-cache-child",
          status: "closed",
          last_agent_message: "Cache shape covered.",
        },
      },
      {
        timestamp: "2026-05-27T14:10:06.000Z",
        type: "event_msg",
        turn_id: "turn-cache-1",
        payload: { type: "task_complete", last_agent_message: "Observed cache facts complete." },
      },
    ]);

    const result = await getCachedFacts({ codexHome: root, threadId: "thread-cache-observed", rolloutPath });
    const warm = await getCachedFacts({ codexHome: root, threadId: "thread-cache-observed", rolloutPath });

    expect(result.status).toBe("cold");
    expect(warm.status).toBe("warm");
    expect(warm.facts).toMatchObject({
      threadId: "thread-cache-observed",
      turns: [
        expect.objectContaining({
          turnId: "turn-cache-1",
          startedAt: "2026-05-27T14:10:00.000Z",
          completedAt: "2026-05-27T14:10:06.000Z",
          lastAgentMessagePreview: "Observed cache facts complete.",
          inputTokenCount: 500,
          outputTokenCount: 75,
          totalTokenCount: 575,
        }),
      ],
      tokenSnapshots: [
        expect.objectContaining({
          lastInput: 13,
          lastOutput: 21,
          modelContextWindow: 128000,
          planType: "team",
        }),
      ],
      agentLaunches: [
        expect.objectContaining({
          childThreadId: "thread-cache-child",
          nickname: "cache-lane",
          role: "parser",
          taskPreview: "Check cache shape.",
        }),
      ],
      agentWaits: [
        expect.objectContaining({
          childThreadId: "thread-cache-child",
          status: "closed",
          reportPreview: "Cache shape covered.",
        }),
      ],
      summary: expect.objectContaining({
        eventCount: 7,
        turnCount: 1,
        toolCallCount: 1,
        failedToolCallCount: 1,
        tokenSnapshotCount: 1,
        agentLaunchCount: 1,
        agentWaitCount: 1,
        warningCount: 0,
      }),
    });
    expect(warm.facts.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool_call",
          callId: "call-cache-1",
          joinedExitCode: 9,
          joinedDurationMs: 1250,
          joinedOutputPreview: expect.stringContaining("failed cache command"),
        }),
      ]),
    );
  });
});
