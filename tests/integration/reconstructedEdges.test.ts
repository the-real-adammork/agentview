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

describe("full rca-workbench-style run", () => {
  it("reconstructs one supervisor over two phase orchestrators, each with a worker", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "supervisor", cwd: CWD, createdAtMs: 1_000_000, updatedAtMs: 9_000_000, firstUserMessage: "$implementation-execution rca-workbench", threadSource: "user" },
        { id: "orch-1", cwd: CWD, createdAtMs: 2_000_000, updatedAtMs: 4_000_000, firstUserMessage: orchPrompt("phase-1"), threadSource: "user" },
        { id: "orch-4", cwd: CWD, createdAtMs: 5_000_000, updatedAtMs: 6_000_000, firstUserMessage: orchPrompt("phase-4"), threadSource: "user" },
        { id: "w1", cwd: CWD, createdAtMs: 2_500_000, updatedAtMs: 3_000_000, firstUserMessage: "phase 1 work", threadSource: "subagent" },
        { id: "w4", cwd: CWD, createdAtMs: 5_500_000, updatedAtMs: 5_800_000, firstUserMessage: "phase 4 work", threadSource: "subagent" },
      ],
      edges: [
        { parentThreadId: "orch-1", childThreadId: "w1", status: "closed" },
        { parentThreadId: "orch-4", childThreadId: "w4", status: "closed" },
      ],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const sessions = await store.listSessions({ archived: "exclude" }, { limit: 100, offset: 0 });
        const byId = new Map(sessions.map((s) => [s.id, s]));
        expect(byId.get("orch-1")?.parentId).toBe("supervisor");
        expect(byId.get("orch-4")?.parentId).toBe("supervisor");
        expect(byId.get("orch-1")?.parentEdgeSource).toBe("reconstructed");

        const graph = deriveAgentGraph("supervisor", await store.getAgentGraphRows("supervisor", 5), { maxDepth: 5 });
        expect(graph.nodes.map((n) => n.id).sort()).toEqual(["orch-1", "orch-4", "supervisor", "w1", "w4"]);
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("marker hygiene", () => {
  it("strips the av-parent marker from preview/first-message/title fields", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "sup", cwd: CWD, createdAtMs: 1_000_000, updatedAtMs: 9_000_000, firstUserMessage: "$implementation-execution go", threadSource: "user" },
        {
          id: "orch",
          cwd: CWD,
          createdAtMs: 2_000_000,
          updatedAtMs: 3_000_000,
          firstUserMessage: `[av-parent:sup] ${orchPrompt("phase-1")}`,
          preview: "[av-parent:sup] latest line",
          threadSource: "user",
        },
      ],
    });
    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const orch = await store.getThread("orch");
        expect(orch?.firstUserMessagePreview).not.toContain("av-parent");
        expect(orch?.preview).not.toContain("av-parent");
        expect(orch?.lastMessage).not.toContain("av-parent");
        expect(orch?.title).not.toContain("av-parent");
        expect(orch?.parentId).toBe("sup"); // still linked via the marker
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
