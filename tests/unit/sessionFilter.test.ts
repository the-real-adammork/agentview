import { describe, expect, it } from "vitest";

import { buildSessionQuery } from "../../src/frontend/api/client";
import type { SessionFilter } from "../../src/shared/contracts";

describe("session filter query serialization", () => {
  it("serializes composed filters into the API query contract", () => {
    const filter: SessionFilter = {
      search: "backend state",
      cwd: "/repo/agentview",
      archived: "exclude",
      threadSource: "subagent",
      agentRole: "implementation",
      model: "gpt-5-codex",
      minTokens: 10_000,
      maxTokens: 100_000,
      warningCountStatus: "not_requested",
      failedToolCountStatus: "unknown",
      updatedAfterMs: 1_000,
      updatedBeforeMs: 5_000,
      createdAfterMs: 500,
      createdBeforeMs: 4_500,
    };

    expect(buildSessionQuery(filter, { limit: 25, offset: 50 })).toBe(
      "?search=backend+state&cwd=%2Frepo%2Fagentview&archived=exclude&source=subagent&role=implementation&model=gpt-5-codex&minTokens=10000&maxTokens=100000&warningStatus=not_requested&failedToolStatus=unknown&updatedAfterMs=1000&updatedBeforeMs=5000&createdAfterMs=500&createdBeforeMs=4500&limit=25&offset=50",
    );
  });

  it("serializes the repo filter as its own query param", () => {
    expect(buildSessionQuery({ repo: "agentview", archived: "include" })).toBe("?repo=agentview&archived=include");
  });

  it("serializes relationship loading options separately from filters", () => {
    expect(
      buildSessionQuery(
        { archived: "exclude", threadSource: "user", updatedAfterMs: 1_000 },
        { limit: 250, offset: 0 },
        { relationships: "none" },
      ),
    ).toBe("?archived=exclude&source=user&updatedAfterMs=1000&limit=250&offset=0&relationships=none");
  });

  it("omits empty strings and undefined values", () => {
    expect(
      buildSessionQuery(
        {
          search: "  ",
          cwd: "",
          archived: "include",
        },
        {},
      ),
    ).toBe("?archived=include");
  });
});
