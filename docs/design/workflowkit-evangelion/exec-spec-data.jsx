/* ============================================================
   EXEC RENDERERS — FULL SPEC · data layer
   Sample (ev,out) pairs + per-renderer specification metadata.
   Attaches SPECS + ENVELOPE to window for the spec app to consume.
   The live examples are rendered by the REAL renderers in
   exec-renderers.jsx (shared with Observatory) — never re-implemented.
   ============================================================ */

// (ev,out) envelope builder — mirrors the shape Observatory's timeline feeds in.
const mk = (cmd, render, opts = {}) => ({
  ev: { name: "exec_command", command_preview: cmd, args: { cmd: cmd.split(" ") }, ts: 0 },
  out: { exit: opts.exit ?? 0, fail: !!opts.fail, ts: opts.durationMs ?? 1200, output: opts.output || "", outputRender: render },
});

/* ---- DIFF ---- */
const diffBig = mk("git diff dashboard/timeline.tsx", { kind: "diff", files: [
  { path: "dashboard/timeline.tsx", added: 38, removed: 9, hunks: [
    { header: "@@ -14,9 +14,16 @@ function TimelineView({ session }) {", lines: [
      { t: "ctx", text: "  const [filter, setFilter] = useState(\"all\");" },
      { t: "del", text: "  const events = TIMELINES[session.id] || [];" },
      { t: "add", text: "  const [scope, setScope] = useState(\"this\");" },
      { t: "add", text: "  const descendants = useDescendants(session);" },
      { t: "add", text: "  const events = useMemo(() => mergeScoped(session, scope), [scope]);" },
      { t: "ctx", text: "  const t0 = events[0]?.ts;" },
    ] },
    { header: "@@ -52,6 +59,21 @@ function TimelineView({ session }) {", lines: [
      { t: "ctx", text: "  return (" },
      { t: "add", text: "    <div className=\"tl-range\" role=\"group\">" },
      { t: "add", text: "      <button data-on={scope===\"this\"}>THIS</button>" },
      { t: "add", text: "      <button data-on={scope===\"all\"}>+SUBS</button>" },
      { t: "add", text: "    </div>" },
      { t: "del", text: "      {events.map(renderRow)}" },
      { t: "add", text: "      {scoped.map((e) => <EventRow e={e} key={e.id} />)}" },
    ] },
  ] },
] }, { durationMs: 240 });

const diffSmall = mk("git diff README.md", { kind: "diff", files: [
  { path: "README.md", added: 2, removed: 1, hunks: [
    { header: "@@ -1,4 +1,5 @@", lines: [
      { t: "ctx", text: "# Observatory" },
      { t: "del", text: "A dashboard." },
      { t: "add", text: "A read-only dashboard for Codex agent sessions." },
      { t: "add", text: "" },
    ] },
  ] },
] }, { durationMs: 90 });

/* ---- TESTS ---- */
const testsFail = mk("pytest -q tests/", { kind: "tests", passed: 42, failed: 3, skipped: 1, durationMs: 6200, failing: [
  "tests/test_parser.py::test_lazy_resume_after_token_count",
  "tests/test_tokens.py::test_negative_delta_guard",
  "tests/test_db.py::test_wal_busy_timeout_retry",
] }, { exit: 1, fail: true, durationMs: 6200 });

const testsPass = mk("cargo test", { kind: "tests", passed: 128, failed: 0, skipped: 2, durationMs: 3400, failing: [] }, { durationMs: 3400 });

/* ---- STATUS ---- */
const statusBig = mk("git status --short", { kind: "status", files: [
  { code: "M", path: "dashboard/app.tsx" },
  { code: "M", path: "dashboard/styles.css" },
  { code: "A", path: "dashboard/overview.tsx" },
  { code: "A", path: "dashboard/timeline.tsx" },
  { code: "D", path: "dashboard/legacy_list.tsx" },
  { code: "R", path: "dashboard/graph.tsx → dashboard/agent_graph.tsx" },
  { code: "??", path: "scratch/notes.md" },
  { code: "??", path: "scratch/query.sql" },
] }, { durationMs: 40 });

const statusClean = mk("git status --short", { kind: "status", files: [] }, { durationMs: 30 });

/* ---- TABLE ---- */
const tableSmall = mk("sqlite3 logs_2.sqlite \"SELECT target, COUNT(*) …\"", { kind: "table",
  columns: ["target", "warnings"],
  rows: [["codex_core_skills::loader","14"],["codex_api::sse::responses","6"],["codex_otel.log_only","3"],["codex_core::session::handlers","2"]],
  totalRows: 4 }, { durationMs: 120 });

const tableBig = mk("sqlite3 state_5.sqlite \"SELECT * FROM threads LIMIT 50\"", { kind: "table",
  columns: ["id", "agent_nickname", "role", "tokens", "depth", "status"],
  rows: Array.from({ length: 14 }).map((_, i) => [
    "0BM2" + (1000 + i), ["ARCHIMEDES","SOCRATES","BORGES","HYPATIA","TURING","EUCLID","FERMI"][i % 7],
    ["researcher","worker"][i % 2], String(2000 + i * 1731), String(1 + (i % 3)), ["open","closed","failed"][i % 3],
  ]), totalRows: 50 }, { durationMs: 310 });

/* ---- FILE PEEK ---- */
const fileBig = mk("nl -ba dashboard/overview.tsx", { kind: "file", path: "dashboard/overview.tsx", startLine: 1, totalLines: 412, lines: [
  { n: 1, text: "import { useMemo, useState } from \"react\";" },
  { n: 2, text: "import { SessionsTable } from \"./SessionsTable\";" },
  { n: 3, text: "import { useThreads } from \"../data/threads\";" },
  { n: 4, text: "" },
  { n: 5, text: "export function Overview({ repo }: { repo: string }) {" },
  { n: 6, text: "  const threads = useThreads(repo);" },
  { n: 7, text: "  const [q, setQ] = useState(\"\");" },
  { n: 8, text: "  const rows = useMemo(() => filterThreads(threads, q), [threads, q]);" },
  { n: 9, text: "  const active = rows.filter((r) => r.childrenOpen > 0);" },
  { n: 10, text: "  return (" },
  { n: 11, text: "    <section className=\"overview\">" },
  { n: 12, text: "      <SessionsTable rows={rows} active={active} />" },
  { n: 13, text: "    </section>" },
  { n: 14, text: "  );" },
  { n: 15, text: "}" },
] }, { durationMs: 70 });

