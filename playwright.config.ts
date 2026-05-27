import { defineConfig, devices } from "@playwright/test";

const appPort = Number.parseInt(process.env.AGENTVIEW_APP_PORT ?? "4173", 10);
const apiPort = Number.parseInt(process.env.AGENTVIEW_API_PORT ?? "4317", 10);

const appBaseUrl = `http://127.0.0.1:${appPort}`;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

process.env.AGENTVIEW_API_BASE_URL = apiBaseUrl;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: appBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `AGENTVIEW_API_PORT=${apiPort} npm run api`,
      url: `${apiBaseUrl}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --port ${appPort} --strictPort`,
      url: appBaseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
