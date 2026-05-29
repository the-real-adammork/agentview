import { describe, expect, it } from "vitest";

import { createCodexHomeFixture } from "../fixtures/codexHome";
import { openStateStore } from "../../src/backend/sqlite/stateStore";

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
