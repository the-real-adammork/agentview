import { describe, expect, it } from "vitest";

import { reconstructEdges, type ReconstructThread } from "../../src/backend/relationships/reconstruct";
import { upgradeViaTranscript } from "../../src/backend/relationships/transcriptRunId";

const CWD = "/repo/agentview";
const orchPrompt = (phase: string, run = "run-a") =>
  `Use the implementation-execution skill as the phase orchestrator for ${phase}. ` +
  `Run state: docs/implementation-runs/${run}/run.yaml.`;

const base: Omit<ReconstructThread, "id" | "firstUserMessage" | "createdAtMs" | "updatedAtMs"> = {
  preview: null,
  cwd: CWD,
  threadSource: "user",
  hasRealParent: false,
};

describe("reconstructEdges", () => {
  it("uses the marker when present (tier 0, certain)", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      {
        ...base,
        id: "orch",
        firstUserMessage: `[av-parent:sup] ${orchPrompt("phase-1")}`,
        createdAtMs: 2000,
        updatedAtMs: 3000,
      },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup", confidence: "certain", via: "marker" });
  });

  it("links to a classified supervisor in the same cwd whose window contains the spawn (tier 1, high)", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup", confidence: "high" });
  });

  it("prefers a supervisor whose run id matches and reports via run-id", () => {
    const threads: ReconstructThread[] = [
      {
        ...base,
        id: "sup-a",
        firstUserMessage: "$implementation-execution docs/implementation-runs/run-a/run.yaml",
        createdAtMs: 1000,
        updatedAtMs: 9000,
      },
      {
        ...base,
        id: "sup-b",
        firstUserMessage: "$implementation-execution docs/implementation-runs/run-b/run.yaml",
        createdAtMs: 1100,
        updatedAtMs: 9000,
      },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1", "run-a"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup-a", confidence: "high", via: "run-id" });
  });

  it("falls to medium when the supervisor window does not contain the spawn (tier 2)", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 1500 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup", confidence: "medium", via: "cwd-time" });
  });

  it("falls to a preceding non-orchestrator root in the same cwd (tier 4, low)", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "root", firstUserMessage: "ordinary work", createdAtMs: 1000, updatedAtMs: 1200 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "root", confidence: "low", via: "cwd-time" });
  });

  it("emits no edge when there is no candidate", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    expect(reconstructEdges(threads).size).toBe(0);
  });

  it("never links an orchestrator that already has a real parent", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      {
        ...base,
        id: "orch",
        firstUserMessage: orchPrompt("phase-1"),
        createdAtMs: 2000,
        updatedAtMs: 3000,
        hasRealParent: true,
      },
    ];
    expect(reconstructEdges(threads).has("orch")).toBe(false);
  });

  it("reports via run-id at medium confidence when a run-id match is out of the time window", () => {
    const threads: ReconstructThread[] = [
      {
        ...base,
        id: "sup",
        firstUserMessage: "$implementation-execution docs/implementation-runs/run-a/run.yaml",
        createdAtMs: 1000,
        updatedAtMs: 1500, // window ends before the orchestrator spawns at 2000
      },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1", "run-a"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup", confidence: "medium", via: "run-id" });
  });

  it("ignores a dangling marker and falls through to the supervisor", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      { ...base, id: "orch", firstUserMessage: `[av-parent:does-not-exist] ${orchPrompt("phase-1")}`, createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    expect(reconstructEdges(threads).get("orch")).toMatchObject({ parentId: "sup", via: "cwd-time" });
  });

  it("links every phase orchestrator of one run to the same supervisor", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      { ...base, id: "p1", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 2500 },
      { ...base, id: "p2", firstUserMessage: orchPrompt("phase-2"), createdAtMs: 3000, updatedAtMs: 3500 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("p1")?.parentId).toBe("sup");
    expect(edges.get("p2")?.parentId).toBe("sup");
  });
});

describe("upgradeViaTranscript", () => {
  it("links an unlinked orchestrator to the root whose transcript references its run id", async () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "root", firstUserMessage: "set up the run", createdAtMs: 1000, updatedAtMs: 9000 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1", "run-z"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const existing = new Map(); // pure linker found nothing (root not a classified supervisor)
    const rolloutById = new Map<string, string>([["root", "sessions/root.jsonl"]]);
    const readText = async (path: string) =>
      path === "sessions/root.jsonl" ? "blah docs/implementation-runs/run-z/run.yaml blah" : "";

    const upgraded = await upgradeViaTranscript(threads, existing, {
      rolloutPathById: rolloutById,
      readText,
    });
    expect(upgraded.get("orch")).toMatchObject({ parentId: "root", confidence: "medium", via: "run-id" });
  });

  it("does not override an existing high/certain link", async () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1", "run-z"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const existing = new Map([
      ["orch", { childId: "orch", parentId: "sup", confidence: "high" as const, via: "run-id" as const, runId: "run-z", phase: "phase-1" }],
    ]);
    const upgraded = await upgradeViaTranscript(threads, existing, { rolloutPathById: new Map(), readText: async () => "" });
    expect(upgraded.get("orch")?.parentId).toBe("sup");
  });

  it("upgrades a low-confidence link (parent may change) on a transcript run-id hit", async () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "real-owner", firstUserMessage: "set up the run", createdAtMs: 500, updatedAtMs: 9000 },
      { ...base, id: "weak-root", firstUserMessage: "unrelated", createdAtMs: 1000, updatedAtMs: 1200 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1", "run-z"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const existing = new Map([
      ["orch", { childId: "orch", parentId: "weak-root", confidence: "low" as const, via: "cwd-time" as const, runId: "run-z", phase: "phase-1" }],
    ]);
    const upgraded = await upgradeViaTranscript(threads, existing, {
      rolloutPathById: new Map([["real-owner", "sessions/real-owner.jsonl"]]),
      readText: async (p) => (p === "sessions/real-owner.jsonl" ? "docs/implementation-runs/run-z/run.yaml" : ""),
    });
    expect(upgraded.get("orch")).toMatchObject({ parentId: "real-owner", confidence: "medium", via: "run-id" });
  });
});
