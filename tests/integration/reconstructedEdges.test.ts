import { describe, expect, it } from "vitest";

import { createCodexHomeFixture } from "../fixtures/codexHome";
import { openStateStore } from "../../src/backend/sqlite/stateStore";
import { deriveAgentGraph } from "../../src/backend/api/agentGraph";

const CWD = "/repo/agentview";
const orchPrompt = (phase: string, run = "rca-workbench") =>
  `Use the implementation-execution skill as the phase orchestrator for ${phase}. ` +
  `Run state: docs/implementation-runs/${run}/run.yaml.`;

describe("reconstructed supervisor->orchestrator edges", () => {
  it("stamps a reconstructed parentId + provenance on an orphan orchestrator", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "supervisor",
          cwd: CWD,
          createdAtMs: 1_000_000,
          updatedAtMs: 9_000_000,
          firstUserMessage: "$implementation-execution kick off rca-workbench",
          threadSource: "user",
        },
        {
          id: "orchestrator",
          cwd: CWD,
          createdAtMs: 2_000_000,
          updatedAtMs: 3_000_000,
          firstUserMessage: orchPrompt("phase-4"),
          threadSource: "user",
        },
      ],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const orch = await store.getThread("orchestrator");
        expect(orch?.parentId).toBe("supervisor");
        expect(orch?.parentEdgeSource).toBe("reconstructed");
        expect(orch?.parentEdgeConfidence).toBe("high");
        expect(orch?.parentEdgeVia).toBe("cwd-time");

        const supervisor = await store.getThread("supervisor");
        expect(supervisor?.parentId ?? null).toBeNull();
        expect(supervisor?.parentEdgeSource).toBeUndefined();
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("leaves a real codex parent untouched", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "p", cwd: CWD, createdAtMs: 1_000_000, updatedAtMs: 2_000_000, firstUserMessage: "parent", threadSource: "user" },
        { id: "c", cwd: CWD, createdAtMs: 1_500_000, updatedAtMs: 2_000_000, firstUserMessage: "child", threadSource: "subagent" },
      ],
      edges: [{ parentThreadId: "p", childThreadId: "c", status: "closed" }],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const child = await store.getThread("c");
        expect(child?.parentId).toBe("p");
        expect(child?.parentEdgeSource).toBe("codex");
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("reconstructed edges in the agent graph", () => {
  it("includes the orchestrator subtree under the supervisor with reconstructed provenance", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "supervisor", cwd: CWD, createdAtMs: 1_000_000, updatedAtMs: 9_000_000, firstUserMessage: "$implementation-execution go", threadSource: "user" },
        { id: "orchestrator", cwd: CWD, createdAtMs: 2_000_000, updatedAtMs: 3_000_000, firstUserMessage: orchPrompt("phase-4"), threadSource: "user" },
        { id: "worker", cwd: CWD, createdAtMs: 2_500_000, updatedAtMs: 2_900_000, firstUserMessage: "do work", threadSource: "subagent" },
      ],
      edges: [{ parentThreadId: "orchestrator", childThreadId: "worker", status: "closed" }],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const rows = await store.getAgentGraphRows("supervisor", 5);
        const graph = deriveAgentGraph("supervisor", rows, { maxDepth: 5 });
        const ids = graph.nodes.map((n) => n.id).sort();
        expect(ids).toEqual(["orchestrator", "supervisor", "worker"]);
        const recon = graph.edges.find((e) => e.parentId === "supervisor" && e.childId === "orchestrator");
        expect(recon?.source).toBe("reconstructed");
        expect(graph.edges.find((e) => e.parentId === "orchestrator" && e.childId === "worker")?.source ?? "codex").toBe("codex");
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
