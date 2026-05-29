import { classifyThread } from "./markers";
import type { ReconstructThread, ReconstructedLink } from "./reconstruct";

export interface TranscriptReaderDeps {
  /** Maps a thread id to the rollout path to read (already resolved to an absolute path by the caller). */
  rolloutPathById: Map<string, string>;
  /**
   * Reads a rollout file's text; returns "" if unreadable.
   * NOTE: the implementation loads the whole rollout file into memory. A streaming
   * line-scan is a future option if rollout files grow large.
   */
  readText: (path: string) => Promise<string>;
}

const runIdMentioned = (text: string, runId: string): boolean =>
  text.includes(`docs/implementation-runs/${runId}/`);

/**
 * For orchestrators that are unlinked or only low-confidence after the pure pass,
 * find a user-root whose transcript references the orchestrator's run id and link
 * them at medium confidence. Existing high/certain/medium links are never overridden.
 */
export const upgradeViaTranscript = async (
  threads: ReconstructThread[],
  existing: Map<string, ReconstructedLink>,
  deps: TranscriptReaderDeps,
): Promise<Map<string, ReconstructedLink>> => {
  const result = new Map(existing);
  const classified = threads.map((t) => ({ t, c: classifyThread(t) }));
  const candidates = classified.filter(({ t, c }) => !t.hasRealParent && c.isOrchestrator);

  for (const { t: orch, c } of candidates) {
    const runId = c.runId;
    if (!runId) {
      continue;
    }
    const current = result.get(orch.id);
    if (current && (current.confidence === "certain" || current.confidence === "high" || current.confidence === "medium")) {
      continue;
    }

    const roots = classified
      .filter(({ t, c: rc }) => t.id !== orch.id && !t.hasRealParent && t.threadSource !== "subagent" && !rc.isOrchestrator && t.createdAtMs <= orch.createdAtMs)
      .sort((a, b) => a.t.createdAtMs - b.t.createdAtMs);

    for (const { t: root } of roots) {
      const path = deps.rolloutPathById.get(root.id);
      if (!path) {
        continue;
      }
      const text = await deps.readText(path);
      if (text && runIdMentioned(text, runId)) {
        result.set(orch.id, { childId: orch.id, parentId: root.id, confidence: "medium", via: "run-id", runId, phase: c.phase });
        break;
      }
    }
  }

  return result;
};
