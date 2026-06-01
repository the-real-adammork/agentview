import { afterEach, describe, expect, it, vi } from "vitest";

import { exportFilteredRollout } from "../../src/frontend/export/exportFilteredRollout";
import type { TimelineEvent } from "../../src/shared/contracts";

const event = (threadId: string, sourceLine: number): TimelineEvent => ({
  id: `${threadId}-${sourceLine}`,
  threadId,
  timestamp: "2026-05-30T10:00:00.000Z",
  sourceLine,
  kind: "user_message",
  severity: "info",
  previewText: "hello",
});

describe("exportFilteredRollout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports by session id without a source id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"type":"user"}\n', { status: 200 }));
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:agentview-export"),
      revokeObjectURL: vi.fn(),
    });

    await exportFilteredRollout([event("cc-session", 7)], "all");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      threadId: "cc-session",
      sourceLines: [7],
      includeResults: true,
    });
  });
});
