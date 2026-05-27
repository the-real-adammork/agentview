import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getRolloutFactsWithCache } from "../../src/backend/cache/rolloutCache";
import { parseRolloutFile } from "../../src/backend/rollout/jsonlStream";

const tempRoots: string[] = [];

const createRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentview-rollout-perf-test-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("rollout parse performance guard", () => {
  it("keeps derived warm cache faster than cold parsing for a large local fixture", async () => {
    const root = await createRoot();
    const rolloutPath = join(root, "large.jsonl");
    const lines = Array.from({ length: 1200 }, (_, index) =>
      JSON.stringify({
        timestamp: new Date(1_700_000_000_000 + index).toISOString(),
        type: index % 25 === 0 ? "token_count" : "message",
        role: "assistant",
        text: `large rollout event ${index}`,
        total_token_usage: { input_tokens: index, output_tokens: 2, cached_input_tokens: 1 },
      }),
    );
    await writeFile(rolloutPath, `${lines.join("\n")}\n`, "utf8");

    const parse = (sourceMtimeMs: number, sourceSizeBytes: number) =>
      parseRolloutFile(rolloutPath, {
        threadId: "thread-perf",
        rolloutPath,
        sourceMtimeMs,
        sourceSizeBytes,
      });

    const coldStartedAt = performance.now();
    const cold = await getRolloutFactsWithCache({ codexHome: root, threadId: "thread-perf", rolloutPath, parse });
    const coldMs = performance.now() - coldStartedAt;

    const warmStartedAt = performance.now();
    const warm = await getRolloutFactsWithCache({ codexHome: root, threadId: "thread-perf", rolloutPath, parse });
    const warmMs = performance.now() - warmStartedAt;

    expect(cold.status).toBe("cold");
    expect(warm.status).toBe("warm");
    expect(warm.facts.events).toHaveLength(lines.length);
    expect(warmMs).toBeLessThanOrEqual(coldMs);
  });
});
