import { describe, expect, it } from "vitest";

import { resolveApiBaseUrl } from "../../src/frontend/api/baseUrl";

describe("resolveApiBaseUrl", () => {
  it("prefers the Electron runtime API URL and trims trailing slashes", () => {
    expect(
      resolveApiBaseUrl({
        runtimeApiBaseUrl: "http://127.0.0.1:61234/",
        envApiBaseUrl: "http://127.0.0.1:4317",
      }),
    ).toBe("http://127.0.0.1:61234");
  });

  it("falls back to Vite env and then the default loopback URL", () => {
    expect(resolveApiBaseUrl({ envApiBaseUrl: "http://127.0.0.1:5000/" })).toBe("http://127.0.0.1:5000");
    expect(resolveApiBaseUrl({})).toBe("http://127.0.0.1:4317");
  });
});
