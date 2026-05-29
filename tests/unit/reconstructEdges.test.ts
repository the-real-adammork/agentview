import { describe, expect, it } from "vitest";

import { reconstructEdges, type ReconstructThread } from "../../src/backend/relationships/reconstruct";

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
