import "@testing-library/jest-dom/vitest";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TimelineEventRow } from "../../src/frontend/components/TimelineEventRow";
import type { TimelineEvent } from "../../src/shared/contracts";

const tokenEvent: TimelineEvent = {
  id: "ev-token",
  threadId: "thread-1",
  timestamp: "2026-05-27T10:00:00.000Z",
  sourceLine: 1,
  kind: "token_snapshot",
  severity: "info",
  previewText: "",
  tokenSnapshot: {
    timestamp: "2026-05-27T10:00:00.000Z",
    total: 120_000,
    input: 90_000,
    output: 30_000,
    cachedInput: 45_000,
    contextUtilization: 62,
    rateLimitPrimaryPercent: 54,
  },
};

describe("TimelineEventRow · token_count composition", () => {
  it("renders the Δ chip, stacked composition, legend, and meters", () => {
    render(
      <ol>
        <TimelineEventRow event={tokenEvent} delta={12_000} />
      </ol>,
    );

    // Δ since last snapshot.
    expect(screen.getByText(/Δ \+12\.0K since last/)).toBeVisible();

    // Composition total + cache-hit % (45000 / 90000 = 50%).
    const row = screen.getByText("TOKEN_COUNT").closest("li") as HTMLElement;
    expect(within(row).getByText("120.0K")).toBeVisible();
    expect(within(row).getByText(/50% of input cached/)).toBeVisible();

    // Stacked composition bar with three segments (cached / fresh / output).
    expect(row.querySelectorAll(".tkc-stack .seg")).toHaveLength(3);

    // Legend reports compact cached / fresh-input / output.
    expect(within(row).getByText(/cached 45\.0K/)).toBeVisible();
    expect(within(row).getByText(/input 45\.0K/)).toBeVisible();
    expect(within(row).getByText(/output 30\.0K/)).toBeVisible();

    // Context + rate meters with the snapshot percentages.
    expect(within(row).getByText("62.0%")).toBeVisible();
    expect(within(row).getByText("54%")).toBeVisible();
  });

  it("omits the Δ chip for the first snapshot (no previous total)", () => {
    render(
      <ol>
        <TimelineEventRow event={tokenEvent} />
      </ol>,
    );
    expect(screen.queryByText(/since last/)).toBeNull();
  });
});
