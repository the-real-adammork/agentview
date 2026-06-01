import { afterEach, describe, expect, it } from "vitest";

import { startAgentViewApi, type RunningAgentViewApi } from "../../src/backend/server";

const runningApis: RunningAgentViewApi[] = [];

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.close()));
});

describe("startAgentViewApi", () => {
  it("starts the HTTP API on an OS-assigned loopback port", async () => {
    const api = await startAgentViewApi({ port: 0, warmStores: false });
    runningApis.push(api);

    expect(api.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(api.port).toBeGreaterThan(0);

    const response = await fetch(`${api.baseUrl}/api/health`);
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(600);
  });
});
