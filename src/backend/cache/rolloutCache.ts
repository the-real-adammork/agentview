import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { CachedRolloutFacts } from "../../shared/contracts";
import { ROLLOUT_PARSER_VERSION } from "../rollout/parseRollout";

export type RolloutCacheStatus = "cold" | "warm" | "stale" | "corrupt";

export interface RolloutCacheResult {
  facts: CachedRolloutFacts;
  status: RolloutCacheStatus;
  warnings: string[];
  cachePath: string;
}

const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 180);

export const rolloutCachePath = (codexHome: string, threadId: string) =>
  join(codexHome, ".observatory", "cache", "v1", "rollouts", `${safeSegment(threadId)}.json`);

const isFresh = (facts: CachedRolloutFacts, rolloutPath: string, sourceMtimeMs: number, sourceSizeBytes: number) =>
  facts.parserVersion === ROLLOUT_PARSER_VERSION &&
  facts.rolloutPath === rolloutPath &&
  facts.sourceMtimeMs === sourceMtimeMs &&
  facts.sourceSizeBytes === sourceSizeBytes;

const readCachedFacts = async (
  cachePath: string,
  rolloutPath: string,
  sourceMtimeMs: number,
  sourceSizeBytes: number,
) => {
  const body = await readFile(cachePath, "utf8");
  const parsed = JSON.parse(body) as CachedRolloutFacts;
  return {
    facts: parsed,
    fresh: isFresh(parsed, rolloutPath, sourceMtimeMs, sourceSizeBytes),
  };
};

const writeCachedFacts = async (cachePath: string, facts: CachedRolloutFacts) => {
  await mkdir(dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(facts)}\n`, "utf8");
  await rename(tempPath, cachePath);
};

export const getRolloutFactsWithCache = async ({
  codexHome,
  threadId,
  rolloutPath,
  parse,
}: {
  codexHome: string;
  threadId: string;
  rolloutPath: string;
  parse: (sourceMtimeMs: number, sourceSizeBytes: number) => Promise<CachedRolloutFacts>;
}): Promise<RolloutCacheResult> => {
  const cacheRoot = process.env.AGENTVIEW_CACHE_ROOT ?? codexHome;
  const cachePath = rolloutCachePath(cacheRoot, threadId);
  const sourceStat = await stat(rolloutPath);
  const sourceMtimeMs = sourceStat.mtimeMs;
  const sourceSizeBytes = sourceStat.size;
  const warnings: string[] = [];

  try {
    const cached = await readCachedFacts(cachePath, rolloutPath, sourceMtimeMs, sourceSizeBytes);
    if (cached.fresh) {
      return { facts: cached.facts, status: "warm", warnings, cachePath };
    }
    const facts = await parse(sourceMtimeMs, sourceSizeBytes);
    await writeCachedFacts(cachePath, facts);
    return { facts, status: "stale", warnings, cachePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      warnings.push(`Ignoring corrupt rollout cache: ${error instanceof Error ? error.message : String(error)}`);
      const facts = await parse(sourceMtimeMs, sourceSizeBytes);
      await writeCachedFacts(cachePath, facts);
      return { facts, status: "corrupt", warnings, cachePath };
    }
  }

  const facts = await parse(sourceMtimeMs, sourceSizeBytes);
  await writeCachedFacts(cachePath, facts);
  return { facts, status: "cold", warnings, cachePath };
};
