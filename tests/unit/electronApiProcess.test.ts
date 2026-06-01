// @vitest-environment node

import { EventEmitter } from "node:events";
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultAgentViewApiChildPath, startAgentViewApiProcess } from "../../src/electron/apiProcess";

class FakeChildProcess extends EventEmitter {
  killed = false;
  stdout = new EventEmitter();
  stderr = new EventEmitter();

  kill() {
    this.killed = true;
    this.emit("exit", 0);
  }
}

describe("startAgentViewApiProcess", () => {
  it("points at the Vite-built API child entry", () => {
    expect(basename(defaultAgentViewApiChildPath())).toBe("apiChild.cjs");
  });

  it("resolves when the child reports the runtime API URL and kills the child on close", async () => {
    const child = new FakeChildProcess();
    const started = startAgentViewApiProcess({
      entryPath: "/tmp/api-child.cjs",
      forkProcess: (entryPath) => {
        expect(entryPath).toBe("/tmp/api-child.cjs");
        return child;
      },
    });

    child.emit("message", {
      type: "agentview-api-ready",
      baseUrl: "http://127.0.0.1:61234",
    });

    const api = await started;
    expect(api.baseUrl).toBe("http://127.0.0.1:61234");

    api.close();
    expect(child.killed).toBe(true);
  });
});
