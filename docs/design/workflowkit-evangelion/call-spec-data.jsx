/* ============================================================
   CALL RENDERERS — FULL SPEC · data layer
   Sample (ev,out) call pairs + per-renderer spec metadata for the
   CALL RENDERERS class (invocation side). Live examples render via
   the REAL renderers in call-renderers.jsx.
   Attaches CALL_SPECS + CALL_ENVELOPE to window.
   ============================================================ */

// tool_call envelope: ev carries name + args + callRender; out is the paired result.
const mkCall = (name, callRender, opts = {}) => ({
  ev: { name, call_id: opts.callId || "call_8f21ac9d", args: opts.args || {}, callRender, ts: 0 },
  out: { exit: opts.exit ?? 0, fail: !!opts.fail, ts: opts.durationMs ?? 200, output: opts.output || "" },
  isCall: true,
});

/* ---- PATCH (apply_patch) ---- */
const patchUpdate = mkCall("apply_patch", { kind: "patch", files: [
  { op: "update", path: "tests/e2e/src/scenarios/local-web-demo.spec.ts", added: 4, removed: 3, hunks: [
    { header: "@@ import helpers", lines: [
      { t: "ctx", text: "import { test, expect } from \"@playwright/test\";" },
      { t: "add", text: "import { dateButton } from \"../helpers/selectors\";" },
    ] },
    { header: "@@ assert selected day", lines: [
      { t: "del", text: "await expect(page.getByRole(\"button\", { name: /2026-05-22/ }))" },
      { t: "del", text: "  .toHaveAttribute(\"aria-pressed\", \"true\");" },
      { t: "add", text: "await expect(page.getByRole(\"button\")" },
      { t: "add", text: "  .filter({ hasText: \"2026-05-22\" }))" },
      { t: "add", text: "  .toHaveAttribute(\"aria-pressed\", \"true\");" },
    ] },
    { header: "@@ click previous day", lines: [
      { t: "del", text: "await page.getByRole(\"button\", { name: /2026-05-21/ }).click();" },
      { t: "add", text: "await page.getByRole(\"button\").filter({ hasText: \"2026-05-21\" }).click();" },
    ] },
  ] },
] }, { callId: "call_xCU1v0mN6FkdOJgrnB5SrbS7", durationMs: 30, output: "Success. Updated the following files:\nM tests/e2e/src/scenarios/local-web-demo.spec.ts" });

const patchMixed = mkCall("apply_patch", { kind: "patch", files: [
  { op: "add", path: "dashboard/components/PatchView.tsx", added: 28, removed: 0, hunks: [
    { header: "@@ new file (28 lines)", lines: [
      { t: "add", text: "export function PatchView({ r, out }: PatchProps) {" },
      { t: "add", text: "  return <div className=\"patch\">{/* … */}</div>;" },
      { t: "add", text: "}" },
    ] },
  ] },
  { op: "move", path: "dashboard/graph.tsx", newPath: "dashboard/agent_graph.tsx", added: 0, removed: 0 },
  { op: "delete", path: "dashboard/legacy_list.tsx", added: 0, removed: 41 },
] }, { durationMs: 22, output: "Success. Updated the following files:\nA dashboard/components/PatchView.tsx\nR dashboard/agent_graph.tsx\nD dashboard/legacy_list.tsx" });

/* ---- READ (read_file) ---- */
const readSlice = mkCall("read_file", { kind: "read", path: "dashboard/overview.tsx", startLine: 1, endLine: 120, totalLines: 120 }, { args: { path: "dashboard/overview.tsx" }, durationMs: 18, output: "// 120 lines read" });
const readFull = mkCall("read_file", { kind: "read", path: "src/db.rs", totalLines: 218 }, { durationMs: 24, output: "// 218 lines read" });