const fileSlice = mk("sed -n '40,46p' src/db.rs", { kind: "file", path: "src/db.rs", startLine: 40, totalLines: 218, lines: [
  { n: 40, text: "pub fn open_readonly(path: &Path) -> Result<Connection> {" },
  { n: 41, text: "    let conn = Connection::open_with_flags(" },
  { n: 42, text: "        path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;" },
  { n: 43, text: "    conn.busy_timeout(Duration::from_millis(5000))?;" },
  { n: 44, text: "    conn.pragma_update(None, \"journal_mode\", \"WAL\")?;" },
  { n: 45, text: "    Ok(conn)" },
  { n: 46, text: "}" },
] }, { durationMs: 22 });

/* ---- SEARCH (matches) ---- */
const matchesMulti = mk("rg -n outputRender dashboard/", { kind: "matches", files: [
  { path: "dashboard/EventRow.tsx", matches: [
    { n: 88, text: "  if (e.outputRender?.kind === \"diff\") return <DiffView r={e.outputRender} />;", col: [9, 21] },
    { n: 89, text: "  if (e.outputRender?.kind === \"tests\") return <TestsView r={e.outputRender} />;", col: [9, 21] },
    { n: 96, text: "  return e.outputRender ? <ExecOutput out={e} /> : <PlainOut out={e.output} />;", col: [11, 23] },
  ] },
  { path: "dashboard/types.ts", matches: [
    { n: 42, text: "  outputRender?: OutputRender;  // server-parsed structured output", col: [2, 14] },
    { n: 51, text: "export type OutputRender =", col: [12, 24] },
    { n: 58, text: "  | { kind: \"plain\" };", col: [4, 8] },
  ] },
] }, { durationMs: 180 });

const matchesOne = mk("grep -n TODO src/db.rs", { kind: "matches", files: [
  { path: "src/db.rs", matches: [
    { n: 44, text: "    // TODO: make busy_timeout configurable", col: [7, 11] },
    { n: 92, text: "    // TODO: pool connections for concurrent readers", col: [7, 11] },
  ] },
] }, { durationMs: 24 });

/* ---- HTTP ---- */
const httpOk = mk("curl -sS http://localhost:4317/v1/health", { kind: "http", method: "GET", url: "http://localhost:4317/v1/health", status: 200, statusText: "OK", durationMs: 38, size: "142 B", contentType: "application/json", json: true,
  headers: [
    { k: "content-type", v: "application/json" },
    { k: "x-otel-collector", v: "running" },
    { k: "date", v: "Thu, 29 May 2026 12:51:09 GMT" },
    { k: "content-length", v: "142" },
  ],
  body: "{\n  \"status\": \"healthy\",\n  \"uptime_s\": 84211,\n  \"exporters\": { \"otlp\": \"ok\", \"logging\": \"ok\" },\n  \"queue_depth\": 0\n}" }, { durationMs: 38 });

const httpErr = mk("curl -sS https://api.internal/v2/threads", { kind: "http", method: "POST", url: "https://api.internal/v2/threads", status: 503, statusText: "Service Unavailable", durationMs: 5021, size: "88 B", contentType: "application/json", json: true,
  headers: [
    { k: "content-type", v: "application/json" },
    { k: "retry-after", v: "30" },
    { k: "x-request-id", v: "req_8f21ac" },
  ],
  body: "{\n  \"error\": \"upstream_unavailable\",\n  \"detail\": \"state_5 db locked\",\n  \"retryable\": true\n}" }, { exit: 22, fail: true, durationMs: 5021 });

/* ---- PLAIN ---- */
const plainShort = mk("echo $CODEX_HOME", null, { output: "/Users/adam/.codex", durationMs: 12 });
const plainLong = mk("cat ~/.codex/config.toml", null, { durationMs: 30, output:
  "[model]\nname = \"o4\"\nreasoning_effort = \"high\"\n\n[sandbox]\nmode = \"read-only\"\napproval = \"never\"\n\n[telemetry]\notel_endpoint = \"http://localhost:4317\"\nlog_level = \"warn\"\nsample_rate = 0.1\n\n[secrets]\nOPENAI_API_KEY = \"[REDACTED]\"\nGITHUB_TOKEN = \"[REDACTED]\"\n\n[paths]\nsessions = \"~/.codex/sessions\"\nstate_db = \"~/.codex/state_5.sqlite\"\nlogs_db = \"~/.codex/logs_2.sqlite\"" });

const plainFail = mk("sqlite3 logs_2.sqlite \"SELECT …\"", null, { exit: 1, fail: true, durationMs: 60, output: "Error: database is locked\n  at sqlite3_step (codex_core::db::query)\n  retry with -readonly flag" });

/* ---- BUILD ---- */
const buildFail = mk("cargo build --release", { kind: "build", tool: "cargo", errors: 2, warnings: 4, durationMs: 11200, diagnostics: [
  { severity: "error", code: "E0599", file: "src/db.rs", line: 44, col: 14, message: "no method named `busy_timeout` found for struct `Connection`", snippet: [
    { n: 43, text: "    let conn = Connection::open(path)?;" },
    { n: 44, text: "    conn.busy_timeout(Duration::from_millis(5000))?;", caret: [9, 21] },
  ] },
  { severity: "error", code: "E0277", file: "src/query.rs", line: 88, col: 9, message: "the trait `FromSql` is not implemented for `Depth`", snippet: [
    { n: 88, text: "        row.get::<_, Depth>(4)?", caret: [8, 27] },
  ] },
  { severity: "warning", code: "unused_imports", file: "src/main.rs", line: 3, col: 5, message: "unused import: `std::env`" },
  { severity: "warning", code: "dead_code", file: "src/cache.rs", line: 21, col: 1, message: "function `evict_lru` is never used" },
] }, { exit: 101, fail: true, durationMs: 11200 });

const buildOk = mk("tsc --noEmit", { kind: "build", tool: "tsc", errors: 0, warnings: 0, durationMs: 2400, diagnostics: [] }, { durationMs: 2400 });

/* ---- TRACE ---- */
const tracePy = mk("python ingest.py state_5.sqlite", { kind: "trace", lang: "python", exception: "KeyError", message: "'agent_nickname'", frames: [
  { fn: "<module>", file: "ingest.py", line: 92, user: true, code: "main(sys.argv[1])" },
  { fn: "main", file: "ingest.py", line: 51, user: true, code: "rows = parse_threads(raw)" },
  { fn: "parse_threads", file: "ingest.py", line: 33, user: true, code: "nick = record[\"agent_nickname\"]" },
  { fn: "__getitem__", file: "site-packages/attrdict/mapping.py", line: 71, user: false, code: "return self._data[key]" },
] }, { exit: 1, fail: true, durationMs: 340 });

