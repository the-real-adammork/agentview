import { describe, expect, it } from "vitest";

import { statusDotTone } from "../../src/frontend/components/execRenderers";

describe("statusDotTone — docker STATUS health dot", () => {
  it("greens a healthy/running container", () => {
    expect(statusDotTone("Up About an hour (healthy)")).toBe("ok");
    expect(statusDotTone("Up 12 minutes")).toBe("ok");
    expect(statusDotTone("running")).toBe("ok");
  });

  it("reds an exited/restarting/unhealthy container", () => {
    expect(statusDotTone("Exited (0) 8 minutes ago")).toBe("warn");
    expect(statusDotTone("Restarting (1) 3 seconds ago")).toBe("warn");
    expect(statusDotTone("Up 2 minutes (unhealthy)")).toBe("warn");
  });

  it("dims a status it can't classify", () => {
    expect(statusDotTone("")).toBe("dim");
    expect(statusDotTone("Paused-ish thing")).toBe("warn"); // 'paused' is a warn keyword
    expect(statusDotTone("whatever")).toBe("dim");
  });
});