/* ---- SEARCH request (grep) ---- */
const searchHits = mkCall("grep", { kind: "search_call", pattern: "outputRender", path: "dashboard/", flags: "i", hits: 8 }, { durationMs: 40, output: "8 matches in 3 files" });
const searchZero = mkCall("grep", { kind: "search_call", pattern: "TODO\\(legacy\\)", path: "src/", hits: 0 }, { durationMs: 20, output: "no matches" });

/* ---- WEB (web_search / web_fetch) ---- */
const webSearch = mkCall("web_search", { kind: "fetch", mode: "search", query: "sqlite WAL busy_timeout concurrent readers", results: 6 }, { durationMs: 880, output: "6 results" });
const webFetch = mkCall("web_fetch", { kind: "fetch", mode: "fetch", url: "https://www.sqlite.org/wal.html", status: 200 }, { durationMs: 420, output: "200 · 38 KB" });

/* ---- AGENT (spawn_agent / wait_agent / send_input) ---- */
const agentSpawn = mkCall("spawn_agent", { kind: "agent", op: "spawn", nickname: "Bacon", role: "worker", task: "general-purpose implementation worker — wire the diagnostics panel into App.tsx", status: "open" }, { callId: "call_019e7016", durationMs: 60, output: "{\"agent_id\":\"019e7016-…\",\"nickname\":\"Bacon\"}" });
const agentTimeout = mkCall("wait_agent", { kind: "agent", op: "wait", targets: ["019e7016"], status: "timed_out" }, { callId: "call_019e7022", durationMs: 60000, output: "{\"status\":{},\"timed_out\":true}" });
const agentSend = mkCall("send_input", { kind: "agent", op: "send", nickname: "Bacon", target: "019e702e", message: "Approved. Proceed with Task 3 — wire the diagnostics panel into App.tsx", status: "ok" }, { callId: "call_019e703a", durationMs: 30, output: "{\"submission_id\":\"019e703a-…\"}" });

/* ---- SKILL (skill_invoke) ---- */
const skillSearch = mkCall("skill_invoke", { kind: "skill", name: "web_search", summary: "OpenTelemetry log sampling defaults", status: "ok" }, { durationMs: 1200, output: "ok" });
const skillPdf = mkCall("skill_invoke", { kind: "skill", name: "read_pdf", summary: "OTLP spec §4 — exporter retry semantics", status: "ok" }, { durationMs: 4200, output: "ok" });

/* ============================================================
   CALL ENVELOPE — the tool_call ↔ tool_output contract
   ============================================================ */
const CALL_ENVELOPE = {
  schema:
`// A tool_call carries the invocation + args. The server
// parses args into callRender (BY TOOL NAME) — complementary
// to outputRender (parsed from the result, by output kind).
interface ToolCall {
  kind: "tool_call";
  name: string;        // apply_patch · read_file · grep …
  call_id: string;     // pairs with the tool_output
  args: object;        // raw tool arguments
  callRender: CallRender | null;
                       // null ⇒ generic one-line arg summary
  ts: number;
}

// the paired result, matched on call_id
interface ToolOutput {
  kind: "tool_output";
  call_id: string;
  exit: number;
  output: string;
}

type CallRender =
  | PatchRender | ReadRender | SearchRender
  | FetchRender | AgentRender | SkillRender;`,
  pipeline: ["server parse", "callRender JSON", "renderer by NAME", "preview (capped)", "expand bar", "modal (full)", "RAW"],
};

/* ============================================================
   CALL_SPECS — one sheet per call renderer
   ============================================================ */
