import { expect, test, type TestInfo } from "@playwright/test";

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

test.describe("real Graph and Tokens views @graph-tokens", () => {
  test("renders graph and token service wiring with Timeline navigation", async ({ page }, testInfo) => {
    await page.goto(appBaseUrl(testInfo));

    await page.getByRole("row", { name: /Parent real sessions work/i }).click();

    const graphResponsePromise = page.waitForResponse((response) => response.url().includes("/api/agent-graph"));
    await page.getByRole("button", { name: "Agent Graph" }).click();
    const graphResponse = await graphResponsePromise;
    expect(graphResponse.status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Agent Graph" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Subagent implementation lane/i })).toBeVisible();
    await expect(page.getByText(/depth limit reached/i)).toBeVisible();

    await page.getByRole("spinbutton", { name: /graph depth/i }).fill("2");
    const depthTwoResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/agent-graph") && response.url().includes("maxDepth=2"),
    );
    await page.getByRole("button", { name: "Refresh graph" }).click();
    await depthTwoResponsePromise;

    await expect(page.getByRole("button", { name: /UI fixture archived/i })).toBeVisible();
    await page.getByRole("button", { name: /Subagent implementation lane/i }).dblclick();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByText(/Implementation prompt/i).or(page.getByText(/Timeline task started/i))).toBeVisible();

    const tokensResponsePromise = page.waitForResponse((response) => response.url().includes("/api/tokens"));
    await page.getByRole("button", { name: "Tokens" }).click();
    const tokensResponse = await tokensResponsePromise;
    expect(tokensResponse.status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Tokens" })).toBeVisible();
    await expect(page.getByLabel(/cached input ratio/i)).toBeVisible();
    await expect(page.getByRole("meter", { name: /primary rate limit/i })).toBeVisible();
    await expect(page.getByText(/cached-input-ratio-unavailable/i)).toBeVisible();
    await expect(page.getByRole("table", { name: /top token sessions/i })).toContainText("Parent real sessions work");

    await page.getByRole("button", { name: /open parent real sessions work/i }).click();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  });
});
