import { describe, expect, it } from "vitest";

import { classifyCall, fillCallCounts } from "../../src/backend/rollout/classifyCall";
import type { FetchCallRender, ReadCallRender, SearchCallRender } from "../../src/shared/contracts";

describe("classifyCall", () => {
  it("classifies web_search into a fetch (search) render from the query", () => {
    const render = classifyCall("web_search", {}, "sqlite WAL busy_timeout") as FetchCallRender;
    expect(render).toMatchObject({ kind: "fetch", mode: "search", query: "sqlite WAL busy_timeout" });
  });

  it("classifies web_fetch into a fetch (fetch) render from the URL", () => {
    const render = classifyCall("web_fetch", { url: "https://sqlite.org/wal.html" }, undefined) as FetchCallRender;
    expect(render).toMatchObject({ kind: "fetch", mode: "fetch", url: "https://sqlite.org/wal.html" });
  });

  it("classifies grep/search_files into a search_call request", () => {
    const render = classifyCall("search_files", { pattern: "outputRender", path: "src/", flags: "i" }, undefined) as SearchCallRender;
    expect(render).toMatchObject({ kind: "search_call", pattern: "outputRender", path: "src/", flags: "i" });
  });

  it("classifies read_file into a read render with line range", () => {
    const render = classifyCall("read_file", { path: "src/db.rs", start_line: 40, end_line: 46 }, undefined) as ReadCallRender;
    expect(render).toMatchObject({ kind: "read", path: "src/db.rs", startLine: 40, endLine: 46 });
  });

  it("returns undefined for tools that keep their own event kind or aren't call-rendered", () => {
    expect(classifyCall("exec_command", { cmd: "ls" }, undefined)).toBeUndefined();
    expect(classifyCall("spawn_agent", { agent_type: "worker" }, undefined)).toBeUndefined();
    expect(classifyCall("skill", { name: "read_pdf" }, undefined)).toBeUndefined();
    expect(classifyCall(undefined, {}, undefined)).toBeUndefined();
    // web_search with neither query nor url → nothing to render
    expect(classifyCall("web_search", {}, undefined)).toBeUndefined();
  });
});

describe("fillCallCounts", () => {
  it("reads a fetch search result count", () => {
    const render: FetchCallRender = { kind: "fetch", mode: "search", query: "x" };
    fillCallCounts(render, "6 results");
    expect(render.results).toBe(6);
  });

  it("reads an http status for a fetch", () => {
    const render: FetchCallRender = { kind: "fetch", mode: "fetch", url: "https://x" };
    fillCallCounts(render, "200 · 38 KB");
    expect(render.status).toBe(200);
  });

  it("reads search hits, including an explicit zero", () => {
    const hit: SearchCallRender = { kind: "search_call", pattern: "x" };
    fillCallCounts(hit, "8 matches in 3 files");
    expect(hit.hits).toBe(8);
    const zero: SearchCallRender = { kind: "search_call", pattern: "y" };
    fillCallCounts(zero, "no matches");
    expect(zero.hits).toBe(0);
  });
});
