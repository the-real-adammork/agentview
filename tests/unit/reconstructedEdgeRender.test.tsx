import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { AgentGraphView } from "../../src/frontend/views/AgentGraphView";
import type { AgentGraph } from "../../src/shared/contracts";

const graph: AgentGraph = {
  root: { id: "sup", title: "Supervisor", status: "complete", depth: 0, tokenTotal: 0 },
  nodes: [
    { id: "sup", title: "Supervisor", status: "complete", depth: 0, tokenTotal: 0 },
    { id: "orch", title: "Orchestrator", status: "complete", depth: 1, tokenTotal: 0 },
  ],
  edges: [{ parentId: "sup", childId: "orch", status: "closed", source: "reconstructed", confidence: "high", via: "run-id" }],
  maxDepth: 2,
  truncatedDepth: false,
  openCount: 0,
  statusSummary: { open: 0, closed: 1, failed: 0 },
};

describe("AgentGraphView reconstructed edges", () => {
  it("mounts the graph canvas with a reconstructed edge in the model", () => {
    const { container } = render(
      <AgentGraphView
        graph={graph}
        isLoading={false}
        error={null}
        maxDepth={2}
        onMaxDepthChange={() => {}}
        onRefresh={() => {}}
        onSelectSession={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="agent-graph-canvas"]')).not.toBeNull();
  });
});
