import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { sessionSummariesFixture } from "../../src/fixtures/observatoryFixtures";
import { TimelineView } from "../../src/frontend/views/TimelineView";
import type { SessionSummary, TimelineEvent, TimelinePayload } from "../../src/shared/contracts";

const [root, archimedes] = sessionSummariesFixture;

const primaryEvent: TimelineEvent = {
  id: "p1",
  threadId: root.id,
  timestamp: "2026-05-27T10:00:00.000Z",
  sourceLine: 1,
  kind: "user_message",
  severity: "info",
  previewText: "Root says hello.",
};

const subEvent: TimelineEvent = {
  id: "s1",
  threadId: archimedes.id,
  timestamp: "2026-05-27T10:00:05.000Z",
  sourceLine: 1,
  kind: "user_message",
  severity: "info",
  previewText: "Sub-agent reporting.",
};

const noop = () => {};

// The server merges the spawn subtree into payload.events; the view filters it.
function renderTimeline(opts: {
  activeSession: SessionSummary;
  events: TimelineEvent[];
  scope: "this" | "all";
}) {
  const payload = { threadId: root.id, events: opts.events, nextByteOffset: 0 } as TimelinePayload;
  return render(
    <TimelineView
      activeSession={opts.activeSession}
      sessions={sessionSummariesFixture}
      payload={payload}
      activeKind="all"
      scope={opts.scope}
      onScopeChange={noop}
      onKindChange={noop}
      onRefresh={noop}
      onTail={noop}
      onSelectSession={noop}
    />,
  );
}

describe("TimelineView · +SUBS scope", () => {
  it("offers the scope toggle when the active thread has descendants", () => {
    renderTimeline({ activeSession: root, events: [primaryEvent], scope: "this" });
    expect(screen.getByRole("button", { name: /\+subs/i })).toBeVisible();
  });

  it("filters the merged subtree to the active thread in THIS scope", () => {
    renderTimeline({ activeSession: root, events: [primaryEvent, subEvent], scope: "this" });
    expect(screen.getByText("Root says hello.")).toBeVisible();
    expect(screen.queryByText("Sub-agent reporting.")).toBeNull();
  });

  it("shows the whole subtree with a depth-toned origin rail in +SUBS scope", () => {
    renderTimeline({ activeSession: root, events: [primaryEvent, subEvent], scope: "all" });
    expect(screen.getByText("Root says hello.")).toBeVisible();
    const subRow = screen.getByText("Sub-agent reporting.").closest("li") as HTMLElement;
    const rail = subRow.querySelector(".ev-src-rail") as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.dataset.tone).toBe("amber"); // ARCHIMEDES is a depth-1 sub-agent
    expect(rail.textContent).toMatch(/archimedes/i);
  });

  it("renders only the most recent 250 events and reveals older ones on demand", () => {
    const many: TimelineEvent[] = Array.from({ length: 1100 }, (_, index) => ({
      id: `e${index}`,
      threadId: root.id,
      timestamp: new Date(Date.UTC(2026, 4, 27, 0, 0, index)).toISOString(),
      sourceLine: index + 1,
      kind: "user_message",
      severity: "info",
      previewText: `event ${index}`,
    }));
    renderTimeline({ activeSession: root, events: many, scope: "this" });

    const stream = screen.getByRole("list", { name: /timeline events/i });
    expect(stream.querySelectorAll("li.ev")).toHaveLength(250);
    // Newest-first: the most recent event renders, the oldest is withheld.
    expect(screen.getByText("event 1099")).toBeVisible();
    expect(screen.queryByText("event 0")).toBeNull();

    const loadOlder = screen.getByRole("button", { name: /load older events/i });
    expect(loadOlder).toHaveTextContent(/850 more/);
    fireEvent.click(loadOlder);
    expect(stream.querySelectorAll("li.ev")).toHaveLength(500);
    expect(screen.getByText("event 600")).toBeVisible();
  });

  it("marks each event with the agent's depth when viewing a sub-agent thread (THIS scope)", () => {
    renderTimeline({ activeSession: archimedes, events: [subEvent], scope: "this" });
    const row = screen.getByText("Sub-agent reporting.").closest("li") as HTMLElement;
    const rail = row.querySelector(".ev-src-rail") as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.dataset.tone).toBe("amber");
  });
});

