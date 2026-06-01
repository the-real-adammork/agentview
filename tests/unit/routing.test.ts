import { describe, expect, it } from "vitest";

import { buildPath, parseLocation, type RouteState } from "../../src/frontend/routing";

const parse = (url: string) => {
  const [pathname, search = ""] = url.split("?");
  return parseLocation({ pathname, search: search ? `?${search}` : "" });
};

describe("routing — parseLocation", () => {
  it("maps `/` to the all-repos Sessions list", () => {
    expect(parse("/")).toEqual({
      view: "Sessions",
      repo: null,
      sessionId: null,
      search: "",
      archived: undefined,
      scope: "this",
      kind: "all",
    });
  });

  it("maps `/repos` to the Repos browser", () => {
    expect(parse("/repos").view).toBe("Repos");
  });

  it("maps `/repo/:repo` to a repo-scoped Sessions list (decoding the name)", () => {
    const state = parse("/repo/meridian-peak6");
    expect(state.view).toBe("Sessions");
    expect(state.repo).toBe("meridian-peak6");
    expect(state.sessionId).toBeNull();
  });

  it("decodes encoded repo names", () => {
    expect(parse("/repo/casual%2Fcontacts").repo).toBe("casual/contacts");
  });

  it("maps `/session/:id` to that session's Timeline", () => {
    const state = parse("/session/019e7486-ac68");
    expect(state.view).toBe("Timeline");
    expect(state.sessionId).toBe("019e7486-ac68");
  });

  it("maps each session view slug to its view", () => {
    expect(parse("/session/x/timeline").view).toBe("Timeline");
    expect(parse("/session/x/graph").view).toBe("Agent Graph");
    expect(parse("/session/x/tokens").view).toBe("Tokens");
    expect(parse("/session/x/diagnostics").view).toBe("Diagnostics");
  });

  it("falls back to Timeline for an unknown view slug", () => {
    expect(parse("/session/x/bogus").view).toBe("Timeline");
  });

  it("reads list filters from the query string", () => {
    const state = parse("/repo/meridian-peak6?q=playwright&archived=only");
    expect(state.search).toBe("playwright");
    expect(state.archived).toBe("only");
  });

  it("ignores an invalid archived value", () => {
    expect(parse("/?archived=bogus").archived).toBeUndefined();
  });

  it("reads timeline filters from the query string", () => {
    const state = parse("/session/x/timeline?scope=all&kind=tool");
    expect(state.scope).toBe("all");
    expect(state.kind).toBe("tool");
  });

  it("reads the session source from ?sourceId, defaulting to undefined", () => {
    expect(parse("/session/x/timeline?sourceId=claude-code").source).toBe("claude-code");
    expect(parse("/session/x/timeline?sourceId=codex").source).toBe("codex");
    expect(parse("/session/x/timeline").source).toBeUndefined();
    expect(parse("/session/x/timeline?sourceId=bogus").source).toBeUndefined();
  });
});

describe("routing — buildPath", () => {
  const base: RouteState = {
    view: "Sessions",
    repo: null,
    sessionId: null,
    source: undefined,
    search: "",
    archived: undefined,
    scope: "this",
    kind: "all",
  };

  it("omits sourceId from session detail URLs because session ids resolve their source", () => {
    expect(buildPath({ ...base, view: "Timeline", sessionId: "abc", source: "claude-code" })).toBe("/session/abc/timeline");
    expect(buildPath({ ...base, view: "Timeline", sessionId: "abc", source: "codex" })).toBe("/session/abc/timeline");
    expect(buildPath({ ...base, view: "Timeline", sessionId: "abc", source: undefined })).toBe("/session/abc/timeline");
    expect(buildPath({ ...base, view: "Agent Graph", sessionId: "abc", source: "claude-code" })).toBe("/session/abc/graph");
  });

  it("builds `/` for the all-repos Sessions list", () => {
    expect(buildPath(base)).toBe("/");
  });

  it("builds `/repos` for the Repos browser", () => {
    expect(buildPath({ ...base, view: "Repos" })).toBe("/repos");
  });

  it("builds `/repo/:repo`, encoding the name", () => {
    expect(buildPath({ ...base, repo: "casual/contacts" })).toBe("/repo/casual%2Fcontacts");
  });

  it("builds `/session/:id/<slug>` for detail views", () => {
    expect(buildPath({ ...base, view: "Timeline", sessionId: "abc" })).toBe("/session/abc/timeline");
    expect(buildPath({ ...base, view: "Tokens", sessionId: "abc" })).toBe("/session/abc/tokens");
    expect(buildPath({ ...base, view: "Agent Graph", sessionId: "abc" })).toBe("/session/abc/graph");
  });

  it("falls back to the list when a detail view has no session", () => {
    expect(buildPath({ ...base, view: "Timeline", sessionId: null })).toBe("/");
  });

  it("omits default filters and includes non-default ones", () => {
    expect(buildPath({ ...base, repo: "r", search: "", archived: "exclude" })).toBe("/repo/r");
    expect(buildPath({ ...base, repo: "r", search: "foo", archived: "only" })).toBe("/repo/r?q=foo&archived=only");
  });

  it("includes timeline scope/kind only when non-default", () => {
    expect(buildPath({ ...base, view: "Timeline", sessionId: "abc", scope: "this", kind: "all" })).toBe(
      "/session/abc/timeline",
    );
    expect(buildPath({ ...base, view: "Timeline", sessionId: "abc", scope: "all", kind: "tool" })).toBe(
      "/session/abc/timeline?scope=all&kind=tool",
    );
  });

  it("does not attach list filters to the Repos browser", () => {
    expect(buildPath({ ...base, view: "Repos", search: "foo", archived: "only" })).toBe("/repos");
  });
});

describe("routing — round-trip", () => {
  const urls = [
    "/",
    "/repos",
    "/repo/meridian-peak6",
    "/repo/meridian-peak6?q=playwright&archived=only",
    "/session/019e7486/timeline",
    "/session/019e7486/tokens",
    "/session/019e7486/timeline?scope=all&kind=tool",
  ];
  for (const url of urls) {
    it(`round-trips ${url}`, () => {
      expect(buildPath(parse(url))).toBe(url);
    });
  }
});
