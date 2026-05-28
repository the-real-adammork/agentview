import { expect, test, type Page, type TestInfo } from "@playwright/test";

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

async function sessionRows(page: Page) {
  return page.getByRole("table", { name: /sessions/i }).locator("tbody tr");
}

function sessionResult(index: number, cwd = "/repo/agentview") {
  return {
    id: `thread-layout-${String(index).padStart(3, "0")}`,
    title: `Layout stress session ${index}`,
    status: "complete",
    updatedAt: new Date(Date.UTC(2026, 4, 27, 18, index % 60, 0)).toISOString(),
    branch: "main",
    cwd,
    repoLabel: cwd.split("/").filter(Boolean).at(-1),
    model: "gpt-5-codex",
    lastMessage: `Layout row ${index}`,
    childCount: 0,
    openChildCount: 0,
    tokenTotal: 10_000 + index,
    tokensUsed: 10_000 + index,
    threadSource: "user",
    archived: false,
  };
}

test.describe("real Sessions index @sessions", () => {
  test("loads real state-db sessions sorted by update time and selects rows for placeholder detail views", async ({
    page,
  }, testInfo) => {
    await page.goto(appBaseUrl(testInfo));

    await expect(page.getByRole("button", { name: /repos/i })).toBeVisible();
    await expect(page.getByLabel(/observatory status/i)).toContainText(/real mode/i);
    await expect(page.getByRole("status", { name: /transport status/i })).toContainText(/source: state-db/i);
    await expect(page.getByRole("status", { name: /transport status/i })).toContainText(/sessions:\s*3/i);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          await document.fonts.ready;
          return {
            displayLoaded: document.fonts.check('700 24px "Big Shoulders Display"'),
            titleFont: window.getComputedStyle(document.getElementById("sessions-title")!).fontFamily,
          };
        }),
      )
      .toMatchObject({
        displayLoaded: true,
        titleFont: expect.stringContaining("Big Shoulders Display"),
      });

    const rows = await sessionRows(page);
    await expect(rows).toHaveCount(3);
    // Tree-grouped order: the user root leads, its sub-agents nest beneath it
    // (newest descendant first), rather than a flat updated_at sort.
    await expect(rows.nth(0)).toContainText("Parent real sessions work");
    await expect(rows.nth(1)).toContainText("UI fixture archived");
    await expect(rows.nth(2)).toContainText("Subagent implementation lane");
    await expect(rows.nth(0)).toHaveAttribute("data-depth", "0");
    await expect(rows.nth(1)).toHaveAttribute("data-depth", "1");
    await expect(rows.nth(2)).toHaveAttribute("data-depth", "1");
    // Each row still shows its own repo label (not the full cwd).
    await expect(rows.nth(1)).toContainText("agentview-fixture");
    await expect(rows.nth(1)).not.toContainText("/repo/agentview-fixture");
    await expect(rows.nth(0)).toContainText("agentview");
    await expect(rows.nth(0)).not.toContainText("/repo/agentview");

    // archived-ui is the most recently updated row, so it is the default selection.
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(rows.nth(2)).toContainText("1/2");

    // Clicking a row selects that session and navigates to its Timeline (handoff COMP/01).
    await rows.nth(2).click();
    await expect(page.getByRole("heading", { name: /timeline/i })).toBeVisible();

    // Returning to the index (via the header session square) shows the clicked session active.
    await page.locator(".session-sq").click();
    await expect((await sessionRows(page)).nth(2)).toHaveAttribute("aria-current", "true");
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

  test("filters repository quick filters by repo name instead of full cwd", async ({ page }, testInfo) => {
    const sessionRequestUrls: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/sessions") {
        sessionRequestUrls.push(url.href);
      }
    });

    await page.goto(appBaseUrl(testInfo));

    await page.getByRole("button", { name: /^agentview$/i }).click();

    const rows = await sessionRows(page);
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole("table", { name: /sessions/i })).toContainText("Subagent implementation lane");
    await expect(page.getByRole("table", { name: /sessions/i })).toContainText("Parent real sessions work");
    await expect(page.getByRole("table", { name: /sessions/i })).not.toContainText("UI fixture archived");
    await expect(page.getByRole("table", { name: /sessions/i })).not.toContainText("/repo/agentview");
    expect(
      sessionRequestUrls.some((requestUrl) => new URL(requestUrl).searchParams.get("repo") === "agentview"),
    ).toBe(true);
    expect(
      sessionRequestUrls.some((requestUrl) => new URL(requestUrl).searchParams.get("cwd") !== null),
    ).toBe(false);
  });

  test("keeps the catalog table as the scroll target above the fixed status banner", async ({ page }, testInfo) => {
    await page.route("**/api/sessions**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          source: "state-db",
          warnings: [],
          data: Array.from({ length: 60 }, (_, index) => sessionResult(index)),
        }),
      });
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(appBaseUrl(testInfo));
    await expect(await sessionRows(page)).toHaveCount(60);

    const metrics = await page.evaluate(() => {
      const tableFrame = document.querySelector<HTMLElement>(".ov-table");
      const status = document.querySelector<HTMLElement>(".status");
      if (!tableFrame || !status) {
        throw new Error("Missing table frame or status banner.");
      }

      return {
        documentScrollHeight: document.documentElement.scrollHeight,
        statusBottom: status.getBoundingClientRect().bottom,
        statusTop: status.getBoundingClientRect().top,
        tableBottom: tableFrame.getBoundingClientRect().bottom,
        tableClientHeight: tableFrame.clientHeight,
        tableScrollHeight: tableFrame.scrollHeight,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics.documentScrollHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.tableScrollHeight).toBeGreaterThan(metrics.tableClientHeight);
    expect(metrics.tableBottom).toBeLessThanOrEqual(metrics.statusTop + 1);
    expect(metrics.statusBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
  });

  test("lets the main workspace use full width on large screens", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto(appBaseUrl(testInfo));

    const metrics = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>(".app-shell__main");
      if (!main) {
        throw new Error("Missing main workspace.");
      }

      return {
        mainWidth: Math.round(main.getBoundingClientRect().width),
        viewportWidth: window.innerWidth,
      };
    });

    expect(metrics.mainWidth).toBe(metrics.viewportWidth);
  });

  test("uses side-only selected row rails without a heavy top and bottom outline", async ({ page }, testInfo) => {
    await page.goto(appBaseUrl(testInfo));

    // The first session is active on load; inspect its rails without clicking
    // (a row click now navigates to the Timeline per handoff COMP/01).
    const activeRow = page.getByRole("table", { name: /sessions/i }).locator('tbody tr[data-active="true"]').first();
    await expect(activeRow).toBeVisible();
    const styles = await activeRow.evaluate((row) => {
      const trStyle = window.getComputedStyle(row);

      return {
        rowBoxShadow: trStyle.boxShadow,
        outlineStyle: trStyle.outlineStyle,
        outlineWidth: trStyle.outlineWidth,
      };
    });

    expect(styles.outlineStyle).toBe("solid");
    expect(styles.outlineWidth).toBe("1px");
    expect(["", "none"]).toContain(styles.rowBoxShadow);
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