describe("TimelineView · feed-enter on live insert", () => {
  const event = (id: string, seconds: number): TimelineEvent => ({
    id,
    threadId: root.id,
    timestamp: new Date(Date.UTC(2026, 4, 27, 10, 0, seconds)).toISOString(),
    sourceLine: seconds + 1,
    kind: "user_message",
    severity: "info",
    previewText: `event ${id}`,
  });

  const renderWith = (events: TimelineEvent[]) => (
    <TimelineView
      activeSession={root}
      sessions={sessionSummariesFixture}
      payload={{ threadId: root.id, events, nextByteOffset: 0 } as TimelinePayload}
      activeKind="all"
      scope="this"
      onScopeChange={noop}
      onKindChange={noop}
      onRefresh={noop}
      onTail={noop}
      onSelectSession={noop}
    />
  );

  it("does not animate any row on first paint", () => {
    const { container } = render(renderWith([event("a", 1), event("b", 2)]));
    expect(container.querySelectorAll("li.ev.feed-enter")).toHaveLength(0);
  });

  it("animates only the newly-arrived event, regardless of the tail toggle", () => {
    const { container, rerender } = render(renderWith([event("a", 1), event("b", 2)]));
    act(() => {
      rerender(renderWith([event("a", 1), event("b", 2), event("c", 3)]));
    });
    const entered = container.querySelectorAll("li.ev.feed-enter");
    expect(entered).toHaveLength(1);
    expect(entered[0]).toHaveTextContent("event c");
  });

  it("clears the animation after it plays and does not re-animate a seen event", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(renderWith([event("a", 1)]));
      act(() => {
        rerender(renderWith([event("a", 1), event("c", 3)]));
      });
      expect(container.querySelectorAll("li.ev.feed-enter")).toHaveLength(1);
      // After the animation window the class is dropped...
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(container.querySelectorAll("li.ev.feed-enter")).toHaveLength(0);
      // ...and an unrelated re-render does not bring it back.
      act(() => {
        rerender(renderWith([event("a", 1), event("c", 3)]));
      });
      expect(container.querySelectorAll("li.ev.feed-enter")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TimelineView · ThreadNav feed-enter on new thread", () => {
  const newChild: SessionSummary = {
    ...archimedes,
    id: "freshly-spawned-child",
    parentId: root.id,
    threadSource: "subagent",
    agentRole: "worker",
    agentNickname: "newbie",
  };

  const renderNav = (sessions: SessionSummary[]) => (
    <TimelineView
      activeSession={root}
      sessions={sessions}
      payload={{ threadId: root.id, events: [primaryEvent], nextByteOffset: 0 } as TimelinePayload}
      activeKind="all"
      scope="this"
      onScopeChange={noop}
      onKindChange={noop}
      onRefresh={noop}
      onTail={noop}
      onSelectSession={noop}
    />
  );

  it("does not animate any thread row on first paint", () => {
    const { container } = render(renderNav(sessionSummariesFixture));
    expect(container.querySelectorAll(".thread-row.feed-enter")).toHaveLength(0);
  });

  it("animates only the newly-spawned thread row", () => {
    const { container, rerender } = render(renderNav(sessionSummariesFixture));
    act(() => {
      rerender(renderNav([...sessionSummariesFixture, newChild]));
    });
    const entered = container.querySelectorAll(".thread-row.feed-enter");
    expect(entered).toHaveLength(1);
    expect(entered[0]).toHaveTextContent(/newbie/);
  });
});
