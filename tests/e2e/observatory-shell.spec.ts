import { expect, test, type Page, type TestInfo } from "@playwright/test";

const primaryViews = ["Sessions", "Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

function assertLocalHttpUrl(rawUrl: string, label: string) {
  const url = new URL(rawUrl);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

  expect(url.protocol, `${label} must use http or https`).toMatch(/^https?:$/);
  expect(localHosts.has(url.hostname), `${label} must resolve to loopback`).toBe(true);

  return url.origin;
}

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;

  expect(
    configuredBaseUrl,
    "Playwright config must provide use.baseURL so npm run e2e starts the Vite app",
  ).toBeTruthy();

  return assertLocalHttpUrl(String(configuredBaseUrl), "Playwright baseURL");
}

function apiBaseUrl() {
  const configuredApiUrl = process.env.AGENTVIEW_API_BASE_URL ?? "http://127.0.0.1:4317";

  return assertLocalHttpUrl(configuredApiUrl, "AGENTVIEW_API_BASE_URL");
}

function installNonLocalRequestGuard(page: Page) {
  const unexpectedRequests: string[] = [];
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

  page.on("request", (request) => {
    const requestUrl = request.url();

    if (!requestUrl.startsWith("http://") && !requestUrl.startsWith("https://")) {
      return;
    }

    const url = new URL(requestUrl);

    if (!localHosts.has(url.hostname)) {
      unexpectedRequests.push(requestUrl);
    }
  });

  return unexpectedRequests;
}

test.describe("observatory local fixture shell", () => {
  test("restricts fixture API CORS to loopback browser origins", async ({ request }) => {
    const apiUrl = apiBaseUrl();

    const noOriginResponse = await request.get(`${apiUrl}/api/health`);
    expect(noOriginResponse.status()).toBe(200);
    expect(noOriginResponse.headers()["access-control-allow-origin"]).toBeUndefined();

    for (const origin of ["http://127.0.0.1:4173", "http://localhost:4173", "http://[::1]:4173"]) {
      const response = await request.get(`${apiUrl}/api/health`, {
        headers: { Origin: origin },
      });

      expect(response.status()).toBe(200);
      expect(response.headers()["access-control-allow-origin"]).toBe(origin);

      const optionsResponse = await request.fetch(`${apiUrl}/api/health`, {
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
        },
        method: "OPTIONS",
      });

      expect(optionsResponse.status()).toBe(204);
      expect(optionsResponse.headers()["access-control-allow-origin"]).toBe(origin);
      expect(optionsResponse.headers()["access-control-allow-methods"]).toContain("GET");
    }

    for (const origin of ["https://example.com", "http://192.168.0.10:4173"]) {
      const response = await request.get(`${apiUrl}/api/health`, {
        headers: { Origin: origin },
      });

      expect(response.status()).toBe(200);
      expect(response.headers()["access-control-allow-origin"]).toBeUndefined();

      const optionsResponse = await request.fetch(`${apiUrl}/api/health`, {
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
        },
        method: "OPTIONS",
      });

      expect(optionsResponse.status()).toBe(204);
      expect(optionsResponse.headers()["access-control-allow-origin"]).toBeUndefined();
    }
  });

  test("boots from local API fixtures, visits every primary view, and blocks external runtime requests", async ({
    page,
  }, testInfo) => {
    const baseUrl = appBaseUrl(testInfo);
    const apiUrl = apiBaseUrl();
    const unexpectedRequests = installNonLocalRequestGuard(page);

    await page.goto(baseUrl);

    const health = await page.evaluate(async (base) => {
      const response = await fetch(`${base}/api/health`);
      return {
        ok: response.ok,
        status: response.status,
        body: await response.json(),
      };
    }, apiUrl);

    expect(health.ok, "browser runtime should reach the local API health route").toBe(true);
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      ok: true,
      data: {
        status: "ok",
        mode: "fixture",
      },
      source: "fixture",
    });

    await expect(page.getByText("AgentView Observatory")).toBeVisible();

    for (const viewName of primaryViews) {
      await page
        .getByRole("button", { name: viewName })
        .or(page.getByRole("link", { name: viewName }))
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: new RegExp(viewName, "i") }),
        `${viewName} view should render after primary navigation`,
      ).toBeVisible();
    }

    expect(unexpectedRequests, "runtime must not request non-local URLs").toEqual([]);
  });
});
