import { expect, test, type Page, type TestInfo } from "@playwright/test";

const primaryViews = ["Sessions", "Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

function installExternalRequestGuard(page: Page) {
  const unexpectedRequests: string[] = [];
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

  page.on("request", (request) => {
    const rawUrl = request.url();
    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) return;

    const url = new URL(rawUrl);
    if (!localHosts.has(url.hostname)) {
      unexpectedRequests.push(rawUrl);
    }
  });

  return unexpectedRequests;
}

test.describe("Diagnostics hardening @hardening", () => {
  test("keeps all views local-only and renders partial source errors instead of blank views", async ({ page }, testInfo) => {
    const unexpectedRequests = installExternalRequestGuard(page);

    await page.route("**/api/timeline**", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          source: "rollout-cache",
          warnings: [],
          error: { code: "ROLLOUT_NOT_FOUND", message: "missing rollout fixture" },
        }),
      });
    });

    await page.goto(appBaseUrl(testInfo));
    const primaryNav = page.getByRole("navigation", { name: /primary views/i });

    for (const viewName of primaryViews) {
      await primaryNav.getByRole("button", { name: viewName, exact: true }).click();
      await expect(page.getByRole("heading", { name: new RegExp(viewName, "i") }).first()).toBeVisible();
    }

    await primaryNav.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("missing rollout fixture");
    await expect(page.getByRole("main", { name: /observatory workspace/i })).toBeVisible();
    expect(unexpectedRequests).toEqual([]);
  });
});
