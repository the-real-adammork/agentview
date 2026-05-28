import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../../src/frontend/App";
import { Chrome } from "../../src/frontend/components/Chrome";
import {
  agentGraphFixture,
  diagnosticsLogsFixture,
  sessionSummariesFixture,
  timelineEventsFixture,
  tokenSeriesFixture,
} from "../../src/fixtures/observatoryFixtures";

const primaryViews = ["Sessions", "Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

describe("fixture-backed five-view app shell", () => {
  it("keeps large chrome token totals compact", () => {
    render(
      <Chrome
        activeView="Sessions"
        health={{ checkedAt: "2026-05-27T18:00:00.000Z", mode: "fixture", status: "ok" }}
        navigation={<nav aria-label="Primary views" />}
        palette="orange"
        onPaletteChange={() => {}}
        sessionCount={500}
        tokenTotal={4_102_376_000}
        warningSessionCount={28}
      >
        <main />
      </Chrome>,
    );

    expect(screen.getByLabelText(/observatory summary/i)).toHaveTextContent(/4\.1B/);
  });

  it("renders persistent hazard/status chrome and five primary navigation buttons", () => {
    render(<App />);

    const banner = screen.getByRole("banner", { name: /observatory status/i });
    expect(banner).toHaveTextContent(/observatory · 観測装置/i);
    expect(banner).toHaveTextContent(/機密 \/ レベル 7/i);
    expect(banner).toHaveTextContent(/live/i);

    const masthead = screen.getByRole("heading", { name: /workflowkit/i });
    expect(masthead).toBeVisible();
    expect(screen.getByText(/\/\/ Observatory · 観測/i)).toBeVisible();
    expect(banner).toHaveTextContent(/fixture mode/i);
    expect(banner).toHaveTextContent(/healthy/i);

    const primaryNav = screen.getByRole("navigation", { name: /primary views/i });
    const navButtons = within(primaryNav).getAllByRole("button");
    expect(navButtons).toHaveLength(5);

    for (const view of primaryViews) {
      expect(within(primaryNav).getByRole("button", { name: view })).toBeVisible();
    }
    const sessionsButton = within(primaryNav).getByRole("button", { name: "Sessions" });
    expect(sessionsButton).toHaveAttribute("data-active", "true");
    expect(sessionsButton).toHaveTextContent(/00\s*Sessions/i);

    expect(screen.getByRole("status", { name: /transport status/i })).toHaveTextContent(
      /\/\/ PATTERN: CODEX OPS/i,
    );
    expect(screen.getByRole("status", { name: /transport status/i }).children).toHaveLength(5);
    expect(screen.getByRole("status", { name: /transport status/i })).toHaveTextContent(/\$CODEX_HOME = ~\/\.codex/i);
  });

  it("shows session fixture table headers and marks the first session as active", () => {
    render(<App />);

    expect(screen.getByText("SESSION INDEX")).toBeVisible();
    expect(screen.getByText(/Token usage · last 12h/i)).toBeVisible();
    expect(screen.getByText(/RESULTS ·/i)).toBeVisible();
    expect(screen.getByText(/SORT · updated_at/i)).toBeVisible();
    expect(screen.getByText(/JOIN · thread_spawn_edges/i)).toBeVisible();

    const sessionsTable = screen.getByRole("table", { name: /sessions/i });
    expect(sessionsTable).toHaveClass("tbl");
    const headers = within(sessionsTable).getAllByRole("columnheader").map((header) => header.textContent);

    expect(headers).toEqual([
      "",
      "Updated",
      "Title / Brief",
      "Repo · branch",
      "Model",
      "Tokens",
      "Source",
      "Child",
      "Warn",
      "",
    ]);

    const [activeSession] = sessionSummariesFixture;
    const activeRow = within(sessionsTable).getByRole("row", {
      name: new RegExp(activeSession.title, "i"),
    });

    expect(activeRow).toHaveAttribute("aria-current", "true");
    expect(activeRow).toHaveTextContent(activeSession.status);
    expect(activeRow).toHaveTextContent("workflowkit");
    expect(activeRow).not.toHaveTextContent(activeSession.cwd);
    expect(activeRow).toHaveTextContent(activeSession.model);
  });

  it("navigates from sessions to timeline, agent graph, tokens, and diagnostics fixture views", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.getByRole("heading", { name: /timeline/i })).toBeVisible();
    expect(screen.getByText(/TURN 01 · VITALS/i)).toBeVisible();
    expect(screen.getByText(/Other Sessions/i)).toBeVisible();
    expect(screen.getByText(/Context window/i)).toBeVisible();
    expect(screen.getByText(/Tool Usage · this turn/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /open agent graph/i })).toBeVisible();
    expect(screen.getByRole("list", { name: /Timeline events/i })).toHaveClass("tl-stream");
    expect(screen.getByText(timelineEventsFixture[0].previewText)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Agent Graph" }));
    expect(screen.getByRole("heading", { name: /agent graph/i })).toBeVisible();
    expect(within(screen.getByTestId("agent-graph-canvas")).getByText(agentGraphFixture.root.title)).toBeVisible();
    expect(screen.getByText(/open children/i)).toHaveTextContent(String(agentGraphFixture.openCount));

    fireEvent.click(screen.getByRole("button", { name: "Tokens" }));
    expect(screen.getByRole("heading", { name: /tokens/i })).toBeVisible();
    expect(screen.getByText(tokenSeriesFixture.totals.total.toLocaleString("en-US"))).toBeVisible();
    expect(screen.getByText(/cached input/i)).toHaveTextContent(
      tokenSeriesFixture.totals.cachedInput.toLocaleString("en-US"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(screen.getByRole("heading", { name: /diagnostics/i })).toBeVisible();
    expect(screen.getByText(/LOG STREAM/i)).toBeVisible();
    expect(screen.getByText(/RUNTIME/i)).toBeVisible();
    const diagnosticsTable = screen.getByRole("table", { name: /diagnostics logs/i });
    expect(diagnosticsTable).toHaveClass("diag-table");
    expect(diagnosticsTable).toHaveTextContent(diagnosticsLogsFixture[0].target);
    expect(diagnosticsTable).toHaveTextContent(diagnosticsLogsFixture[0].bodyPreview);
  });
});