const traceRust = mk("./target/release/observatory", { kind: "trace", lang: "rust", exception: "thread 'main' panicked", message: "called `Result::unwrap()` on an `Err` value: DatabaseLocked", frames: [
  { fn: "observatory::db::open_readonly", file: "src/db.rs", line: 45, user: true, code: "Ok(conn)" },
  { fn: "observatory::main", file: "src/main.rs", line: 22, user: true, code: "let db = open_readonly(&path).unwrap();" },
] }, { exit: 101, fail: true, durationMs: 60 });

/* ---- LINT ---- */
const lintIssues = mk("eslint dashboard/", { kind: "lint", tool: "eslint", errors: 2, warnings: 6, files: [
  { path: "dashboard/app.tsx", issues: [
    { severity: "error", line: 84, col: 7, rule: "react-hooks/rules-of-hooks", message: "React Hook called conditionally" },
    { severity: "warning", line: 112, col: 21, rule: "@typescript-eslint/no-explicit-any", message: "Unexpected any. Specify a different type" },
    { severity: "warning", line: 140, col: 3, rule: "no-console", message: "Unexpected console statement" },
    { severity: "warning", line: 168, col: 9, rule: "prefer-const", message: "'rows' is never reassigned; use const" },
  ] },
  { path: "dashboard/timeline.tsx", issues: [
    { severity: "error", line: 59, col: 11, rule: "react/jsx-key", message: "Missing \"key\" prop for element in iterator" },
    { severity: "warning", line: 77, col: 9, rule: "eqeqeq", message: "Expected '===' and instead saw '=='" },
    { severity: "warning", line: 90, col: 5, rule: "no-unused-vars", message: "'scope' is assigned but never used" },
  ] },
  { path: "dashboard/data/threads.ts", issues: [
    { severity: "warning", line: 14, col: 1, rule: "import/order", message: "Import statements out of order" },
  ] },
] }, { exit: 1, fail: true, durationMs: 1800 });

const lintClean = mk("ruff check .", { kind: "lint", tool: "ruff", errors: 0, warnings: 0, files: [] }, { durationMs: 220 });

/* ---- TREE ---- */
const treeBig = mk("tree dashboard/", { kind: "tree", root: "dashboard/", totalEntries: 19, entries: [
  { name: "app.tsx", type: "file", size: "8.2 KB", depth: 0 },
  { name: "styles.css", type: "file", size: "44 KB", depth: 0 },
  { name: "components", type: "dir", count: 7, depth: 0 },
  { name: "EventRow.tsx", type: "file", size: "6.1 KB", depth: 1 },
  { name: "DiffView.tsx", type: "file", size: "2.4 KB", depth: 1 },
  { name: "Modal.tsx", type: "file", size: "3.0 KB", depth: 1 },
  { name: "data", type: "dir", count: 4, depth: 0 },
  { name: "threads.ts", type: "file", size: "1.8 KB", depth: 1 },
  { name: "schema.ts", type: "file", size: "2.2 KB", depth: 1 },
  { name: "latest → state_5.sqlite", type: "link", depth: 0 },
] }, { durationMs: 30 });

const treeSmall = mk("ls -la ~/.codex", { kind: "tree", totalEntries: 5, entries: [
  { name: "config.toml", type: "file", size: "612 B", depth: 0 },
  { name: "sessions", type: "dir", count: 28, depth: 0 },
  { name: "state_5.sqlite", type: "file", size: "12 MB", depth: 0 },
  { name: "logs_2.sqlite", type: "file", size: "3.4 MB", depth: 0 },
  { name: "current → state_5.sqlite", type: "link", depth: 0 },
] }, { durationMs: 14 });

/* ---- LOG ---- */
const logBig = mk("git log --oneline -n 20", { kind: "log", total: 142, commits: [
  { hash: "a3f81c2", author: "adam", date: "12m ago", subject: "timeline: scope toggle for sub-agent events", refs: ["HEAD", "main"] },
  { hash: "7be09d4", author: "adam", date: "3h ago", subject: "renderers: add http + matches exec views" },
  { hash: "0c1142a", author: "mira", date: "5h ago", subject: "db: open read-only with WAL + busy_timeout" },
  { hash: "f92ab17", author: "adam", date: "1d ago", subject: "overview: filter threads by open children" },
  { hash: "55de8b0", author: "mira", date: "1d ago", subject: "otel: drop log_only spans from collector" },
  { hash: "e1770aa", author: "adam", date: "2d ago", subject: "initial dashboard scaffold" },
] }, { durationMs: 40 });

const logSmall = mk("git log --oneline -n 3", { kind: "log", total: 3, commits: [
  { hash: "a3f81c2", author: "adam", date: "12m ago", subject: "timeline: scope toggle for sub-agent events", refs: ["HEAD", "main"] },
  { hash: "7be09d4", author: "adam", date: "3h ago", subject: "renderers: add http + matches exec views" },
  { hash: "0c1142a", author: "mira", date: "5h ago", subject: "db: open read-only with WAL + busy_timeout" },
] }, { durationMs: 20 });

/* ---- JSON ---- */
const jsonBig = mk("jq . package.json", { kind: "json", source: "package.json", value: {
  name: "observatory", version: "0.3.0", private: true,
  scripts: { dev: "vite", build: "tsc && vite build", lint: "eslint ." },
  dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
  devDependencies: { typescript: "^5.4.0", vite: "^5.2.0", eslint: "^9.2.0" },
  engines: { node: ">=20" },
} }, { durationMs: 50 });

const jsonSmall = mk("jq .exporters health.json", { kind: "json", source: "health.json", value: {
  otlp: "ok", logging: "ok", queue_depth: 0,
} }, { durationMs: 18 });

/* ---- DIFFSTAT (git diff --stat) ---- */
const diffstatBig = mk("git diff --stat impl/…-foundation...impl/…-diagnostics-ui", { kind: "diffstat", files: [
  { path: "apps/server/src/app.ts", insertions: 11, deletions: 2 },
  { path: "apps/web/package.json", insertions: 1, deletions: 0 },
  { path: "apps/web/src/App.tsx", insertions: 34, deletions: 6 },
  { path: "apps/web/src/components/DiagnosticsPanel.tsx", insertions: 58, deletions: 0 },
  { path: "apps/web/src/hooks/useDiagnostics.ts", insertions: 22, deletions: 0 },
  { path: "docs/runs/run.yaml", insertions: 4, deletions: 1 },
  { path: "tests/e2e/src/scenarios/diagnostics.spec.ts", insertions: 47, deletions: 0 },
], totals: { files: 7, insertions: 177, deletions: 9 } }, { durationMs: 60 });

