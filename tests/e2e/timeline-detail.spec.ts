import { appendFile } from "node:fs/promises";
import { expect, test, type TestInfo } from "@playwright/test";

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

test.describe("real Timeline detail @timeline", () => {
  test("renders parsed rollout rows, redacted previews, collapsed output, scrubber ticks, filters, and tail updates", async ({
    page,
    }, testInfo) => {
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
});
