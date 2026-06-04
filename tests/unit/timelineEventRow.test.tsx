import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TimelineEventRow } from "../../src/frontend/components/TimelineEventRow";
import type { TimelineEvent } from "../../src/shared/contracts";

const agentviewCss = readFileSync(join(process.cwd(), "src/frontend/styles/kits/agentview.css"), "utf8");

const cssRule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(agentviewCss)?.[1] ?? "";
};

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

describe("TimelineEventRow · sub-agent source rail", () => {
  const baseEvent: TimelineEvent = {
    id: "ev-sub",
    threadId: "thread-sub",
    timestamp: "2026-05-27T10:00:00.000Z",
    sourceLine: 1,
    kind: "assistant_message",
    severity: "info",
    previewText: "Worker did the thing.",
  };

  it("renders a depth-toned origin rail with bars and agent name when a source is given", () => {
    render(
      <ol>
        <TimelineEventRow event={baseEvent} source={{ depth: 1, name: "archimedes", tone: "amber" }} />
      </ol>,
    );
    const row = screen.getByText("Worker did the thing.").closest("li") as HTMLElement;
    const rail = row.querySelector(".ev-src-rail") as HTMLElement;
    expect(rail).not.toBeNull();
    expect(rail.dataset.tone).toBe("amber");
    expect(within(rail).getByText("archimedes")).toBeVisible();
    // depth 1 → two bars (root + one sub level).
    expect(rail.querySelectorAll(".ev-src-bar")).toHaveLength(2);
    expect(row).toHaveClass("with-src");
  });

  it("renders no origin rail when no source is given", () => {
    render(
      <ol>
        <TimelineEventRow event={baseEvent} />
      </ol>,
    );
    const row = screen.getByText("Worker did the thing.").closest("li") as HTMLElement;
    expect(row.querySelector(".ev-src-rail")).toBeNull();
    expect(row).not.toHaveClass("with-src");
  });
});

describe("TimelineEventRow · tool call command", () => {
  const execEvent: TimelineEvent = {
    id: "ev-exec",
    threadId: "thread-1",
    timestamp: "2026-05-27T10:00:00.000Z",
    sourceLine: 1,
    kind: "tool_call",
    severity: "info",
    previewText: "",
    toolName: "exec_command",
    argumentsPreview: '{"cmd":"curl -s https://example.test","workdir":"/repo","yield_time_ms":1000}',
    commandPreview: "curl -s https://example.test",
  };

  it("shows the extracted command, not the raw arguments JSON", () => {
    render(
      <ol>
        <TimelineEventRow event={execEvent} />
      </ol>,
    );
    expect(screen.getByText("$ curl -s https://example.test")).toBeVisible();
    expect(screen.queryByText(/"yield_time_ms"/)).toBeNull();
  });
});

describe("TimelineEventRow · overflow contract", () => {
  it("constrains row text so long event content ellipsizes instead of widening the timeline", () => {
    expect(cssRule(".ev")).toMatch(/min-width:\s*0/);
    expect(cssRule(".ev .body")).toMatch(/overflow:\s*hidden/);
    expect(cssRule(".ev .head > :not(.chip):not(button)")).toMatch(/text-overflow:\s*ellipsis/);
    expect(cssRule(".ev pre")).toMatch(/text-overflow:\s*ellipsis/);
    expect(cssRule(".ev .args")).toMatch(/text-overflow:\s*ellipsis/);
    expect(cssRule(".xr-out")).toMatch(/overflow:\s*hidden/);
  });
});
