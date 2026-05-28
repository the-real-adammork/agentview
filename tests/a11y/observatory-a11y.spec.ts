import { expect, test, type Page, type TestInfo } from "@playwright/test";

const primaryViews = ["Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

async function expectFocusVisible(page: Page, buttonName: string) {
  const button = page.getByRole("button", { name: buttonName });
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).not.toHaveCSS("box-shadow", "none");
}

test.describe("Observatory accessibility @a11y", () => {
  test("keeps primary navigation, headings, tables, focus, and reduced-motion controls accessible", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(appBaseUrl(testInfo));

    await expect(page.getByRole("banner", { name: /observatory status/i })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /primary views/i })).toBeVisible();
    await expect(page.getByRole("main", { name: /observatory workspace/i })).toBeVisible();
    const primaryNav = page.getByRole("navigation", { name: /primary views/i });

    for (const viewName of primaryViews) {
      await primaryNav.getByRole("button", { name: viewName, exact: true }).click();
      await expect(primaryNav.getByRole("button", { name: viewName, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(page.getByRole("heading", { name: new RegExp(viewName, "i") }).first()).toBeVisible();
    }

    // Sessions is merged into the header session square (not a primary tab).
    await page.locator(".session-sq").click();
    await expect(page.getByRole("table", { name: /sessions/i }).getByRole("columnheader", { name: "Session" })).toBeVisible();
    await expect(page.getByRole("row", { name: /ui-worker/i })).toHaveAttribute("tabindex", "0");
    await expectFocusVisible(page, "Timeline");
  });
});
