// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Electron toolbar chrome", () => {
  it("uses hidden-inset titlebar chrome and draggable app toolbar regions", async () => {
    const [mainSource, cssSource] = await Promise.all([
      readFile("src/electron/main.ts", "utf8"),
      readFile("src/frontend/styles/kits/agentview.css", "utf8"),
    ]);

    expect(mainSource).toContain('titleBarStyle: "hiddenInset"');
    expect(cssSource).toContain("-webkit-app-region: drag");
    expect(cssSource).toContain("-webkit-app-region: no-drag");
  });

  it("blocks Cmd/Ctrl+R from reloading the Electron renderer", async () => {
    const mainSource = await readFile("src/electron/main.ts", "utf8");

    expect(mainSource).toContain('webContents.on("before-input-event"');
    expect(mainSource).toContain("event.preventDefault()");
    expect(mainSource).toContain("input.key.toLowerCase() === \"r\"");
    expect(mainSource).toContain("(input.meta || input.control)");
  });
});
