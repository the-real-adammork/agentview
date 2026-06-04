import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sessionSummariesFixture } from "../../src/fixtures/observatoryFixtures";
import { SessionsView } from "../../src/frontend/views/SessionsView";
import type { SessionFilter } from "../../src/shared/contracts";

const noop = () => {};
const NOW = new Date("2026-06-04T17:30:00.000Z");
const TODAY_START = new Date("2026-06-04T00:00:00.000").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

const renderSessions = (filter: SessionFilter = {}, onFilterChange = vi.fn()) => {
  render(
    <SessionsView
      activeSessionId={sessionSummariesFixture[0].id}
      onSelectSession={noop}
      onFilterChange={onFilterChange}
      filter={{ archived: "exclude", search: "agent", ...filter }}
      sessions={sessionSummariesFixture}
      diagnosticsByThreadId={{}}
      isLoading={false}
      error={null}
    />,
  );

  return onFilterChange;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionsView date range filter", () => {
  it("filters sessions by today, last three days, last week, and all", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const onFilterChange = renderSessions();
    const rangeFilters = screen.getByRole("group", { name: "Updated range quick filters" });

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archived: "exclude",
        search: "agent",
        updatedAfterMs: TODAY_START,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "3 days" }));
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archived: "exclude",
        search: "agent",
        updatedAfterMs: NOW.getTime() - 3 * DAY_MS,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archived: "exclude",
        search: "agent",
        updatedAfterMs: NOW.getTime() - 7 * DAY_MS,
      }),
    );

    fireEvent.click(within(rangeFilters).getByRole("button", { name: "All" }));
    expect(onFilterChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        archived: "exclude",
        search: "agent",
        updatedAfterMs: undefined,
      }),
    );
  });
});
