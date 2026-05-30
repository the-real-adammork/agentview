import type { CallRender, ToolSearchCallRender, ToolSearchFunction, ToolSearchNamespace } from "../../shared/contracts";

/**
 * Classify a tool *invocation* (the call side) into a one-line `callRender`, from
 * the tool name + arguments. Complements `classifyExecOutput` (the result side).
 * Only read / search / fetch tools are call-rendered — agent and skill keep their
 * richer first-class event kinds. Returns undefined for everything else.
 */

type Args = Record<string, unknown> | undefined;

const str = (...values: unknown[]): string | undefined => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value;
  return undefined;
};
const num = (...values: unknown[]): number | undefined => {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
};

export function classifyCall(toolName: string | undefined, args: Args, query: string | undefined): CallRender | undefined {
  if (!toolName) return undefined;
  const name = toolName.toLowerCase().replace(/[.-]/g, "_");

  if (/^(?:web_search|web_fetch|web_open|open_url|fetch_url|url_fetch|browser)$/.test(name)) {
    const url = str(args?.url, args?.uri, args?.href);
    if (url) return { kind: "fetch", mode: "fetch", url };
    const q = query ?? str(args?.query, args?.q, args?.search);
    return q ? { kind: "fetch", mode: "search", query: q } : undefined;
  }
  if (/^(?:grep|search_files|file_search|code_search|ripgrep|rg_search)$/.test(name)) {
    const pattern = query ?? str(args?.pattern, args?.query, args?.regex, args?.q);
    if (!pattern) return undefined;
    return { kind: "search_call", pattern, path: str(args?.path, args?.dir, args?.directory, args?.scope), flags: str(args?.flags) };
  }
  if (/^(?:read_file|read|view_file|open_file|cat_file|get_file)$/.test(name)) {
    const path = str(args?.path, args?.file, args?.filename, args?.file_path);
    if (!path) return undefined;
    return {
      kind: "read",
      path,
      startLine: num(args?.start_line, args?.startLine, args?.line, args?.from),
      endLine: num(args?.end_line, args?.endLine, args?.to),
      totalLines: num(args?.total_lines, args?.totalLines, args?.lines),
    };
  }
  if (/^(?:spawn_agent|spawn)$/.test(name)) {
    return { kind: "agent", op: "spawn", role: str(args?.agent_type, args?.role), task: str(args?.message, args?.task, args?.prompt) };
  }
  if (/^(?:wait_agent|wait)$/.test(name)) {
    const targets = Array.isArray(args?.targets)
      ? (args.targets as unknown[]).filter((t): t is string => typeof t === "string")
      : str(args?.target)
        ? [str(args?.target) as string]
        : undefined;
    return { kind: "agent", op: "wait", targets };
  }
  if (/^(?:send_input|send)$/.test(name)) {
    return { kind: "agent", op: "send", target: str(args?.target), message: str(args?.message, args?.input) };
  }
  if (name === "tool_search") {
    const q = query ?? str(args?.query, args?.q, args?.search);
    if (!q) return undefined;
    // namespaces/resultCount are filled from the joined output via fillToolSearch.
    return { kind: "tool_search", query: q, limit: num(args?.limit, args?.max_results, args?.max), resultCount: 0, namespaces: [] };
  }
  return undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** First non-empty line of a (possibly multi-line, indented) description. */
const firstLine = (desc: unknown): string | undefined => {
  if (typeof desc !== "string") return undefined;
  const line = desc.split("\n").map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 160) : undefined;
};

/** Parameter names from a JSON-Schema-ish `parameters`/`input_schema` object. */
const paramNames = (schema: unknown): string[] | undefined => {
  const node = isRecord(schema) ? schema : undefined;
  const props = node && isRecord(node.properties) ? node.properties : undefined;
  if (!props) return undefined;
  const names = Object.keys(props);
  return names.length ? names : undefined;
};

const parseFn = (entry: Record<string, unknown>): ToolSearchFunction => {
  const fn: ToolSearchFunction = { name: typeof entry.name === "string" ? entry.name : "" };
  const summary = firstLine(entry.description);
  if (summary) fn.summary = summary;
  const params = paramNames(entry.parameters ?? entry.input_schema);
  if (params) fn.params = params;
  return fn;
};

/**
 * Fill a tool_search render's namespace tree + total count from the joined
 * `tool_search_output.tools` array (namespaces with nested function defs, plus
 * any loose top-level functions).
 */
export function fillToolSearch(render: ToolSearchCallRender, tools: unknown): void {
  if (!Array.isArray(tools)) return;
  const namespaces: ToolSearchNamespace[] = [];
  const loose: ToolSearchFunction[] = [];
  let count = 0;
  for (const entry of tools) {
    if (!isRecord(entry)) continue;
    if (entry.type === "namespace" || Array.isArray(entry.tools)) {
      const fns = (Array.isArray(entry.tools) ? entry.tools : []).filter(isRecord).map(parseFn);
      count += fns.length;
      const ns: ToolSearchNamespace = { name: typeof entry.name === "string" ? entry.name : "", functions: fns };
      const desc = firstLine(entry.description);
      if (desc) ns.description = desc;
      namespaces.push(ns);
    } else if (entry.type === "function" || typeof entry.name === "string") {
      loose.push(parseFn(entry));
    }
  }
  if (loose.length) {
    count += loose.length;
    namespaces.push({ name: "", functions: loose });
  }
  render.namespaces = namespaces;
  render.resultCount = count;
}

/** Best-effort count/status fill from the joined result preview (most outputs are terse or empty). */
export function fillCallCounts(render: CallRender, output: string | undefined): void {
  const text = output ?? "";
  if (render.kind === "fetch" && render.mode === "search") {
    const match = /(\d+)\s+results?/i.exec(text);
    if (match) render.results = Number(match[1]);
  } else if (render.kind === "fetch") {
    const match = /(?:^|\bstatus[:\s]+)(\d{3})\b/i.exec(text);
    if (match) render.status = Number(match[1]);
  } else if (render.kind === "search_call") {
    const match = /(\d+)\s+(?:hits?|matches?)/i.exec(text);
    if (match) render.hits = Number(match[1]);
    else if (/\bno matches\b|\b0 results\b/i.test(text)) render.hits = 0;
  } else if (render.kind === "read" && render.totalLines === undefined) {
    const match = /(\d+)\s+lines/i.exec(text);
    if (match) render.totalLines = Number(match[1]);
  } else if (render.kind === "agent") {
    try {
      const result = JSON.parse(text) as Record<string, unknown>;
      if (render.op === "spawn") {
        if (typeof result.nickname === "string") render.nickname = result.nickname;
        render.status = render.status ?? (result.nickname ? "open" : undefined);
      } else if (render.op === "wait") {
        render.status = result.timed_out ? "timed_out" : "ok";
      } else if (render.op === "send") {
        if (result.submission_id) render.status = "ok";
      }
    } catch {
      // spawn errors return a plain-text message (not JSON) — leave status unset
    }
  }
}
