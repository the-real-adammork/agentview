import { describe, expect, it } from "vitest";

import { classifyCall, fillCallCounts, fillToolSearch } from "../../src/backend/rollout/classifyCall";
import type {
  AgentCallRender,
  FetchCallRender,
  ReadCallRender,
  SearchCallRender,
  ToolSearchCallRender,
} from "../../src/shared/contracts";

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

  it("classifies agent coordination tools", () => {
    expect(classifyCall("spawn_agent", { agent_type: "worker", message: "wire the panel" }, undefined)).toMatchObject({
      kind: "agent",
      op: "spawn",
      role: "worker",
      task: "wire the panel",
    });
    expect(classifyCall("wait_agent", { targets: ["a", "b"] }, undefined)).toMatchObject({ kind: "agent", op: "wait", targets: ["a", "b"] });
    expect(classifyCall("send_input", { target: "a", message: "go" }, undefined)).toMatchObject({ kind: "agent", op: "send", target: "a", message: "go" });
  });

  it("returns undefined for tools that keep their own event kind or aren't call-rendered", () => {
    expect(classifyCall("exec_command", { cmd: "ls" }, undefined)).toBeUndefined();
    expect(classifyCall("skill", { name: "read_pdf" }, undefined)).toBeUndefined();
    expect(classifyCall(undefined, {}, undefined)).toBeUndefined();
    // web_search with neither query nor url → nothing to render
    expect(classifyCall("web_search", {}, undefined)).toBeUndefined();
  });
});

describe("fillCallCounts — agent status from result", () => {
  it("spawn → nickname + open", () => {
    const r: AgentCallRender = { kind: "agent", op: "spawn", role: "worker" };
    fillCallCounts(r, '{"agent_id":"019e7016","nickname":"Bacon"}');
    expect(r).toMatchObject({ nickname: "Bacon", status: "open" });
  });
  it("wait → timed_out / ok", () => {
    const timeout: AgentCallRender = { kind: "agent", op: "wait", targets: ["a"] };
    fillCallCounts(timeout, '{"status":{},"timed_out":true}');
    expect(timeout.status).toBe("timed_out");
    const ok: AgentCallRender = { kind: "agent", op: "wait", targets: ["a"] };
    fillCallCounts(ok, '{"status":{"a":"done"},"timed_out":false}');
    expect(ok.status).toBe("ok");
  });
  it("send → ok on submission", () => {
    const r: AgentCallRender = { kind: "agent", op: "send", target: "a" };
    fillCallCounts(r, '{"submission_id":"019e703a"}');
    expect(r.status).toBe("ok");
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

describe("tool_search call render", () => {
  it("classifies tool_search into a render skeleton from query + limit", () => {
    const render = classifyCall("tool_search", { query: "spawn sub-agent worker", limit: 8 }, undefined) as ToolSearchCallRender;
    expect(render).toMatchObject({
      kind: "tool_search",
      query: "spawn sub-agent worker",
      limit: 8,
      resultCount: 0,
      namespaces: [],
    });
  });

  it("returns undefined for tool_search without a query", () => {
    expect(classifyCall("tool_search", {}, undefined)).toBeUndefined();
  });

  it("fills namespaces, function summaries, param chips and total count from the output tree", () => {
    const render: ToolSearchCallRender = { kind: "tool_search", query: "q", resultCount: 0, namespaces: [] };
    fillToolSearch(render, [
      {
        type: "namespace",
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
        tools: [
          {
            type: "function",
            name: "spawn_agent",
            description: "\n\nSpawn a general-purpose sub-agent worker\nmore detail here",
            parameters: { type: "object", properties: { agent_type: {}, model: {} } },
          },
          {
            type: "function",
            name: "wait_agent",
            description: "Block until target agents settle",
            parameters: { properties: { targets: {}, timeout_ms: {} } },
          },
        ],
      },
    ]);
    expect(render.resultCount).toBe(2);
    expect(render.namespaces).toEqual([
      {
        name: "multi_agent_v1",
        description: "Tools for spawning and managing sub-agents.",
        functions: [
          { name: "spawn_agent", summary: "Spawn a general-purpose sub-agent worker", params: ["agent_type", "model"] },
          { name: "wait_agent", summary: "Block until target agents settle", params: ["targets", "timeout_ms"] },
        ],
      },
    ]);
  });
});
