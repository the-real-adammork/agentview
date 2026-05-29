import { describe, expect, it } from "vitest";

import { classifyThread, stripParentMarker } from "../../src/backend/relationships/markers";

const ORCH =
  "Use the implementation-execution skill as the phase orchestrator for phase-4-product-polish-deliverables. " +
  "Run state: docs/implementation-runs/2026-05-28-rca-workbench/run.yaml. " +
  "Phase state: docs/implementation-runs/2026-05-28-rca-workbench/phases/phase-4-product-polish-deliverables.yaml.";

describe("classifyThread", () => {
  it("detects an orchestrator, its phase, and run id", () => {
    const c = classifyThread({ firstUserMessage: ORCH, preview: "working" });
    expect(c.isOrchestrator).toBe(true);
    expect(c.phase).toBe("phase-4-product-polish-deliverables");
    expect(c.runId).toBe("2026-05-28-rca-workbench");
    expect(c.isSupervisor).toBe(false);
    expect(c.markerParentId).toBeNull();
  });

  it("detects a supervisor via the $implementation-execution invocation", () => {
    const c = classifyThread({
      firstUserMessage: "$implementation-execution start the rca-workbench run",
      preview: null,
    });
    expect(c.isSupervisor).toBe(true);
    expect(c.isOrchestrator).toBe(false);
  });

  it("never classifies an orchestrator as a supervisor even if it mentions the skill", () => {
    const c = classifyThread({ firstUserMessage: ORCH, preview: null });
    expect(c.isSupervisor).toBe(false);
  });

  it("extracts an av-parent marker id", () => {
    const c = classifyThread({
      firstUserMessage: "[av-parent:019e67b0-3000-7700-9000-00005bee6c00] do the thing",
      preview: null,
    });
    expect(c.markerParentId).toBe("019e67b0-3000-7700-9000-00005bee6c00");
  });

  it("treats an ordinary session as neither", () => {
    const c = classifyThread({ firstUserMessage: "fix the flaky test", preview: "done" });
    expect(c).toMatchObject({ isOrchestrator: false, isSupervisor: false, runId: null, markerParentId: null });
  });

  it("strips the marker (and collapsed whitespace) from a preview", () => {
    expect(stripParentMarker("[av-parent:abc-123]  hello world")).toBe("hello world");
    expect(stripParentMarker(null)).toBe("");
  });
});
