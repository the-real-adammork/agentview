import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../../src/frontend/App";
import {
  agentGraphFixture,
  diagnosticsLogsFixture,
  sessionSummariesFixture,
  timelineEventsFixture,
  tokenSeriesFixture,
} from "../../src/fixtures/observatoryFixtures";

const primaryViews = ["Sessions", "Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

describe("fixture-backed five-view app shell", () => {
  it("renders persistent hazard/status chrome and five primary navigation buttons", () => {
    render(<App />);

    const banner = screen.getByRole("banner", { name: /observatory status/i });
    expect(banner).toHaveTextContent(/hazard/i);
    expect(banner).toHaveTextContent(/fixture mode/i);
    expect(banner).toHaveTextContent(/healthy/i);

    const primaryNav = screen.getByRole("navigation", { name: /primary views/i });
    const navButtons = within(primaryNav).getAllByRole("button");
    expect(navButtons).toHaveLength(5);

    for (const view of primaryViews) {
      expect(within(primaryNav).getByRole("button", { name: view })).toBeVisible();
    }

    expect(screen.getByRole("status", { name: /transport status/i })).toHaveTextContent(
      /source:\s*fixture/i,
    );
  });

  it("shows session fixture table headers and marks the first session as active", () => {
    render(<App />);

    const sessionsTable = screen.getByRole("table", { name: /sessions/i });
    const headers = within(sessionsTable).getAllByRole("columnheader").map((header) => header.textContent);

    expect(headers).toEqual(["Session", "Status", "Branch", "Model", "Tokens", "Children", "Updated"]);

    const [activeSession] = sessionSummariesFixture;
    const activeRow = within(sessionsTable).getByRole("row", {
      name: new RegExp(activeSession.title, "i"),
    });

    expect(activeRow).toHaveAttribute("aria-current", "true");
    expect(activeRow).toHaveTextContent(activeSession.status);
    expect(activeRow).toHaveTextContent(activeSession.branch);
    expect(activeRow).toHaveTextContent(activeSession.model);
  });

  it("navigates from sessions to timeline, agent graph, tokens, and diagnostics fixture views", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
    expect(screen.getByRole("heading", { name: /timeline/i })).toBeVisible();
    expect(screen.getByText(timelineEventsFixture[0].previewText)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Agent Graph" }));
    expect(screen.getByRole("heading", { name: /agent graph/i })).toBeVisible();
    expect(within(screen.getByRole("list", { name: /agent graph nodes/i })).getByText(agentGraphFixture.root.title)).toBeVisible();
    expect(screen.getByText(/open children/i)).toHaveTextContent(String(agentGraphFixture.openCount));

    fireEvent.click(screen.getByRole("button", { name: "Tokens" }));
    expect(screen.getByRole("heading", { name: /tokens/i })).toBeVisible();
    expect(screen.getByText(tokenSeriesFixture.totals.total.toLocaleString("en-US"))).toBeVisible();
    expect(screen.getByText(/cached input/i)).toHaveTextContent(
      tokenSeriesFixture.totals.cachedInput.toLocaleString("en-US"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(screen.getByRole("heading", { name: /diagnostics/i })).toBeVisible();
    expect(screen.getByText(diagnosticsLogsFixture[0].target)).toBeVisible();
    expect(screen.getByText(diagnosticsLogsFixture[0].bodyPreview)).toBeVisible();
  });
});
