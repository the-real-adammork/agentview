import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionsView } from "../../src/frontend/views/SessionsView";
import type { SessionFilter, SessionSummary } from "../../src/shared/contracts";

const noop = () => {};

const session = (overrides: Partial<SessionSummary> & Pick<SessionSummary, "id">): SessionSummary => ({
  source: "codex",
  title: overrides.id,
  status: "complete",
  updatedAt: "2026-06-04T18:00:00.000Z",
  branch: "main",
  cwd: "/code/agentview",
  model: "gpt-codex-5",
  lastMessage: "",
  childCount: 0,
  openChildCount: 0,
  tokenTotal: 0,
  parentId: null,
  ...overrides,
});

const rowTitles = () => {
  const table = screen.getByRole("table", { name: "Sessions" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getByRole("rowheader").textContent ?? "");
};

describe("SessionsView sort dropdown", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("sorts visible session rows by created time and token count", () => {
    render(
      <SessionsView
        activeSessionId="older-heavy"
        onSelectSession={noop}
        onFilterChange={vi.fn()}
        filter={{ archived: "exclude" } as SessionFilter}
        sessions={[
          session({ id: "older-heavy", title: "Older heavy", createdAtMs: 100, tokenTotal: 300 }),
          session({ id: "newer-light", title: "Newer light", createdAtMs: 300, tokenTotal: 10 }),
          session({ id: "middle-mid", title: "Middle mid", createdAtMs: 200, tokenTotal: 100 }),
        ]}
        diagnosticsByThreadId={{}}
        isLoading={false}
        error={null}
      />,
    );

    const sort = screen.getByRole("combobox", { name: "Sort sessions" });
    expect(sort).toHaveValue("created_desc");
    expect(rowTitles()[0]).toContain("Newer light");

    fireEvent.change(sort, { target: { value: "created_asc" } });
    expect(rowTitles()[0]).toContain("Older heavy");

    fireEvent.change(sort, { target: { value: "tokens_desc" } });
    expect(rowTitles()[0]).toContain("Older heavy");

    fireEvent.change(sort, { target: { value: "tokens_asc" } });
    expect(rowTitles()[0]).toContain("Newer light");
  });

  it("persists the selected sort mode across visits", () => {
    window.localStorage.setItem("agentview:sessions:sort", "tokens_desc");

    const { unmount } = render(
      <SessionsView
        activeSessionId="older-heavy"
        onSelectSession={noop}
        onFilterChange={vi.fn()}
        filter={{ archived: "exclude" } as SessionFilter}
        sessions={[
          session({ id: "older-heavy", title: "Older heavy", createdAtMs: 100, tokenTotal: 300 }),
          session({ id: "newer-light", title: "Newer light", createdAtMs: 300, tokenTotal: 10 }),
        ]}
        diagnosticsByThreadId={{}}
        isLoading={false}
        error={null}
      />,
    );

    const sort = screen.getByRole("combobox", { name: "Sort sessions" });
    expect(sort).toHaveValue("tokens_desc");
    expect(rowTitles()[0]).toContain("Older heavy");

    fireEvent.change(sort, { target: { value: "created_asc" } });
    expect(window.localStorage.getItem("agentview:sessions:sort")).toBe("created_asc");

    unmount();

    render(
      <SessionsView
        activeSessionId="older-heavy"
        onSelectSession={noop}
        onFilterChange={vi.fn()}
        filter={{ archived: "exclude" } as SessionFilter}
        sessions={[
          session({ id: "older-heavy", title: "Older heavy", createdAtMs: 100, tokenTotal: 300 }),
          session({ id: "newer-light", title: "Newer light", createdAtMs: 300, tokenTotal: 10 }),
        ]}
        diagnosticsByThreadId={{}}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Sort sessions" })).toHaveValue("created_asc");
  });

  it("matches repo-scoped sessions case-insensitively", () => {
    render(
      <SessionsView
        activeSessionId="gofundme-root"
        onSelectSession={noop}
        onFilterChange={vi.fn()}
        filter={{ archived: "exclude" } as SessionFilter}
        repoFilter="GOFUNDME"
        sessions={[
          session({
            id: "gofundme-root",
            title: "Gofundme root session",
            cwd: "/Users/adam/Gauntlet/gofundme",
          }),
          session({
            id: "agentview-root",
            title: "AgentView root session",
            cwd: "/Users/adam/Projects/agentview",
          }),
        ]}
        diagnosticsByThreadId={{}}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText("Gofundme root session")).toBeInTheDocument();
    expect(screen.queryByText("AgentView root session")).not.toBeInTheDocument();
  });
});
