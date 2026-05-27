import { expect, test, type TestInfo } from "@playwright/test";

import { writeObservedRolloutFixtures } from "./observedSourceFixture";

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

test.describe("real Graph and Tokens views @graph-tokens", () => {
  test("renders graph and token service wiring with Timeline navigation", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await writeObservedRolloutFixtures();
    await page.goto(appBaseUrl(testInfo));

    await page.getByRole("row", { name: /Parent real sessions work/i }).click();

    const graphResponsePromise = page.waitForResponse((response) => response.url().includes("/api/agent-graph"));
    await page.getByRole("button", { name: "Agent Graph" }).click();
    const graphResponse = await graphResponsePromise;
    expect(graphResponse.status()).toBe(200);
    const graphBody = await graphResponse.json();
    expect(graphBody).toMatchObject({
      ok: true,
      data: {
        truncatedDepth: true,
        openCount: 1,
        nodes: expect.arrayContaining([
          expect.objectContaining({
            id: "thread-subagent-implementation",
            sourceEdgeStatus: "open",
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
            nickname: "ui-worker",
            role: "implementation",
          }),
        ]),
      },
    });

    await expect(page.getByRole("heading", { name: "Agent Graph" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Subagent implementation lane/i })).toBeVisible();
    await expect(page.getByText(/depth limit reached/i)).toBeVisible();
    await expect.soft(page.getByText(/open child/i)).toBeVisible();

    await page.getByRole("spinbutton", { name: /graph depth/i }).fill("2");
    const depthTwoResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/agent-graph") && response.url().includes("maxDepth=2"),
    );
    await page.getByRole("button", { name: "Refresh graph" }).click();
    await depthTwoResponsePromise;

    await expect(page.getByRole("button", { name: /UI fixture archived/i })).toBeVisible();
    await page.getByRole("button", { name: /Subagent implementation lane/i }).click();
    const inspector = page.getByLabel("Selected graph node");
    await expect(inspector).toContainText("Subagent implementation lane");
    await expect(inspector).toContainText("ui-worker");
    await expect(inspector).toContainText("implementation");
    await expect.soft(inspector).toContainText("open", { timeout: 1_000 });
    await expect.soft(inspector).toContainText("Created", { timeout: 1_000 });
    await expect.soft(inspector).toContainText("Updated", { timeout: 1_000 });
    await expect.soft(inspector).toContainText("thread-subagent-implementation", { timeout: 1_000 });

    await inspector.getByRole("button", { name: /open selected in timeline/i }).click();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByText(/Implementation prompt/i).or(page.getByText(/Timeline task started/i))).toBeVisible();

    const tokensResponsePromise = page.waitForResponse((response) => response.url().includes("/api/tokens"));
    await page.getByRole("button", { name: "Tokens" }).click();
    const tokensResponse = await tokensResponsePromise;
    expect(tokensResponse.status()).toBe(200);
    const tokensBody = await tokensResponse.json();
    expect(tokensBody).toMatchObject({
      ok: true,
      data: {
        totals: {
          input: 0,
          cachedInput: 50,
          output: 200,
          total: 200,
        },
        rateLimitPrimaryPercent: 64,
        rateLimitSecondaryPercent: 12,
        resetAt: "2026-05-26T19:30:00.000Z",
        emptyStateReasons: expect.arrayContaining(["cached-input-ratio-unavailable"]),
        snapshots: [
          expect.objectContaining({
            lastInput: 17,
            lastOutput: 29,
            modelContextWindow: 128000,
            planType: "pro",
          }),
        ],
      },
    });

    await expect(page.getByRole("heading", { name: "Tokens" })).toBeVisible();
    await expect(page.getByLabel(/cached input ratio/i)).toBeVisible();
    await expect(page.getByRole("meter", { name: /primary rate limit/i })).toBeVisible();
    await expect(page.getByText(/cached-input-ratio-unavailable/i)).toBeVisible();
    await expect.soft(page.getByText(/last input/i)).toContainText("17", { timeout: 1_000 });
    await expect.soft(page.getByText(/last output/i)).toContainText("29", { timeout: 1_000 });
    await expect.soft(page.getByText(/context window/i)).toContainText("128,000", { timeout: 1_000 });
    await expect.soft(page.getByText(/plan type/i)).toContainText("pro", { timeout: 1_000 });
    await expect.soft(page.getByText(/primary rate limit/i)).toContainText("64", { timeout: 1_000 });
    await expect.soft(page.getByText(/secondary rate limit/i)).toContainText("12", { timeout: 1_000 });
    await expect.soft(page.getByText(/reset/i)).toContainText("7:30", { timeout: 1_000 });
    await expect(page.getByRole("table", { name: /top token sessions/i })).toContainText("Parent real sessions work");

    await page.getByRole("button", { name: /open parent real sessions work/i }).click();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  });
});
