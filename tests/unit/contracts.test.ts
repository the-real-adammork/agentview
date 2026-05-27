import { describe, expect, it } from "vitest";

import type { ApiResult, ObservatoryApi, SessionSummary } from "../../src/shared/contracts";

describe("observatory shared contracts", () => {
  it("defines a typed API envelope and health/session surface", () => {
    const session: SessionSummary = {
      id: "session-1",
      title: "Fixture session",
      status: "running",
      updatedAt: "2026-05-26T12:00:00.000Z",
      branch: "impl/phase-1-fixture-shell",
      cwd: "/tmp/agentview",
      model: "gpt-5",
      lastMessage: "Bootstrapping",
      childCount: 0,
      openChildCount: 0,
      tokenTotal: 128,
    };

    const result: ApiResult<SessionSummary[]> = {
      ok: true,
      data: [session],
      source: "fixture",
      warnings: [],
    };

    const api: Pick<ObservatoryApi, "getHealth"> = {
      getHealth: async () => ({
        ok: true,
        data: {
          status: "ok",
          mode: "fixture",
          checkedAt: "2026-05-26T12:00:01.000Z",
        },
        source: "fixture",
        warnings: [],
      }),
    };

    expect(result.data[0]?.id).toBe("session-1");
    expect(api.getHealth).toBeTypeOf("function");
  });
});
