// @vitest-environment node

import { describe, expect, it } from "vitest";

import viteConfig from "../../vite.config";

describe("vite renderer config", () => {
  it("builds relative asset URLs for packaged Electron file loading", () => {
    expect(viteConfig.base).toBe("./");
  });
});
