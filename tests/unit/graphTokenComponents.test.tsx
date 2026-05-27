import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentGraphView } from "../../src/frontend/views/AgentGraphView";
import { TokensView } from "../../src/frontend/views/TokensView";
import { agentGraphFixture, sessionSummariesFixture, tokenSeriesFixture } from "../../src/fixtures/observatoryFixtures";

describe("graph and token views", () => {
  it("renders graph nodes with inspector controls and navigates selected nodes to Timeline", () => {
    const onSelectSession = vi.fn();
    const onRefresh = vi.fn();

    render(
      <AgentGraphView
        activeSession={sessionSummariesFixture[0]}
        error={null}
        graph={agentGraphFixture}
        isLoading={false}
        maxDepth={2}
        onMaxDepthChange={vi.fn()}
        onRefresh={onRefresh}
        onSelectSession={onSelectSession}
      />,
    );

    expect(screen.getByTestId("agent-graph-canvas")).toBeVisible();
    expect(screen.getByTestId("agent-graph-edges")).toBeVisible();
    expect(screen.getByText(/agent tree · thread_spawn_edges/i)).toBeVisible();

    const graphRegion = screen.getByRole("list", { name: /agent graph nodes/i });
    expect(within(graphRegion).getByRole("button", { name: /archimedes audit logs_2 noisy targets/i })).toBeVisible();

    fireEvent.click(within(graphRegion).getByRole("button", { name: /archimedes audit logs_2 noisy targets/i }));
    expect(screen.getByRole("complementary", { name: /selected graph node/i })).toHaveTextContent("ARCHIMEDES");
    expect(screen.getByRole("complementary", { name: /selected graph node/i })).toHaveTextContent("Node · Inspector");

    fireEvent.click(screen.getByRole("button", { name: /open selected in timeline/i }));
    expect(onSelectSession).toHaveBeenCalledWith("019e67b1-300d-7711-901f-00005bee6c5b", "Timeline");

    fireEvent.change(screen.getByRole("spinbutton", { name: /graph depth/i }), { target: { value: "1" } });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("renders token aggregates, rate meters, empty-state reasons, and top-session drill-down", () => {
    const onSelectSession = vi.fn();

    render(
      <TokensView
        activeSession={sessionSummariesFixture[0]}
        error={null}
        isLoading={false}
        onRefresh={vi.fn()}
        onSelectSession={onSelectSession}
        series={tokenSeriesFixture}
        topSessions={sessionSummariesFixture}
      />,
    );

    expect(screen.getByRole("heading", { name: /tokens/i })).toBeVisible();
    expect(screen.getByText(/aggregate token flow/i)).toBeVisible();
    expect(screen.getByText(/token curve · token_count snapshots/i)).toBeVisible();
    expect(screen.getByText(/top sessions · tokens used/i)).toBeVisible();
    expect(screen.getByText(/cache hit ratio · last snapshots/i)).toBeVisible();
    expect(screen.getByLabelText(/cached input ratio/i)).toHaveTextContent("7.6%");
    expect(screen.getByRole("meter", { name: /primary rate limit/i })).toHaveAttribute("aria-valuenow", "54");
    expect(screen.getByRole("table", { name: /top token sessions/i })).toHaveTextContent("184,312");

    fireEvent.click(screen.getByRole("button", { name: /open build observatory dashboard/i }));
    expect(onSelectSession).toHaveBeenCalledWith(sessionSummariesFixture[0].id, "Timeline");
  });
});
