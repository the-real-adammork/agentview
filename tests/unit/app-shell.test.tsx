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

const primaryViews = ["Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

describe("fixture-backed app shell", () => {
  it("keeps large chrome token totals compact", () => {
    render(
      <Chrome
        activeView="Sessions"
        health={{ checkedAt: "2026-05-27T18:00:00.000Z", mode: "fixture", status: "ok" }}
        navigation={<nav aria-label="Primary views" />}
        palette="orange"
        onPaletteChange={() => {}}
        onOpenRepos={() => {}}
        onOpenSessions={() => {}}
        reposActive={false}
        sessionsActive
        headerRepo="workflowkit"
        activeSession={sessionSummariesFixture[0]}
        sessions={sessionSummariesFixture}
        sessionCount={500}
        tokenTotal={4_102_376_000}
        warningSessionCount={28}
      >
        <main />
      </Chrome>,
    );

    expect(screen.getByLabelText(/observatory summary/i)).toHaveTextContent(/4\.1B/);
  });

  it("renders persistent hazard/status chrome and four primary navigation buttons", () => {
    render(<App />);

    const banner = screen.getByRole("banner", { name: /observatory status/i });
    expect(banner).toHaveTextContent(/observatory · 観測装置/i);
    expect(banner).toHaveTextContent(/機密 \/ レベル 7/i);
    expect(banner).toHaveTextContent(/live/i);

    const reposButton = screen.getByRole("button", { name: /repos/i });
    expect(reposButton).toBeVisible();
    expect(reposButton).toHaveAttribute("aria-pressed", "false");
    expect(banner).toHaveTextContent(/fixture mode/i);
    expect(banner).toHaveTextContent(/healthy/i);

    const primaryNav = screen.getByRole("navigation", { name: /primary views/i });
    const navButtons = within(primaryNav).getAllByRole("button");
    expect(navButtons).toHaveLength(4);

    for (const view of primaryViews) {
      expect(within(primaryNav).getByRole("button", { name: view })).toBeVisible();
    }
    // Sessions is merged into the header session square, not a primary tab.
    expect(within(primaryNav).queryByRole("button", { name: "Sessions" })).toBeNull();
    expect(within(primaryNav).getByRole("button", { name: "Timeline" })).toHaveTextContent(/00\s*Timeline/i);
    // The session square reflects the default Sessions landing as the active surface.
    const sessionSquare = document.querySelector(".session-sq");
    expect(sessionSquare).not.toBeNull();
    expect(sessionSquare).toHaveAttribute("data-active", "true");

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
    expect(screen.getByText(/SORT · created_at/i)).toBeVisible();
    expect(screen.getByText(/TREE · thread_spawn_edges/i)).toBeVisible();

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
    const agentTree = screen.getByRole("list", { name: /agent tree/i });
    expect(within(agentTree).getByText(/● HERE/i)).toBeVisible();
    expect(within(agentTree).getByText(/ARCHIMEDES/i)).toBeVisible();
    expect(within(agentTree).getByText(/SOCRATES/i)).toBeVisible();
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
    // Per-session composition panel: compact total + a labeled "Cached input" row.
    expect(document.querySelector(".stc-total")).toHaveTextContent(
      `${(tokenSeriesFixture.totals.total / 1000).toFixed(1)}K`,
    );
    const cachedRow = screen.getByText("Cached input").closest(".stc-row");
    expect(cachedRow).not.toBeNull();
    expect(within(cachedRow as HTMLElement).getByText(tokenSeriesFixture.totals.cachedInput.toLocaleString("en-US"))).toBeVisible();
    // Token budget bars replace the top-sessions table.
    expect(screen.getByText(/token budget · by session/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(screen.getByRole("heading", { name: /diagnostics/i })).toBeVisible();
    expect(screen.getByText(/LOG STREAM/i)).toBeVisible();
    expect(screen.getByText(/RUNTIME/i)).toBeVisible();
    const diagnosticsTable = screen.getByRole("table", { name: /diagnostics logs/i });
    expect(diagnosticsTable).toHaveClass("diag-table");
    expect(diagnosticsTable).toHaveTextContent(diagnosticsLogsFixture[0].target);
    expect(diagnosticsTable).toHaveTextContent(diagnosticsLogsFixture[0].bodyPreview);
  });

  it("opens the Repos index from the header and scopes Sessions to a repo dossier", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /repos/i }));

    // Repos index: header + a repo card grouping the fixture sessions by repo.
    expect(screen.getByRole("heading", { name: /repos · index/i })).toBeVisible();
    const repoCard = screen.getByRole("article");
    expect(within(repoCard).getByText(/workflowkit/i)).toBeVisible();
    // Card footer summarizes the whole repo subtree (root + 2 sub-agents).
    expect(within(repoCard).getByText(/OPEN 3 SESSIONS/i)).toBeVisible();

    // Opening the repo drops into the Sessions dossier scoped to that repo.
    fireEvent.click(within(repoCard).getByText(/OPEN 3 SESSIONS/i));
    expect(screen.getByRole("button", { name: /all repos/i })).toBeVisible();
    expect(screen.getByRole("table", { name: /sessions/i })).toBeVisible();

    // The back affordance returns to the full index.
    fireEvent.click(screen.getByRole("button", { name: /all repos/i }));
    expect(screen.getByRole("heading", { name: /repos · index/i })).toBeVisible();
  });
});
