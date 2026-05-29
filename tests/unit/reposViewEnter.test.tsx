import "@testing-library/jest-dom/vitest";

import { render } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { sessionSummariesFixture } from "../../src/fixtures/observatoryFixtures";
import { ReposView } from "../../src/frontend/views/ReposView";
import type { SessionSummary } from "../../src/shared/contracts";

const noop = () => {};
const nowIso = new Date().toISOString(); // repos only list sessions active in the last 12h
const [root] = sessionSummariesFixture;

const recentRoot = (id: string, title: string): SessionSummary => ({
  ...root,
  id,
  title,
  parentId: null,
  threadSource: "user",
  agentRole: undefined,
  childCount: 0,
  openChildCount: 0,
  updatedAt: nowIso,
});

const existing = recentRoot("repo-root-existing", "Existing active root");
const arrival = recentRoot("repo-root-arrival", "Newly active root");

const renderRepos = (sessions: SessionSummary[]) => (
  <ReposView sessions={sessions} onOpenRepo={noop} onSelectSession={noop} />
);

describe("ReposView · feed-enter on new active session", () => {
  it("does not animate any tree row on first paint", () => {
    const { container } = render(renderRepos([existing]));
    expect(container.querySelectorAll(".repo-tree-row.feed-enter")).toHaveLength(0);
  });

  it("animates only the newly-active session row", () => {
    const { container, rerender } = render(renderRepos([existing]));
    act(() => {
      rerender(renderRepos([existing, arrival]));
    });
    const entered = container.querySelectorAll(".repo-tree-row.feed-enter");
    expect(entered).toHaveLength(1);
    expect(entered[0]).toHaveTextContent(/Newly active root/);
  });
});
