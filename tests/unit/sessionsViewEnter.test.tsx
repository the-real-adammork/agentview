import "@testing-library/jest-dom/vitest";

import { render } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { sessionSummariesFixture } from "../../src/fixtures/observatoryFixtures";
import { SessionsView } from "../../src/frontend/views/SessionsView";
import type { SessionFilter, SessionSummary } from "../../src/shared/contracts";

const noop = () => {};
const [root] = sessionSummariesFixture;

// A brand-new top-level session, as the SSE `sessions` frame would deliver it.
const newRoot: SessionSummary = {
  ...root,
  id: "freshly-spawned-root",
  parentId: null,
  title: "Freshly spawned root session",
  updatedAt: "2026-05-26T19:00:00.000Z",
};

const renderSessions = (sessions: SessionSummary[]) => (
  <SessionsView
    activeSessionId={root.id}
    onSelectSession={noop}
    onFilterChange={noop}
    filter={{} as SessionFilter}
    sessions={sessions}
    diagnosticsByThreadId={{}}
    isLoading={false}
    error={null}
  />
);

describe("SessionsView · feed-enter on new session", () => {
  it("does not animate any row on first paint", () => {
    const { container } = render(renderSessions(sessionSummariesFixture));
    expect(container.querySelectorAll("tr.session-row.feed-enter")).toHaveLength(0);
  });

  it("animates only the newly-arrived session row", () => {
    const { container, rerender } = render(renderSessions(sessionSummariesFixture));
    act(() => {
      rerender(renderSessions([newRoot, ...sessionSummariesFixture]));
    });
    const entered = container.querySelectorAll("tr.session-row.feed-enter");
    expect(entered).toHaveLength(1);
    expect(entered[0]).toHaveTextContent(/Freshly spawned root session/);
  });

  it("does not animate on a steady-state update that leaves the id set unchanged", () => {
    const { container, rerender } = render(renderSessions(sessionSummariesFixture));
    act(() => {
      // Same ids, new object identities (a token tick re-emits the list).
      rerender(renderSessions(sessionSummariesFixture.map((session) => ({ ...session }))));
    });
    expect(container.querySelectorAll("tr.session-row.feed-enter")).toHaveLength(0);
  });
});
