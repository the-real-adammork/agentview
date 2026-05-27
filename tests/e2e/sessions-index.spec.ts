import { expect, test, type Page, type TestInfo } from "@playwright/test";

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

async function sessionRows(page: Page) {
  return page.getByRole("table", { name: /sessions/i }).locator("tbody tr");
}

test.describe("real Sessions index @sessions", () => {
  test("loads real state-db sessions sorted by update time and selects rows for placeholder detail views", async ({
    page,
  }, testInfo) => {
    await page.goto(appBaseUrl(testInfo));

    await expect(page.getByText("AgentView Observatory")).toBeVisible();
    await expect(page.getByLabel(/observatory status/i)).toContainText(/real mode/i);
    await expect(page.getByRole("status", { name: /transport status/i })).toContainText(/source: state-db/i);
    await expect(page.getByRole("status", { name: /transport status/i })).toContainText(/3 sessions/i);

    const rows = await sessionRows(page);
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("UI fixture archived");
    await expect(rows.nth(1)).toContainText("Subagent implementation lane");
    await expect(rows.nth(2)).toContainText("Parent real sessions work");

    await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
    await expect(rows.nth(1)).toContainText("1/2");
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");

    await page.getByRole("button", { name: "Timeline" }).click();
    await expect(page.getByRole("heading", { name: /timeline/i })).toBeVisible();
  });

  test("composes search and filter controls against the sessions API", async ({ page }, testInfo) => {
    await page.goto(appBaseUrl(testInfo));

    await page.getByRole("searchbox", { name: /search sessions/i }).fill("implementation");
    await page.getByRole("combobox", { name: /source/i }).selectOption("subagent");
    await page.getByRole("combobox", { name: /role/i }).selectOption("implementation");
    await page.getByRole("combobox", { name: /model/i }).selectOption("gpt-5-codex");
    await page.getByRole("combobox", { name: /archived/i }).selectOption("exclude");
    await page.getByRole("spinbutton", { name: /minimum tokens/i }).fill("10000");

    const rows = await sessionRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Subagent implementation lane");
    await expect(rows.first()).toContainText("gpt-5-codex");
  });

  test("shows an API error state when the sessions endpoint is unavailable", async ({ page }, testInfo) => {
    await page.route("**/api/sessions**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          source: "state-db",
          warnings: [],
          error: { code: "STATE_DB_MISSING", message: "state_5.sqlite missing" },
        }),
      });
    });

    await page.goto(appBaseUrl(testInfo));

    await expect(page.getByRole("alert")).toContainText(/state_5.sqlite missing/i);
  });
});
