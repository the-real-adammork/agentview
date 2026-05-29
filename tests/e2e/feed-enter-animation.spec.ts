import { expect, test } from "@playwright/test";

// Demo mode (?demo) synthesises live inserts against the otherwise-static local
// fixtures, so these tests exercise the real running app the way a user watching
// the dashboard would see new sessions and events stream in.
test.describe("feed-enter live insert animation", () => {
  test("animates newly-inserted session rows", async ({ page }, testInfo) => {
    await page.goto("/?demo=1");
    await expect(page.getByRole("heading", { name: /sessions/i })).toBeVisible();

    // Before any insert, nothing is mid-animation.
    expect(await page.locator("tr.session-row.feed-enter").count()).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("sessions-before.png") });

    // A demo insert prepends a fresh row that carries the feed-enter class.
    const entering = page.locator("tr.session-row.feed-enter").first();
    await expect(entering).toBeVisible({ timeout: 10_000 });
    await expect(entering).toContainText(/Demo session/);
    await page.screenshot({ path: testInfo.outputPath("sessions-after.png") });
  });

  test("animates newly-arrived timeline events", async ({ page }, testInfo) => {
    await page.goto("/?demo=1");
    await page
      .getByRole("navigation", { name: "Primary views" })
      .getByRole("button", { name: "Timeline" })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: /timeline/i })).toBeVisible();

    const enteringEvent = page.locator("li.ev.feed-enter").first();
    await expect(enteringEvent).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: testInfo.outputPath("timeline-after.png") });
  });

  test("disables the animation under prefers-reduced-motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await page.goto("/?demo=1");
      const row = page.locator("tr.session-row.feed-enter").first();
      await expect(row).toBeVisible({ timeout: 10_000 });
      // The reduced-motion guard collapses the animation to ~0ms.
      const duration = await row.evaluate((el) => getComputedStyle(el).animationDuration);
      expect(duration).toBe("0.001s");
    } finally {
      await context.close();
    }
  });
});
