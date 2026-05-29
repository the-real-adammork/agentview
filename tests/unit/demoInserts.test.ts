import { describe, expect, it } from "vitest";

import { sessionSummariesFixture } from "../../src/fixtures/observatoryFixtures";
import { appendDemoEvent, buildDemoSession } from "../../src/frontend/live/demoInserts";
import type { TimelinePayload } from "../../src/shared/contracts";

const [root] = sessionSummariesFixture;
const nowMs = Date.UTC(2026, 4, 29, 12, 0, 0);

describe("demoInserts · buildDemoSession", () => {
  it("derives a fresh top-level session with a unique id and a current timestamp", () => {
    const session = buildDemoSession(root, 3, nowMs);
    expect(session.id).toBe("demo-session-3");
    expect(session.parentId).toBeNull();
    expect(session.id).not.toBe(root.id);
    expect(new Date(session.updatedAt).getTime()).toBe(nowMs);
  });

  it("places each demo session in its own repo so a new repo card also appears", () => {
    expect(buildDemoSession(root, 1, nowMs).cwd).not.toBe(buildDemoSession(root, 2, nowMs).cwd);
  });
});

describe("demoInserts · appendDemoEvent", () => {
  const payload: TimelinePayload = {
    threadId: root.id,
    events: [
      { id: "existing", threadId: root.id, timestamp: "2026-05-29T11:59:00.000Z", sourceLine: 1, kind: "assistant_message", severity: "info", previewText: "old" },
    ],
    nextByteOffset: 0,
  } as TimelinePayload;

  it("appends one new event tagged with the payload's threadId, preserving prior events", () => {
    const next = appendDemoEvent(payload, 5, nowMs);
    expect(next.events).toHaveLength(2);
    expect(next.events[0].id).toBe("existing");
    const added = next.events[1];
    expect(added.threadId).toBe(root.id);
    expect(added.id).toBe("demo-event-5");
    expect(new Date(added.timestamp).getTime()).toBe(nowMs);
  });

  it("does not mutate the original payload", () => {
    appendDemoEvent(payload, 6, nowMs);
    expect(payload.events).toHaveLength(1);
  });
});
