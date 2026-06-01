// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Electron toolbar chrome", () => {
  it("uses hidden-inset titlebar chrome and draggable app toolbar regions", async () => {
    const [mainSource, cssSource] = await Promise.all([
      readFile("src/electron/main.ts", "utf8"),
      readFile("src/frontend/styles/app.css", "utf8"),
    ]);

    expect(mainSource).toContain('titleBarStyle: "hiddenInset"');
    expect(cssSource).toContain("-webkit-app-region: drag");
    expect(cssSource).toContain("-webkit-app-region: no-drag");
  });
});
