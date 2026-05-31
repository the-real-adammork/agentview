import { describe, expect, it } from "vitest";

import { parseSourceId } from "../../src/backend/sources/sourceQuery";

const urlFor = (query: string) => new URL(`http://127.0.0.1/api/sessions${query}`);

describe("parseSourceId", () => {
  it("defaults to codex when sourceId is absent", () => {
    expect(parseSourceId(urlFor(""))).toEqual({ ok: true, source: "codex" });
  });

  it("accepts sourceId=codex", () => {
    expect(parseSourceId(urlFor("?sourceId=codex"))).toEqual({ ok: true, source: "codex" });
  });

  it("accepts sourceId=claude-code as a valid SourceId (registry decides registration)", () => {
    expect(parseSourceId(urlFor("?sourceId=claude-code"))).toEqual({ ok: true, source: "claude-code" });
  });

  it("treats an empty sourceId as absent and defaults to codex", () => {
    expect(parseSourceId(urlFor("?sourceId="))).toEqual({ ok: true, source: "codex" });
  });

  it("rejects an unknown sourceId with a typed message naming the value", () => {
    const result = parseSourceId(urlFor("?sourceId=bogus"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.message).toContain("bogus");
  });
});
