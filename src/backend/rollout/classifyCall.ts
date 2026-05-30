import type { CallRender } from "../../shared/contracts";

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
  return undefined;
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
  }
}
