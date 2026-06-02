// @vitest-environment node

import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("renderer stylesheet wiring", () => {
  it("imports app CSS through the Vite entry so nested imports are bundled", async () => {
    const [mainSource, appSource, stylesheetSource] = await Promise.all([
      readFile("src/frontend/main.tsx", "utf8"),
      readFile("src/frontend/App.tsx", "utf8"),
      readFile("src/frontend/styles/app.css", "utf8"),
    ]);

    expect(mainSource).toContain('import "./styles/app.css";');
    expect(appSource).not.toContain('new URL("./styles/app.css", import.meta.url)');
    expect(stylesheetSource).toContain('@import "./tokens.css";');
    expect(stylesheetSource).toContain('@import "./kits/agentview.css";');
  });
});
