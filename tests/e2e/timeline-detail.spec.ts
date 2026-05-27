import { appendFile } from "node:fs/promises";
import { expect, test, type TestInfo } from "@playwright/test";

import { writeLegacyE2eRolloutFixtures, writeObservedRolloutFixtures } from "./observedSourceFixture";

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

test.describe("real Timeline detail @timeline", () => {
  test("renders parsed rollout rows, redacted previews, collapsed output, scrubber ticks, filters, and tail updates", async ({
    page,
    }, testInfo) => {
    await writeLegacyE2eRolloutFixtures();
    await page.goto(appBaseUrl(testInfo));
    const initialTimelineResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/timeline") && !response.url().includes("fromByte="),
    );
    await page.getByRole("button", { name: "Timeline" }).click();
    const initialTimelineBody = await (await initialTimelineResponsePromise).json();

    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByLabel("Timeline events").getByText("Timeline task started")).toBeVisible();
    await expect(page.getByText("OPENAI_API_KEY=[REDACTED]")).toBeVisible();
    await expect(page.getByText("sk-test")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Expand \d+KB output/ })).toBeVisible();
    await expect(page.getByLabel("Timeline scrubber").locator("a")).toHaveCount(32);

    await page.getByRole("button", { name: "tool result" }).click();
    await expect(page.getByLabel("Timeline events").locator("li")).toHaveCount(1);

    const rolloutPath = initialTimelineBody.data.facts.rolloutPath;
    expect(rolloutPath).toBeTruthy();
    const tailLine = `${JSON.stringify({
      type: "assistant_message",
      timestamp: "2026-05-26T18:01:00.000Z",
      content: "tail appended row",
    })}\n`;
    await appendFile(rolloutPath, tailLine, "utf8");

    await page.getByRole("button", { name: "all", exact: true }).click();
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
    await expect(page.getByText("tail appended row")).toBeVisible();
  });

  test("surfaces enriched observed rollout facts in event groups and spawn actions", async ({ page }, testInfo) => {
    await writeObservedRolloutFixtures();
    await page.goto(appBaseUrl(testInfo));
    const timelineResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/timeline") && !response.url().includes("fromByte="),
    );
    await page.getByRole("button", { name: "Timeline" }).click();
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
    await expect(timeline).toContainText("task started");
    await expect(timeline).toContainText("turn context");
    await expect(timeline).toContainText("user message");
    await expect(timeline).toContainText("assistant message");
    await expect(timeline).toContainText("tool call");
    await expect(timeline).toContainText("tool result");
    await expect(timeline).toContainText("token snapshot");
    await expect(timeline).toContainText("agent launch");
    await expect(timeline).toContainText("agent wait");

    await expect.soft(timeline).toContainText("observed joined shell output", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("exit 7", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("1.234s", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("last input 111", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("last output 222", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("128,000 context", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("Observed agent report row", { timeout: 1_000 });
    await expect
      .soft(page.getByRole("button", { name: /open thread-subagent-implementation in timeline/i }))
      .toBeVisible({ timeout: 1_000 });
  });
});