const diffstatSmall = mk("git diff --stat HEAD --", { kind: "diffstat", files: [
  { path: "docs/runs/app-scaffold-tooling-20260528T193425Z.yaml", insertions: 116, deletions: 7 },
], totals: { files: 1, insertions: 116, deletions: 7 } }, { durationMs: 18 });

/* ---- GIT OPS (one card, switched on `sub`) ---- */
const gitCommit = mk("git commit -m \"chore: start diagnostics foundation orchestration\"", { kind: "git", sub: "commit",
  branch: "impl/phase-1-diagnostics-foundation", shortSha: "82891db",
  subject: "chore: start diagnostics foundation orchestration",
  filesChanged: 5, insertions: 67, deletions: 33 }, { durationMs: 120, output:
  "[impl/phase-1-diagnostics-foundation 82891db] chore: start diagnostics foundation orchestration\n 5 files changed, 67 insertions(+), 33 deletions(-)" });

const gitAdd = mk("git add docs/.../run.yaml docs/.../phase-1-diagnostics-foundation.yaml …", { kind: "git", sub: "add", staged: [
  "docs/runs/run.yaml",
  "docs/runs/phase-1-diagnostics-foundation.yaml",
  "docs/runs/app-scaffold-tooling-20260528T193425Z.yaml",
  "apps/server/src/app.ts",
  "apps/web/src/App.tsx",
  "apps/web/package.json",
  ".env.example",
  "tests/e2e/src/scenarios/local-web-demo.spec.ts",
] }, { durationMs: 28, output: "" });

const gitWorktree = mk("git worktree add ../wt/app-scaffold-tooling impl/phase-2/app-scaffold-tooling", { kind: "git", sub: "worktree",
  ok: true, branch: "impl/phase-2/app-scaffold-tooling", path: "../wt/app-scaffold-tooling", head: "a42f41e" }, { durationMs: 60, output:
  "Preparing worktree (new branch 'impl/phase-2/app-scaffold-tooling')\nHEAD is now at a42f41e scaffold tooling" });

const gitWorktreeFail = mk("git worktree add ../wt/diagnostics-ui impl/phase-1/diagnostics-ui", { kind: "git", sub: "worktree",
  ok: false, branch: "impl/phase-1/diagnostics-ui", error: "cannot lock ref" }, { exit: 128, fail: true, durationMs: 40, output:
  "fatal: cannot lock ref 'refs/heads/impl/phase-1/diagnostics-ui'" });

const gitMerge = mk("git merge impl/phase-1-diagnostics-ui", { kind: "git", sub: "merge", strategy: "ort", diffstat: { files: [
  { path: ".env.example", insertions: 8, deletions: 0 },
  { path: "apps/server/src/app.ts", insertions: 36, deletions: 2 },
  { path: "apps/web/src/App.tsx", insertions: 40, deletions: 6 },
  { path: "apps/web/package.json", insertions: 1, deletions: 0 },
], totals: { files: 4, insertions: 85, deletions: 8 } } }, { durationMs: 90, output:
  "Merge made by the 'ort' strategy.\n .env.example | 8 +\n apps/server/src/app.ts | 38 +-\n apps/web/src/App.tsx | 46 +-\n apps/web/package.json | 1 +" });

const gitBranch = mk("git branch --show-current && git rev-parse HEAD", { kind: "git", sub: "branch",
  branch: "impl/phase-1-diagnostics-foundation", sha: "82891db4c9a1" }, { durationMs: 20, output:
  "impl/phase-1-diagnostics-foundation\n82891db4c9a17e2f0b3c5d18a44e0f9912abcd34" });

/* ---- DOCKER (columnar — rides the TABLE renderer + a STATUS health dot) ---- */
const tableDocker = mk("docker ps --format 'table {{.ID}}\\t{{.Names}}\\t{{.Ports}}\\t{{.Status}}'", { kind: "table",
  columns: ["CONTAINER ID", "NAMES", "PORTS", "STATUS"],
  rows: [
    ["f9be8f2fc55c", "contracts-prisma-postgres-1", "0.0.0.0:54322->5432/tcp", "Up About an hour (healthy)"],
    ["2a17c0d9e431", "contracts-redis-1", "0.0.0.0:6379->6379/tcp", "Up About an hour"],
    ["7c4419ab02de", "contracts-otel-collector-1", "0.0.0.0:4317->4317/tcp", "Up 12 minutes (healthy)"],
    ["b03d8f1a9c72", "contracts-migrate-1", "", "Exited (0) 8 minutes ago"],
    ["e51a7d2b6f80", "contracts-web-1", "0.0.0.0:5173->5173/tcp", "Restarting (1) 3 seconds ago"],
  ], totalRows: 5 }, { durationMs: 120 });

/* ---- COMPOSE (docker compose up — lifecycle collapsed to terminal state) ---- */
const composeUp = mk("docker compose up -d", { kind: "compose", resources: [
  { type: "network", name: "contracts-prisma_default", state: "created" },
  { type: "volume", name: "nerdy-postgres-data", state: "created" },
  { type: "container", name: "contracts-prisma-postgres-1", state: "healthy" },
  { type: "container", name: "contracts-redis-1", state: "started" },
  { type: "container", name: "contracts-otel-collector-1", state: "started" },
], pull: { layers: 14, done: 14 } }, { durationMs: 18400, output:
  "Network contracts-prisma_default  Created\nContainer contracts-prisma-postgres-1  Started" });

const composeFail = mk("set -o pipefail; docker compose up", { kind: "compose", resources: [
  { type: "network", name: "app_default", state: "created" },
  { type: "container", name: "app-postgres-1", state: "started" },
  { type: "container", name: "app-migrate-1", state: "starting" },
  { type: "container", name: "app-web-1", state: "error" },
] }, { exit: 1, fail: true, durationMs: 9200, output:
  "Container app-web-1  Error\ndependency failed to start: container app-web-1 exited (1)" });

/* ============================================================
   ENVELOPE — the shared exec_command contract every renderer rides on
   ============================================================ */
const ENVELOPE = {
  schema:
`// Each timeline exec event is an (ev, out) pair.
interface ExecEvent {
  name: "exec_command";
  command_preview: string;   // "$ git diff dashboard/…"
  args: { cmd: string[] };   // argv, space-split
  ts: number;                // ms — event start
}

interface ExecResult {
  exit: number;              // process exit code
  fail: boolean;             // true when exit !== 0
  ts: number;                // ms — result ready
  output: string;            // raw stdout (ALWAYS present)
  outputRender: OutputRender | null;
                             // server-parsed structure;
                             // null ⇒ PlainOut(out.output)
}

// discriminated union, switched on .kind
type OutputRender =
  | DiffRender | FileRender | MatchesRender
  | HttpRender | TestsRender | StatusRender
  | TableRender;`,
  // preview → expand → modal → raw
  pipeline: ["server parse", "outputRender JSON", "renderer", "preview (capped)", "expand bar", "modal (full + scroll)", "RAW"],
};

