import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const root = mkdtempSync(join(tmpdir(), "agentview-rollout-perf-"));
const codexHome = join(root, "codex-home");
const rolloutPath = join(root, "large.jsonl");
const lineCount = Number.parseInt(process.env.AGENTVIEW_ROLLOUT_PERF_LINES ?? "2500", 10);

const lines = Array.from({ length: lineCount }, (_, index) =>
  JSON.stringify({
    type: index % 10 === 0 ? "token_snapshot" : "assistant_message",
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
    content: `rollout event ${index}`,
    usage: { input_tokens: index, output_tokens: 2, cached_input_tokens: 1 },
  }),
);

writeFileSync(rolloutPath, `${lines.join("\n")}\n`, "utf8");

try {
  const [{ getRolloutFactsWithCache }, { parseRolloutFile }] = await Promise.all([
    import("../../src/backend/cache/rolloutCache.ts"),
    import("../../src/backend/rollout/jsonlStream.ts"),
  ]);

  const parse = (sourceMtimeMs, sourceSizeBytes) =>
    parseRolloutFile(rolloutPath, {
      threadId: "perf-thread",
      rolloutPath,
      sourceMtimeMs,
      sourceSizeBytes,
    });

  const coldStartedAt = performance.now();
  const cold = await getRolloutFactsWithCache({ codexHome, threadId: "perf-thread", rolloutPath, parse });
  const coldMs = Math.round(performance.now() - coldStartedAt);

  const warmStartedAt = performance.now();
  const warm = await getRolloutFactsWithCache({ codexHome, threadId: "perf-thread", rolloutPath, parse });
  const warmMs = Math.round(performance.now() - warmStartedAt);

  const result = {
    result: warmMs <= coldMs ? "pass" : "fail",
    lineCount,
    coldMs,
    warmMs,
    coldStatus: cold.status,
    warmStatus: warm.status,
    events: warm.facts.events.length,
  };

  console.log(JSON.stringify(result, null, 2));

  if (result.result !== "pass" || cold.status !== "cold" || warm.status !== "warm") {
    throw new Error("Rollout cache perf guard failed.");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
