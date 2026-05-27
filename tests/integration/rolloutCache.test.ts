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
});