/* ============================================================
   SPECS — one full sheet per renderer kind
   ============================================================ */
const SPECS = [
  {
    id: "diff", n: "01", group: "READING THE REPO", name: "DiffView", title: "DIFF", accent: "--cyan", accentName: "cyan",
    triggers: "git diff · git show",
    desc: "Per-file headers carry +/− counts; hunk headers render cyan; additions green, deletions red, context dimmed.",
    schema:
`interface DiffRender {
  kind: "diff";
  files: {
    path: string;
    added: number;     // +N  (green)
    removed: number;   // −N  (red)
    hunks: {
      header: string;  // "@@ -14,9 +14,16 @@ …"  (cyan)
      lines: {
        t: "ctx" | "add" | "del";
        text: string;
      }[];
    }[];
  }[];
}`,
    behavior: [
      ["Inline cap", "6 lines — flattened across every hunk"],
      ["Overflow", "+N lines"],
      ["Modal", "same DiffView · full · vertical scroll, no truncation"],
      ["Empty", "n/a — diff is never empty when emitted"],
    ],
    tokens: [["add", "--good"], ["del", "--warn-bright"], ["hunk", "--cyan"], ["ctx", "--ink-dim"]],
    states: [["TRUNCATED", "preview"], ["FITS INLINE", "ok"]],
    samples: [
      { label: "Diff · truncated", tone: "preview", note: "3 hunks · +38 −9 — capped at 6 → Expand opens full diff", s: diffBig },
      { label: "Diff · fits inline", tone: "ok", note: "Small diff under the cap — no expand bar", s: diffSmall },
    ],
  },
  {
    id: "file", n: "02", group: "READING THE REPO", name: "FileView", title: "FILE PEEK", accent: "--ink-strong", accentName: "ink",
    triggers: "nl · cat · sed -n · head",
    desc: "Highest-volume read path. Filename + line-range header, line-numbered gutter using REAL line numbers, mono body.",
    schema:
`interface FileRender {
  kind: "file";
  path: string;
  startLine: number;   // first line shown
  totalLines: number;  // full file length →
                       //   header "/ N" + overflow count
  lines: {
    n: number;         // real line number (gutter)
    text: string;
  }[];
}`,
    behavior: [
      ["Inline cap", "8 lines"],
      ["Overflow", "+N lines"],
      ["Modal", "same FileView · full · gutter alignment preserved"],
      ["Slices", "sed -n keeps true line numbers (e.g. L40–46)"],
    ],
    tokens: [["gutter", "--ink-faint"], ["body", "--ink"], ["path", "--ink-strong"]],
    states: [["FULL READ", "preview"], ["LINE SLICE", "ok"]],
    samples: [
      { label: "File · full read", tone: "preview", note: "412-line file — capped at 8 → Expand opens full peek", s: fileBig },
      { label: "File · line slice", tone: "ok", note: "sed -n '40,46p' — slice keeps real line numbers", s: fileSlice },
    ],
  },
  {
    id: "search", n: "03", group: "READING THE REPO", name: "MatchesView", title: "SEARCH", accent: "--good", accentName: "good",
    triggers: "rg · grep",
    desc: "Matches grouped by file — path header + per-file count, line# and the matched line with the hit slice emphasized.",
    schema:
`interface MatchesRender {
  kind: "matches";
  files: {
    path: string;
    matches: {
      n: number;             // line number
      text: string;
      col?: [number, number];
        // [start,end] slice to emphasize;
        // omit ⇒ whole line shown plain
    }[];
  }[];
}`,
    behavior: [
      ["Inline cap", "6 matches — total across files"],
      ["Overflow", "+N matches"],
      ["Modal", "same MatchesView · full · all files + hits"],
      ["Hit", "col slice rendered .hit (green, bold, tinted)"],
    ],
    tokens: [["path", "--good"], ["hit", "--good"], ["line#", "--ink-faint"], ["body", "--ink-dim"]],
    states: [["MULTI-FILE", "preview"], ["SINGLE FILE", "ok"]],
    samples: [
      { label: "Search · multi-file", tone: "preview", note: "8 hits / 3 files — capped at 6 → Expand opens rest", s: matchesMulti },
      { label: "Search · single file", tone: "ok", note: "2 hits, fits inline; matched term highlighted", s: matchesOne },
    ],
  },
  {
    id: "http", n: "08", group: "EXECUTION & DIAGNOSTICS", name: "HttpView", title: "HTTP", accent: "--cyan", accentName: "cyan",
    triggers: "curl · wget",
    desc: "Method + URL, status code colored by class, headers + timing, and a JSON-aware body preview.",
    schema:
`interface HttpRender {
  kind: "http";
  method: string;       // GET · POST · …
  url: string;
  status: number;       // 2xx grn·3xx cyn·4xx amb·5xx red
  statusText: string;
  durationMs: number;
  size: string;         // "142 B"
  contentType: string;
  json: boolean;        // true ⇒ body styled as JSON
  headers: { k: string; v: string }[];
  body: string;
}`,
    behavior: [
      ["Inline cap", "3 headers · 8 body lines"],
      ["Overflow", "\"headers + body\""],
      ["Modal", "same HttpView · full · every header + body"],
      ["Status", "code class drives color (s2/s3/s4/s5)"],
    ],
    tokens: [["2xx", "--good"], ["3xx", "--cyan"], ["4xx", "--amber"], ["5xx", "--warn-bright"]],
    states: [["200 OK", "ok"], ["503 ERROR", "fail"]],
    samples: [
      { label: "HTTP · 200 OK", tone: "ok", note: "GET 200 — JSON body, headers capped at 3 inline", s: httpOk },
      { label: "HTTP · 503 error", tone: "fail", note: "POST 503 — red status, slow (5s), retryable body", s: httpErr },
    ],
  },
  {
    id: "tests", n: "09", group: "EXECUTION & DIAGNOSTICS", name: "TestsView", title: "TESTS", accent: "--good", accentName: "good",
    triggers: "pytest · cargo · vitest · go test",
    desc: "Headline pass·fail·skip + duration; failing names listed. Failure reads loud, all-pass stays quiet.",
    schema:
`interface TestsRender {
  kind: "tests";
  passed: number;
  failed: number;     // 0 ⇒ quiet success styling
  skipped: number;
  durationMs: number;
  failing: string[];  // failing test names
}`,
    behavior: [
      ["Inline cap", "2 failing names"],
      ["Overflow", "+N failures"],
      ["Modal", "same TestsView · full · every failing name"],
      ["Success", "failed === 0 dims the block (data-ok)"],
    ],
    tokens: [["pass", "--good"], ["fail", "--warn-bright"], ["skip", "--ink-dim"], ["dur", "--ink-dim"]],
    states: [["FAILING", "fail"], ["ALL PASS", "ok"]],
    samples: [
      { label: "Tests · failing", tone: "fail", note: "exit 1 — failing names listed, +1 more in modal", s: testsFail },
      { label: "Tests · all pass", tone: "ok", note: "Quiet success, no failing list", s: testsPass },
    ],
  },
  {
    id: "status", n: "13", group: "STATE & FALLBACK", name: "StatusView", title: "GIT STATUS", accent: "--amber", accentName: "amber",
    triggers: "git status --short",
    desc: "File list with per-code glyph tones. Empty result renders nothing — a clean tree is silence.",
    schema:
`interface StatusRender {
  kind: "status";
  files: {
    code: "M" | "A" | "D" | "R" | "??";
      // M amber · A green · D red
      // R cyan · ?? faint
    path: string;
  }[];
}`,
    behavior: [
      ["Inline cap", "5 files"],
      ["Overflow", "+N files"],
      ["Modal", "same StatusView · full · every changed path"],
      ["Empty", "files: [] ⇒ no rows render (clean tree)"],
    ],
    tokens: [["M", "--amber"], ["A", "--good"], ["D", "--warn-bright"], ["R", "--cyan"], ["??", "--ink-faint"]],
    states: [["CHANGES", "preview"], ["CLEAN TREE", "empty"]],
    samples: [
      { label: "Status · changes", tone: "preview", note: "8 files — capped at 5 → Expand opens rest", s: statusBig },
      { label: "Status · clean tree", tone: "empty", note: "Empty result — no rows render", s: statusClean },
    ],
  },
  {
    id: "table", n: "07", group: "READING THE REPO", name: "TableView", title: "TABLE", accent: "--primary", accentName: "primary",
    triggers: "sqlite3 -column · docker ps · columnar",
    desc: "Aligned columns, header emphasis, tabular-nums cells, horizontal scroll for wide results. Columnar tool output (e.g. docker ps) rides this same renderer; a STATUS column earns a health dot.",
    schema:
`interface TableRender {
  kind: "table";
  columns: string[];
  rows: string[][];   // cell values (tabular-nums)
  totalRows: number;  // drives "+N rows" overflow
}`,
    behavior: [
      ["Inline cap", "6 rows"],
      ["Overflow", "+N rows  (totalRows − 6)"],
      ["Modal", "same TableView · full · scrolls H + V"],
      ["Wide", "horizontal scroll preserves column alignment"],
      ["Status dot", "docker STATUS col → green Up/healthy · red Exited/Restarting"],
    ],
    tokens: [["header", "--ink-dim"], ["cell", "--ink"], ["up · healthy", "--good"], ["exited", "--warn-bright"]],
    states: [["SMALL", "ok"], ["WIDE + TRUNCATED", "preview"], ["DOCKER · STATUS", "ok"]],
    samples: [
      { label: "Table · small", tone: "ok", note: "4 rows, fits inline", s: tableSmall },
      { label: "Table · wide + truncated", tone: "preview", note: "6-col / 50-row — capped, modal scrolls H+V", s: tableBig },
      { label: "Table · docker ps", tone: "ok", note: "Columnar docker output — STATUS column carries a health dot", s: tableDocker },
    ],
  },
  {
    id: "plain", n: "14", group: "STATE & FALLBACK", name: "PlainOut", title: "PLAIN", accent: "--ink-dim", accentName: "fallback",
    triggers: "fallback · parser miss",
    desc: "The catch-all when outputRender is null. Raw stdout in a <pre>, same preview→modal model. Secrets arrive pre-redacted.",
    schema:
`// No outputRender node — renders out.output.
// Reached when the server can't (or needn't)
// structure the result.
function PlainOut({ output, full }) {
  // 8 lines inline · full text in modal
}`,
    behavior: [
      ["Inline cap", "8 lines"],
      ["Overflow", "+N lines"],
      ["Modal", "full text, scrollable; also the RAW escape hatch"],
      ["Secrets", "redacted upstream — [REDACTED] preserved verbatim"],
    ],
    tokens: [["body", "--ink"], ["fail", "--warn"]],
    states: [["SHORT", "ok"], ["LONG + REDACTED", "preview"], ["FAILED", "fail"]],
    samples: [
      { label: "Plain · short", tone: "ok", note: "One line, no expand", s: plainShort },
      { label: "Plain · long + redacted", tone: "preview", note: "Capped at 8 lines; [REDACTED] secrets preserved", s: plainLong },
      { label: "Plain · failed", tone: "fail", note: "exit 1 — FAILED tag, warn border", s: plainFail },
    ],
  },
  {
    id: "tree", n: "04", group: "READING THE REPO", name: "TreeView", title: "DIRECTORY", accent: "--ink-strong", accentName: "ink",
    triggers: "ls -la · tree · find",
    desc: "Directory structure rather than contents — type glyphs, indent by depth, child counts for dirs and sizes for files.",
    schema:
`interface TreeRender {
  kind: "tree";
  root?: string;        // header path
  totalEntries: number; // drives "+N entries"
  entries: {
    name: string;
    type: "dir" | "file" | "link";
    depth: number;      // indent level (× 14px)
    size?: string;      // "8.2 KB"  (files)
    count?: number;     // child count (dirs)
  }[];
}`,
    behavior: [
      ["Inline cap", "8 entries"],
      ["Overflow", "+N entries  (totalEntries − 8)"],
      ["Modal", "same TreeView · full · whole listing"],
      ["Indent", "depth × 14px · dir ▸ · file · · link ↳"],
    ],
    tokens: [["dir", "--cyan"], ["link", "--amber"], ["file", "--ink"], ["size", "--ink-dim"]],
    states: [["LISTING", "preview"], ["SHALLOW", "ok"]],
    samples: [
      { label: "Directory · listing", tone: "preview", note: "19 entries — capped at 8; dirs, nesting + a symlink", s: treeBig },
      { label: "Directory · shallow", tone: "ok", note: "ls -la — fits inline, sizes right-aligned", s: treeSmall },
    ],
  },
  {
    id: "json", n: "05", group: "READING THE REPO", name: "JsonView", title: "JSON", accent: "--cyan", accentName: "cyan",
    triggers: "jq · cat *.json",
    desc: "Standalone structured data, pretty-printed and syntax-colored — keys, strings, numbers, keywords. The non-HTTP JSON path.",
    schema:
`interface JsonRender {
  kind: "json";
  source?: string;   // file / origin label
  value: unknown;    // any JSON value;
                     //   string ⇒ shown verbatim,
                     //   else JSON.stringify(·,null,2)
}`,
    behavior: [
      ["Inline cap", "8 lines — pretty-printed"],
      ["Overflow", "+N lines"],
      ["Modal", "same JsonView · full · scrollable"],
      ["String", "value:string rendered verbatim, no re-stringify"],
    ],
    tokens: [["key", "--cyan"], ["string", "--good"], ["number", "--amber"], ["keyword", "--primary"]],
    states: [["DOCUMENT", "preview"], ["FRAGMENT", "ok"]],
    samples: [
      { label: "JSON · document", tone: "preview", note: "package.json — pretty-printed, capped at 8 lines", s: jsonBig },
      { label: "JSON · fragment", tone: "ok", note: "jq slice — small object, fits inline", s: jsonSmall },
    ],
  },
  {
    id: "log", n: "06", group: "READING THE REPO", name: "LogView", title: "GIT LOG", accent: "--amber", accentName: "amber",
    triggers: "git log · git blame",
    desc: "Commit history — short hash, subject, author and relative date, with HEAD/branch refs chipped onto the latest entries.",
    schema:
`interface LogRender {
  kind: "log";
  total: number;       // full history length
  commits: {
    hash: string;      // short sha  (amber)
    author: string;
    date: string;      // relative — "3h ago"
    subject: string;
    refs?: string[];   // HEAD · main · tags
  }[];
}`,
    behavior: [
      ["Inline cap", "5 commits"],
      ["Overflow", "+N commits  (total − 5)"],
      ["Modal", "same LogView · full · every commit"],
      ["Refs", "ref chips · HEAD tinted green · graph rail"],
    ],
    tokens: [["hash", "--amber"], ["rail", "--primary"], ["HEAD", "--good"], ["meta", "--ink-faint"]],
    states: [["HISTORY", "preview"], ["RECENT", "ok"]],
    samples: [
      { label: "Git log · history", tone: "preview", note: "142 commits — capped at 5; HEAD/main refs chipped", s: logBig },
      { label: "Git log · recent", tone: "ok", note: "3 commits, fits inline", s: logSmall },
    ],
  },
  {
    id: "build", n: "10", group: "EXECUTION & DIAGNOSTICS", name: "BuildView", title: "BUILD", accent: "--warn-bright", accentName: "warn",
    triggers: "cargo build · tsc · go build · webpack",
    desc: "Compiler diagnostics with severity, error code and file:line:col. Errors carry a caret-underlined source snippet; a clean build stays quiet.",
    schema:
`interface BuildRender {
  kind: "build";
  tool: string;        // cargo · tsc · go
  errors: number;      // 0 ⇒ quiet success
  warnings: number;
  durationMs: number;
  diagnostics: {
    severity: "error" | "warning";
    code?: string;     // E0599 · TS2345 …
    file: string;
    line: number;
    col?: number;
    message: string;
    snippet?: {        // optional source context
      n: number;
      text: string;
      caret?: [number, number];
        // underline span on this line
    }[];
  }[];
}`,
    behavior: [
      ["Inline cap", "3 diagnostics"],
      ["Overflow", "+N diagnostics"],
      ["Modal", "same BuildView · full · every diagnostic + snippet"],
      ["Success", "errors === 0 ⇒ quiet · '✓ clean'"],
    ],
    tokens: [["error", "--warn-bright"], ["warning", "--amber"], ["caret", "--warn-bright"], ["loc", "--ink-dim"]],
    states: [["ERRORS", "fail"], ["CLEAN", "ok"]],
    samples: [
      { label: "Build · failing", tone: "fail", note: "exit 101 — 2 errors w/ caret-underlined source, capped at 3", s: buildFail },
      { label: "Build · clean", tone: "ok", note: "0 errors / 0 warnings — quiet success", s: buildOk },
    ],
  },
  {
    id: "lint", n: "11", group: "EXECUTION & DIAGNOSTICS", name: "LintView", title: "LINT", accent: "--amber", accentName: "amber",
    triggers: "eslint · ruff · clippy",
    desc: "Linter findings grouped by file — severity dot, location, message and rule id. A hybrid of the search and tests views.",
    schema:
`interface LintRender {
  kind: "lint";
  tool: string;        // eslint · ruff · clippy
  errors: number;
  warnings: number;
  files: {
    path: string;
    issues: {
      severity: "error" | "warning" | "info";
      line: number;
      col: number;
      rule: string;    // rule id (right-aligned)
      message: string;
    }[];
  }[];
}`,
    behavior: [
      ["Inline cap", "6 issues — total across files"],
      ["Overflow", "+N issues"],
      ["Modal", "same LintView · full · every file + issue"],
      ["Clean", "no errors/warnings ⇒ '✓ clean'"],
    ],
    tokens: [["error", "--warn-bright"], ["warning", "--amber"], ["info", "--ink-dim"], ["rule", "--ink-faint"]],
    states: [["ISSUES", "preview"], ["CLEAN", "ok"]],
    samples: [
      { label: "Lint · issues", tone: "preview", note: "8 issues / 3 files — capped at 6 → Expand opens rest", s: lintIssues },
      { label: "Lint · clean", tone: "ok", note: "ruff — no issues, '✓ clean'", s: lintClean },
    ],
  },
  {
    id: "trace", n: "12", group: "EXECUTION & DIAGNOSTICS", name: "TraceView", title: "STACK TRACE", accent: "--warn-bright", accentName: "warn",
    triggers: "panic · uncaught exception",
    desc: "Stack traces and panics. Your frames are emphasized, library frames dimmed and collapsed behind a ⋯ marker — the error site reads first.",
    schema:
`interface TraceRender {
  kind: "trace";
  lang: "python" | "rust" | "node";
  exception: string;   // KeyError · panicked
  message: string;
  frames: {            // outermost → innermost;
                       //   LAST frame = error site
    fn: string;
    file: string;
    line: number;
    user: boolean;     // true ⇒ your code (emphasized)
    code?: string;     // source line at the frame
  }[];
}`,
    behavior: [
      ["Inline cap", "3 frames — innermost kept"],
      ["Overflow", "+N frames · ⋯ marker at top"],
      ["Modal", "same TraceView · full · every frame"],
      ["Frames", "user:true emphasized · library frames dimmed"],
    ],
    tokens: [["exception", "--warn-bright"], ["user", "--warn-bright"], ["library", "--ink-dim"], ["code", "--ink"]],
    states: [["PYTHON", "fail"], ["RUST PANIC", "fail"]],
    samples: [
      { label: "Trace · Python", tone: "fail", note: "KeyError — innermost 3 frames; ⋯ marks the elided outer frame", s: tracePy },
      { label: "Trace · Rust panic", tone: "fail", note: "unwrap() on Err — user frames emphasized", s: traceRust },
    ],
  },
  {
    id: "git", n: "15", group: "VERSION CONTROL", name: "GitView", title: "GIT OPS", accent: "--amber", accentName: "amber",
    triggers: "git commit · add · merge · worktree · branch",
    desc: "One card whose body switches on subcommand — commit rides the log-row, add the status list, merge embeds a diffstat (#16), worktree collapses to a call-line and branch to a chip pair. Heavy reuse, little new glue.",
    schema:
`interface GitRender {
  kind: "git";
  sub: "commit" | "add" | "merge"
     | "worktree" | "branch";

  // sub: commit  → log-row + stat chip
  branch?: string; shortSha?: string;
  subject?: string; filesChanged?: number;
  insertions?: number; deletions?: number;

  // sub: add     → staged path list
  staged?: string[];

  // sub: merge   → result line + diffstat
  strategy?: string; fastForward?: boolean;
  conflict?: string; diffstat?: DiffstatRender;

  // sub: worktree → call-line + ok/fail
  path?: string; head?: string;
  ok?: boolean; error?: string;

  // sub: branch  → branch · sha chips
  sha?: string;
}`,
    behavior: [
      ["Inline cap", "add 6 paths · merge 6 files · others 1 line"],
      ["Overflow", "+N files  (add / merge bodies only)"],
      ["Modal", "same GitView · full · every path / diffstat row"],
      ["Reuse", "commit→log-row · add→status list · merge→#16"],
      ["Worktree", "call-line one-liner · ok/fail chip + HEAD"],
    ],
    tokens: [["commit / sha", "--amber"], ["add", "--good"], ["worktree", "--cyan"], ["conflict", "--warn-bright"], ["meta", "--ink-dim"]],
    states: [["COMMIT", "ok"], ["ADD", "preview"], ["MERGE", "preview"], ["WORKTREE", "ok"], ["FAILURE", "fail"]],
    samples: [
      { label: "git commit", tone: "ok", note: "Log-row one-liner — sha · branch · subject + +67 −33 · 5 files", s: gitCommit },
      { label: "git add", tone: "preview", note: "8 staged paths — capped at 6; '+ staged N files' header", s: gitAdd },
      { label: "git merge", tone: "preview", note: "Result line above an embedded #16 diffstat", s: gitMerge },
      { label: "git worktree · ok", tone: "ok", note: "Call-line — branch + ready chip + HEAD sha", s: gitWorktree },
      { label: "git worktree · fail", tone: "fail", note: "fatal: cannot lock ref — red fail chip", s: gitWorktreeFail },
      { label: "git branch · rev-parse", tone: "ok", note: "Two chips — current branch · short sha", s: gitBranch },
    ],
  },
  {
    id: "diffstat", n: "16", group: "VERSION CONTROL", name: "DiffstatView", title: "DIFFSTAT", accent: "--cyan", accentName: "cyan",
    triggers: "git diff --stat · git show --stat",
    desc: "A changed-files summary without hunks — per-file +ins/−del with a small proportional add/del bar (scaled to the busiest file), plus a footer total. A trim of the diff file-header; also embedded by git merge.",
    schema:
`interface DiffstatRender {
  kind: "diffstat";
  files: {
    path: string;
    insertions: number;  // +N  (green)
    deletions: number;   // −M  (red)
  }[];
  totals: {
    files: number;
    insertions: number;
    deletions: number;
  };
}`,
    behavior: [
      ["Inline cap", "6 files"],
      ["Overflow", "+N files  (files − 6)"],
      ["Modal", "same DiffstatView · full · every file + total"],
      ["Bar", "▰ glyphs · green/red split scaled to busiest file"],
      ["Embedded", "reused inside GitView · sub merge"],
    ],
    tokens: [["insertions", "--good"], ["deletions", "--warn-bright"], ["path", "--ink-strong"], ["total", "--ink-dim"]],
    states: [["MULTI-FILE", "preview"], ["SINGLE FILE", "ok"]],
    samples: [
      { label: "Diffstat · multi-file", tone: "preview", note: "7 files — capped at 6; proportional add/del bars", s: diffstatBig },
      { label: "Diffstat · single file", tone: "ok", note: "git show --stat HEAD — one file, +116 −7", s: diffstatSmall },
    ],
  },
  {
    id: "compose", n: "17", group: "EXECUTION & DIAGNOSTICS", name: "ComposeView", title: "COMPOSE", accent: "--cyan", accentName: "cyan",
    triggers: "docker compose up · pipefail QA blocks",
    desc: "Collapses the streaming compose-up log into one row per resource at its terminal state — reusing the status dot vocabulary (green Started/Healthy · amber Creating/Starting · red Error). Hundreds of image-pull lines fold into a single summary chip.",
    schema:
`interface ComposeRender {
  kind: "compose";
  resources: {
    type: "network" | "volume"
        | "container" | "image";
    name: string;        // project prefix stripped
    state: "creating" | "created"
         | "starting" | "started"
         | "recreated" | "healthy" | "error";
  }[];
  pull?: {               // image layers, collapsed
    layers: number;
    done: number;
  };
}`,
    behavior: [
      ["Inline cap", "5 resources"],
      ["Overflow", "+N resources"],
      ["Modal", "same ComposeView · full · every resource"],
      ["Dedup", "8-line container churn → one terminal-state row"],
      ["Pull", "200-line layer stream → one '14/14 pulled' chip"],
    ],
    tokens: [["started · healthy", "--good"], ["starting", "--amber"], ["error", "--warn-bright"], ["pull", "--cyan"]],
    states: [["STACK UP", "ok"], ["DEPENDENCY ERROR", "fail"]],
    samples: [
      { label: "compose · stack up", tone: "ok", note: "5 resources at terminal state + a 14/14 layers-pulled chip", s: composeUp },
      { label: "compose · dependency error", tone: "fail", note: "exit 1 — postgres up · migrate still starting · web errored (red dot)", s: composeFail },
    ],
  },
];

Object.assign(window, { EXEC_SPECS: SPECS, EXEC_ENVELOPE: ENVELOPE });
