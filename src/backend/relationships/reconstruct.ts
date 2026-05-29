import type { EdgeConfidence, EdgeVia, ThreadSource } from "../../shared/contracts";

import { classifyThread, type ThreadClassification } from "./markers";

export interface ReconstructThread {
  id: string;
  firstUserMessage: string | null;
  preview: string | null;
  cwd: string;
  createdAtMs: number;
  updatedAtMs: number;
  threadSource: ThreadSource | null;
  /** True when codex already records a parent (thread_spawn_edges) for this thread. */
  hasRealParent: boolean;
}

export interface ReconstructedLink {
  childId: string;
  parentId: string;
  confidence: EdgeConfidence;
  via: EdgeVia;
  runId: string | null;
  phase: string | null;
}

interface Classified extends ReconstructThread {
  c: ThreadClassification;
}

const isUserRoot = (t: Classified): boolean => !t.hasRealParent && t.threadSource !== "subagent";

/** earliest createdAtMs, then largest updatedAtMs */
const preferOriginator = (a: Classified, b: Classified): number =>
  a.createdAtMs - b.createdAtMs || b.updatedAtMs - a.updatedAtMs;

export const reconstructEdges = (threads: ReconstructThread[]): Map<string, ReconstructedLink> => {
  const classified: Classified[] = threads.map((t) => ({ ...t, c: classifyThread(t) }));
  const byId = new Map<string, Classified>(classified.map((t) => [t.id, t]));
  const supervisors = classified.filter((t) => t.c.isSupervisor);
  const links = new Map<string, ReconstructedLink>();

  const orchestrators = classified.filter((t) => t.c.isOrchestrator && !t.hasRealParent);

  for (const orch of orchestrators) {
    const runId = orch.c.runId;
    const phase = orch.c.phase;

    // Tier 0 — explicit marker.
    if (orch.c.markerParentId && byId.has(orch.c.markerParentId) && orch.c.markerParentId !== orch.id) {
      links.set(orch.id, { childId: orch.id, parentId: orch.c.markerParentId, confidence: "certain", via: "marker", runId, phase });
      continue;
    }

    // Tiers 1–2 — a classified supervisor in the same cwd, created no later than the orchestrator.
    const supCandidates = supervisors
      .filter((s) => s.id !== orch.id && s.cwd === orch.cwd && s.createdAtMs <= orch.createdAtMs)
      .sort(preferOriginator);

    if (supCandidates.length > 0) {
      const runMatches = runId ? supCandidates.filter((s) => s.c.runId === runId) : [];
      const pool = runMatches.length > 0 ? runMatches : supCandidates;
      const windowMatches = pool.filter((s) => s.createdAtMs <= orch.createdAtMs && orch.createdAtMs <= s.updatedAtMs);

      if (windowMatches.length > 0) {
        const parent = windowMatches[0];
        const via: EdgeVia = runMatches.length > 0 ? "run-id" : "cwd-time";
        links.set(orch.id, { childId: orch.id, parentId: parent.id, confidence: "high", via, runId, phase });
        continue;
      }

      const parent = pool[0];
      links.set(orch.id, { childId: orch.id, parentId: parent.id, confidence: "medium", via: "cwd-time", runId, phase });
      continue;
    }

    // Tier 4 — nearest preceding non-orchestrator user root in the same cwd.
    const fallback = classified
      .filter(
        (t) =>
          t.id !== orch.id &&
          t.cwd === orch.cwd &&
          isUserRoot(t) &&
          !t.c.isOrchestrator &&
          t.createdAtMs <= orch.createdAtMs,
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs);

    if (fallback.length > 0) {
      links.set(orch.id, { childId: orch.id, parentId: fallback[0].id, confidence: "low", via: "cwd-time", runId, phase });
    }
  }

  return links;
};
