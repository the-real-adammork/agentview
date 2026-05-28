import { appendFile } from "node:fs/promises";
import { expect, test, type TestInfo } from "@playwright/test";

import { writeLegacyE2eRolloutFixtures, writeObservedRolloutFixtures } from "./observedSourceFixture";

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

test.describe("real Timeline detail @timeline", () => {
  test("renders parsed rollout rows, redacted previews, collapsed output, scrubber dots, grouped filters, and tail updates", async ({
    page,
    }, testInfo) => {
    await writeLegacyE2eRolloutFixtures();
    await page.goto(appBaseUrl(testInfo));
    const initialTimelineResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/timeline") && !response.url().includes("fromByte="),
    );
    // Select the user-root row explicitly (its rollout holds these fixtures);
    // the default "Active" selection lands on the sub-agent, not the parent.
    await page.getByRole("table", { name: /sessions/i }).getByRole("row", { name: /Parent real sessions work/i }).click();
    const initialTimelineBody = await (await initialTimelineResponsePromise).json();

    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByLabel("Timeline events").getByText("Timeline task started")).toBeVisible();
    await expect(page.getByText("OPENAI_API_KEY=[REDACTED]")).toBeVisible();
    await expect(page.getByText("sk-test")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Expand \d+KB output/ })).toBeVisible();

    // Scrubber renders one positioned dot per event plus five axis ticks.
    await expect(page.getByLabel("Timeline scrubber").locator(".timeline-scrubber__axis")).toHaveCount(5);
    expect(await page.getByLabel("Timeline scrubber").locator(".timeline-scrubber__dot").count()).toBeGreaterThan(0);

    // Time window control (handoff COMP/06): four segments, ALL default, header swaps to LAST {N}H.
    const windowGroup = page.getByRole("group", { name: "Time window" });
    await expect(windowGroup.getByRole("button")).toHaveCount(4);
    await expect(windowGroup.getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "true");
    const scrubberHeader = page.locator(".tl-scrubber-wrap .hdr span").first();
    await expect(scrubberHeader).toContainText("TASK_STARTED");
    await windowGroup.getByRole("button", { name: "1H" }).click();
    await expect(windowGroup.getByRole("button", { name: "1H" })).toHaveAttribute("aria-pressed", "true");
    await expect(scrubberHeader).toContainText("LAST 1H");
    await windowGroup.getByRole("button", { name: "ALL" }).click();
    await expect(scrubberHeader).toContainText("TASK_STARTED");

    // The grouped "Tools" filter shows only tool_call rows (results are inlined).
    await page.getByRole("button", { name: /^Tools/ }).click();
    const events = page.getByLabel("Timeline events");
    expect(await events.locator("li").count()).toBeGreaterThan(0);
    await expect(events.locator('li:not([data-kind="tool_call"])')).toHaveCount(0);

    const rolloutPath = initialTimelineBody.data.facts.rolloutPath;
    expect(rolloutPath).toBeTruthy();
    const tailLine = `${JSON.stringify({
      type: "assistant_message",
      timestamp: "2026-05-26T18:01:00.000Z",
      content: "tail appended row",
    })}\n`;
    await appendFile(rolloutPath, tailLine, "utf8");

    await page.getByRole("button", { name: /^All Events/ }).click();
    const tailResponsePromise = page.waitForResponse((response) => response.url().includes("/api/timeline") && response.url().includes("fromByte="));
    await page.getByRole("button", { name: "Tail" }).click();
    const tailResponse = await tailResponsePromise;
    const tailBody = await tailResponse.json();
    expect(tailBody).toMatchObject({
      ok: true,
      data: {
        events: expect.arrayContaining([expect.objectContaining({ previewText: "tail appended row" })]),
      },
    });
    // The manual Tail fetch and the live SSE stream can both deliver the appended
    // bytes, so the row may render more than once; assert at least one is visible.
    await expect(page.getByText("tail appended row").first()).toBeVisible();
  });

  test("surfaces enriched observed rollout facts in event groups and spawn actions", async ({ page }, testInfo) => {
    await writeObservedRolloutFixtures();
    await page.goto(appBaseUrl(testInfo));
    const timelineResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/timeline") && !response.url().includes("fromByte="),
    );
    // Select the user-root row explicitly (its rollout holds the observed fixtures);
    // the default "Active" selection lands on the sub-agent, not the parent.
    await page.getByRole("table", { name: /sessions/i }).getByRole("row", { name: /Parent real sessions work/i }).click();
    const timelineBody = await (await timelineResponsePromise).json();

    expect(timelineBody).toMatchObject({
      ok: true,
      data: {
        facts: {
          summary: {
            turnCount: 1,
            failedToolCallCount: 1,
            tokenSnapshotCount: 1,
            agentLaunchCount: 1,
            agentWaitCount: 1,
          },
          turns: [
            expect.objectContaining({
              turnId: "turn-observed-parent",
              lastAgentMessagePreview: "Observed agent report row: frontend consumed enriched data",
              inputTokenCount: 7200,
              outputTokenCount: 1220,
            }),
          ],
          toolCalls: [
            expect.objectContaining({
              callId: "call-observed-shell",
              commandPreview: "npm run test -- --run observed-ui",
              outputPreview: "observed joined shell output",
              exitCode: 7,
              durationMs: 1234,
              outputTokenCount: 18,
            }),
          ],
          agentLaunches: [
            expect.objectContaining({
              childThreadId: "thread-subagent-implementation",
              nickname: "ui-worker",
              role: "implementation",
              taskPreview: "Consume enriched API fields in the UI",
            }),
          ],
        },
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: "tool_call",
            joinedOutputPreview: "observed joined shell output",
            joinedExitCode: 7,
            joinedDurationMs: 1234,
          }),
          expect.objectContaining({
            kind: "token_snapshot",
            tokenSnapshot: expect.objectContaining({
              lastInput: 111,
              lastOutput: 222,
              modelContextWindow: 128000,
              planType: "pro",
            }),
          }),
        ]),
      },
    });

    const timeline = page.getByLabel("Timeline events");
    // Every design event kind is present (tool results are inlined on their call).
    await expect(timeline.locator('[data-kind="task_started"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="turn_context"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="user_message"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="assistant_message"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="tool_call"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="token_snapshot"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="agent_launch"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="agent_wait"]')).not.toHaveCount(0);

    // Design who-labels and inlined tool output.
    await expect(timeline.getByText("USER", { exact: true })).toBeVisible();
    await expect(timeline.getByText("⊕ SPAWN_AGENT")).toBeVisible();
    await expect.soft(timeline).toContainText("observed joined shell output", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("exit 7", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("1.234s", { timeout: 1_000 });
    // token_count composition row: compact total + cache-hit % + stacked legend.
    await expect.soft(timeline).toContainText("8.4K", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("of input cached", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("Observed agent report row", { timeout: 1_000 });
    await expect
      .soft(page.getByRole("button", { name: /open thread-subagent-implementation in timeline/i }))
      .toBeVisible({ timeout: 1_000 });
  });
});