const CALL_SPECS = [
  {
    id: "patch", n: "C1", group: "FILE OPERATIONS", name: "PatchView", title: "APPLY PATCH", accent: "--amber", accentName: "amber",
    triggers: "apply_patch · write_file",
    desc: "The flagship call renderer, and a composite: the patch body reuses the diff line vocabulary (Update/Add/Delete/Move) and the paired result becomes an M/A/D/R write summary.",
    schema:
`interface PatchRender {
  kind: "patch";
  files: {
    op: "update" | "add" | "delete" | "move";
    path: string;
    newPath?: string;   // move target
    added: number;
    removed: number;
    hunks?: {           // update / add bodies
      header: string;
      lines: { t: "ctx"|"add"|"del"; text: string }[];
    }[];
  }[];
}
// result strip reads the paired tool_output:
//   update M · add A · delete D · move R`,
    behavior: [
      ["Inline cap", "8 hunk lines — across all files"],
      ["Overflow", "+N lines"],
      ["Modal", "same PatchView · full · every file + hunk"],
      ["Composite", "reuses .xr-line diff vocabulary + M/A/D strip"],
      ["Directives", "update M · add A · delete D · move R"],
    ],
    tokens: [["update / M", "--amber"], ["add / A", "--good"], ["delete / D", "--warn-bright"], ["move / R", "--cyan"]],
    states: [["MULTI-HUNK", "preview"], ["ADD · DEL · MOVE", "ok"]],
    samples: [
      { label: "apply_patch · multi-hunk update", tone: "preview", note: "Update File — 3 hunks capped at 8 lines; 'M' write summary", s: patchUpdate },
      { label: "apply_patch · add · delete · move", tone: "ok", note: "All directives — A/D/R codes, move shows → target", s: patchMixed },
    ],
  },
  {
    id: "read", n: "C2", group: "FILE OPERATIONS", name: "ReadView", title: "READ FILE", accent: "--ink-strong", accentName: "ink",
    triggers: "read_file · cat (as a tool)",
    desc: "A file read request — path with an optional line range, and the lines-read count from the paired output. The highest-volume call.",
    schema:
`interface ReadRender {
  kind: "read";
  path: string;
  startLine?: number;  // omit ⇒ whole file
  endLine?: number;
  totalLines?: number; // lines read (result)
}`,
    behavior: [
      ["Inline cap", "single line — no body"],
      ["Overflow", "none"],
      ["Modal", "path + range + lines read"],
      ["Slice", "start/end omitted ⇒ whole file"],
    ],
    tokens: [["path", "--ink-strong"], ["range", "--ink-dim"], ["icon", "--ink-faint"]],
    states: [["SLICE", "ok"], ["FULL FILE", "ok"]],
    samples: [
      { label: "read_file · slice", tone: "ok", note: "path + L1–120 range, lines read on the right", s: readSlice },
      { label: "read_file · full file", tone: "ok", note: "no range ⇒ whole file (218 lines)", s: readFull },
    ],
  },
  {
    id: "search_call", n: "C3", group: "FILE OPERATIONS", name: "SearchCallView", title: "SEARCH", accent: "--good", accentName: "good",
    triggers: "grep · search_files",
    desc: "The search REQUEST — pattern, scope and flags, with the hit count from the result. Distinct from MatchesView, which renders the hits themselves.",
    schema:
`interface SearchRender {
  kind: "search_call";
  pattern: string;
  path?: string;       // scope
  flags?: string;      // i · w · …
  hits?: number;       // result count
}`,
    behavior: [
      ["Inline cap", "single line"],
      ["Overflow", "none"],
      ["Result", "hit count from paired output (0 ⇒ faint)"],
      ["vs MatchesView", "this is the REQUEST; MatchesView renders hits"],
    ],
    tokens: [["pattern", "--good"], ["scope", "--ink-dim"], ["zero hits", "--ink-faint"]],
    states: [["HITS", "ok"], ["ZERO", "empty"]],
    samples: [
      { label: "grep · hits", tone: "ok", note: "/outputRender/i in dashboard/ — 8 hits", s: searchHits },
      { label: "grep · zero", tone: "empty", note: "no matches — count rendered faint", s: searchZero },
    ],
  },
  {
    id: "fetch", n: "C4", group: "RESEARCH & AGENTS", name: "FetchView", title: "WEB", accent: "--cyan", accentName: "cyan",
    triggers: "web_search · web_fetch",
    desc: "Web research — a search query or a fetched URL, with result count or HTTP status from the paired output.",
    schema:
`interface FetchRender {
  kind: "fetch";
  mode: "search" | "fetch";
  query?: string;      // mode: search
  url?: string;        // mode: fetch
  results?: number;    // search result count
  status?: number;     // fetch http status
}`,
    behavior: [
      ["Inline cap", "single line"],
      ["Overflow", "none"],
      ["Mode", "search ⇒ query · fetch ⇒ URL + status"],
      ["Result", "result count / http status"],
    ],
    tokens: [["GET", "--cyan"], ["query", "--ink"], ["result", "--ink-dim"]],
    states: [["WEB SEARCH", "ok"], ["WEB FETCH", "ok"]],
    samples: [
      { label: "web_search · query", tone: "ok", note: "query + result count", s: webSearch },
      { label: "web_fetch · URL", tone: "ok", note: "GET badge + URL + http status", s: webFetch },
    ],
  },
  {
    id: "agent", n: "C5", group: "RESEARCH & AGENTS", name: "AgentView", title: "AGENT OPS", accent: "--good", accentName: "good",
    triggers: "spawn_agent · wait_agent · send_input",
    desc: "Sub-agent orchestration — spawn (nickname · role · task), wait (targets + timeout) and send_input (steer a running agent). One call-line, switched on op; formalizes the bare tool names that used to fall through to 'Other'.",
    schema:
`interface AgentRender {
  kind: "agent";
  op: "spawn" | "wait" | "send";
  nickname?: string;   // spawn · send
  role?: string;       // spawn (agent_type)
  task?: string;       // spawn
  targets?: string[];  // wait (one or many)
  target?: string;     // send
  message?: string;    // send (truncated)
  status?: string;     // open · ok · timed_out · failed
}`,
    behavior: [
      ["Inline cap", "single line"],
      ["Overflow", "none — task / message truncate"],
      ["Spawn", "⊕ nickname · role · task + child status"],
      ["Wait", "◌ targets (N) + open / ok / timed out"],
      ["Send", "→ target · message + submission status"],
    ],
    tokens: [["spawn", "--good"], ["wait", "--cyan"], ["send", "--amber"], ["timed out", "--warn-bright"]],
    states: [["SPAWN", "ok"], ["WAIT · TIMED OUT", "fail"], ["SEND INPUT", "ok"]],
    samples: [
      { label: "spawn_agent", tone: "ok", note: "⊕ Bacon (worker) · task + child status (open)", s: agentSpawn },
      { label: "wait_agent · timed out", tone: "fail", note: "◌ await target — 60s elapsed, timed_out → red", s: agentTimeout },
      { label: "send_input", tone: "ok", note: "→ steer Bacon mid-run with an approval message", s: agentSend },
    ],
  },
  {
    id: "skill", n: "C6", group: "RESEARCH & AGENTS", name: "SkillView", title: "SKILL", accent: "--primary", accentName: "primary",
    triggers: "skill_invoke",
    desc: "A skill invocation — the skill name, a one-line summary of intent, and ok/fail status.",
    schema:
`interface SkillRender {
  kind: "skill";
  name: string;        // web_search · read_pdf
  summary: string;
  status: "ok" | "fail";
}`,
    behavior: [
      ["Inline cap", "single line"],
      ["Overflow", "none"],
      ["Modal", "name + summary + status"],
      ["Status", "ok green · fail red"],
    ],
    tokens: [["name", "--primary"], ["ok", "--good"], ["fail", "--warn-bright"]],
    states: [["WEB SEARCH", "ok"], ["READ PDF", "ok"]],
    samples: [
      { label: "skill_invoke · web_search", tone: "ok", note: "skill name + summary + ok", s: skillSearch },
      { label: "skill_invoke · read_pdf", tone: "ok", note: "PDF skill summary", s: skillPdf },
    ],
  },
];

Object.assign(window, { CALL_SPECS: CALL_SPECS, CALL_ENVELOPE: CALL_ENVELOPE });
