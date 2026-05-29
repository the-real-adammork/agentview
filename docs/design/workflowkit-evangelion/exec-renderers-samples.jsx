/* Exec Renderers component library — sample data + showcase app.
   Loads the REAL renderers from exec-renderers.jsx (shared with the dashboard). */

const { useState } = React;

// helper to build an (ev, out) pair; ts in ms so the modal shows duration = out.ts
const pair = (cmd, render, opts = {}) => ({
  ev: { name: "exec_command", command_preview: cmd, args: { cmd: cmd.split(" ") }, ts: 0 },
  out: { exit: opts.exit ?? 0, fail: !!opts.fail, ts: opts.durationMs ?? 1200, output: opts.output || "", outputRender: render },
});

/* ---- DIFF samples ---- */
const diffBig = pair("git diff dashboard/timeline.tsx", { kind: "diff", files: [
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
    { header: "@@ -88,3 +110,9 @@ function EventRow({ e }) {", lines: [
      { t: "add", text: "  if (e.outputRender?.kind === \"diff\") return <DiffView r={e.outputRender} />;" },
      { t: "add", text: "  if (e.outputRender?.kind === \"tests\") return <TestsView r={e.outputRender} />;" },
      { t: "ctx", text: "  return <PlainOut out={e.output} />;" },
    ] },
  ] },
] }, { durationMs: 240 });

const diffSmall = pair("git diff README.md", { kind: "diff", files: [
  { path: "README.md", added: 2, removed: 1, hunks: [
    { header: "@@ -1,4 +1,5 @@", lines: [
      { t: "ctx", text: "# Observatory" },
      { t: "del", text: "A dashboard." },
      { t: "add", text: "A read-only dashboard for Codex agent sessions." },
      { t: "add", text: "" },
    ] },
  ] },
] }, { durationMs: 90 });

/* ---- TESTS samples ---- */
const testsFail = pair("pytest -q tests/", { kind: "tests", passed: 42, failed: 3, skipped: 1, durationMs: 6200, failing: [
  "tests/test_parser.py::test_lazy_resume_after_token_count",
  "tests/test_tokens.py::test_negative_delta_guard",
  "tests/test_db.py::test_wal_busy_timeout_retry",
] }, { exit: 1, fail: true, durationMs: 6200 });

const testsPass = pair("cargo test", { kind: "tests", passed: 128, failed: 0, skipped: 2, durationMs: 3400, failing: [] }, { durationMs: 3400 });

/* ---- STATUS samples ---- */
const statusBig = pair("git status --short", { kind: "status", files: [
  { code: "M", path: "dashboard/app.tsx" },
  { code: "M", path: "dashboard/styles.css" },
  { code: "A", path: "dashboard/overview.tsx" },
  { code: "A", path: "dashboard/timeline.tsx" },
  { code: "D", path: "dashboard/legacy_list.tsx" },
  { code: "R", path: "dashboard/graph.tsx → dashboard/agent_graph.tsx" },
  { code: "??", path: "scratch/notes.md" },
  { code: "??", path: "scratch/query.sql" },
] }, { durationMs: 40 });

const statusClean = pair("git status --short", { kind: "status", files: [] }, { durationMs: 30 });

/* ---- TABLE samples ---- */
const tableSmall = pair("sqlite3 logs_2.sqlite \"SELECT target, COUNT(*) …\"", { kind: "table",
  columns: ["target", "warnings"],
  rows: [["codex_core_skills::loader","14"],["codex_api::sse::responses","6"],["codex_otel.log_only","3"],["codex_core::session::handlers","2"]],
  totalRows: 4 }, { durationMs: 120 });

const tableBig = pair("sqlite3 state_5.sqlite \"SELECT * FROM threads LIMIT 50\"", { kind: "table",
  columns: ["id", "agent_nickname", "role", "tokens", "depth", "status"],
  rows: Array.from({ length: 14 }).map((_, i) => [
    "0BM2" + (1000 + i), ["ARCHIMEDES","SOCRATES","BORGES","HYPATIA","TURING","EUCLID","FERMI"][i % 7],
    ["researcher","worker"][i % 2], String(2000 + i * 1731), String(1 + (i % 3)), ["open","closed","failed"][i % 3],
  ]), totalRows: 50 }, { durationMs: 310 });

/* ---- PLAIN samples ---- */
const plainShort = pair("echo $CODEX_HOME", null, { output: "/Users/adam/.codex", durationMs: 12 });
const plainLong = pair("cat ~/.codex/config.toml", null, { durationMs: 30, output:
  "[model]\nname = \"o4\"\nreasoning_effort = \"high\"\n\n[sandbox]\nmode = \"read-only\"\napproval = \"never\"\n\n[telemetry]\notel_endpoint = \"http://localhost:4317\"\nlog_level = \"warn\"\nsample_rate = 0.1\n\n[secrets]\nOPENAI_API_KEY = \"[REDACTED]\"\nGITHUB_TOKEN = \"[REDACTED]\"\n\n[paths]\nsessions = \"~/.codex/sessions\"\nstate_db = \"~/.codex/state_5.sqlite\"\nlogs_db = \"~/.codex/logs_2.sqlite\"" });

const plainFail = pair("sqlite3 logs_2.sqlite \"SELECT …\"", null, { exit: 1, fail: true, durationMs: 60, output: "Error: database is locked\n  at sqlite3_step (codex_core::db::query)\n  retry with -readonly flag" });

/* ---- FILE PEEK samples ---- */
const fileBig = pair("nl -ba dashboard/overview.tsx", { kind: "file", path: "dashboard/overview.tsx", startLine: 1, totalLines: 412, lines: [
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

const fileSlice = pair("sed -n '40,46p' src/db.rs", { kind: "file", path: "src/db.rs", startLine: 40, totalLines: 218, lines: [
  { n: 40, text: "pub fn open_readonly(path: &Path) -> Result<Connection> {" },
  { n: 41, text: "    let conn = Connection::open_with_flags(" },
  { n: 42, text: "        path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;" },
  { n: 43, text: "    conn.busy_timeout(Duration::from_millis(5000))?;" },
  { n: 44, text: "    conn.pragma_update(None, \"journal_mode\", \"WAL\")?;" },
  { n: 45, text: "    Ok(conn)" },
  { n: 46, text: "}" },
] }, { durationMs: 22 });

/* ---- SEARCH (matches) samples ---- */
const matchesMulti = pair("rg -n outputRender dashboard/", { kind: "matches", files: [
  { path: "dashboard/EventRow.tsx", matches: [
    { n: 88, text: "  if (e.outputRender?.kind === \"diff\") return <DiffView r={e.outputRender} />;", col: [9, 21] },
    { n: 89, text: "  if (e.outputRender?.kind === \"tests\") return <TestsView r={e.outputRender} />;", col: [9, 21] },
    { n: 96, text: "  return e.outputRender ? <ExecOutput out={e} /> : <PlainOut out={e.output} />;", col: [11, 23] },
  ] },
  { path: "dashboard/exec-renderers.tsx", matches: [
    { n: 130, text: "  const r = out.outputRender;", col: [14, 26] },
    { n: 131, text: "  const kind = r ? r.kind : \"plain\";", col: [13, 14] },
  ] },
  { path: "dashboard/types.ts", matches: [
    { n: 42, text: "  outputRender?: OutputRender;  // server-parsed structured output", col: [2, 14] },
    { n: 51, text: "export type OutputRender =", col: [12, 24] },
    { n: 58, text: "  | { kind: \"plain\" };", col: [4, 8] },
  ] },
] }, { durationMs: 180 });

const matchesOne = pair("grep -n TODO src/db.rs", { kind: "matches", files: [
  { path: "src/db.rs", matches: [
    { n: 44, text: "    // TODO: make busy_timeout configurable", col: [7, 11] },
    { n: 92, text: "    // TODO: pool connections for concurrent readers", col: [7, 11] },
  ] },
] }, { durationMs: 24 });

/* ---- HTTP (curl / wget) samples ---- */
const httpOk = pair("curl -sS http://localhost:4317/v1/health", { kind: "http", method: "GET", url: "http://localhost:4317/v1/health", status: 200, statusText: "OK", durationMs: 38, size: "142 B", contentType: "application/json", json: true,
  headers: [
    { k: "content-type", v: "application/json" },
    { k: "x-otel-collector", v: "running" },
    { k: "date", v: "Thu, 29 May 2026 12:51:09 GMT" },
    { k: "content-length", v: "142" },
  ],
  body: "{\n  \"status\": \"healthy\",\n  \"uptime_s\": 84211,\n  \"exporters\": { \"otlp\": \"ok\", \"logging\": \"ok\" },\n  \"queue_depth\": 0\n}" }, { durationMs: 38 });

const httpErr = pair("curl -sS https://api.internal/v2/threads", { kind: "http", method: "POST", url: "https://api.internal/v2/threads", status: 503, statusText: "Service Unavailable", durationMs: 5021, size: "88 B", contentType: "application/json", json: true,
  headers: [
    { k: "content-type", v: "application/json" },
    { k: "retry-after", v: "30" },
    { k: "x-request-id", v: "req_8f21ac" },
  ],
  body: "{\n  \"error\": \"upstream_unavailable\",\n  \"detail\": \"state_5 db locked\",\n  \"retryable\": true\n}" }, { exit: 22, fail: true, durationMs: 5021 });

/* ---- the showcase ---- */
function Card({ title, sample, tone, note, onOpen }) {
  const { ev, out } = sample;
  return (
    <div className="spec">
      <div className="stitle">
        <span className="dot"></span>
        <span className="nm">{title}</span>
        <span className="st" data-tone={tone}>{tone === "fail" ? "FAILURE" : tone === "ok" ? "SUCCESS" : tone === "empty" ? "EMPTY" : "PREVIEW"}</span>
      </div>
      <div className="stage">
        <div className={"ev-faux" + (out.fail ? " fail" : "")}>
          <div className="head">
            <span className="who">▸ EXEC_COMMAND</span>
            <span className="cmd">$ {ev.command_preview}</span>
          </div>
          <ExecOutput out={out} onExpand={() => onOpen(sample)} />
        </div>
      </div>
      <div className="notes">
        <span><b>{note}</b></span>
        <span className="pill" onClick={() => onOpen(sample)}>Open modal ⤢</span>
      </div>
    </div>
  );
}

function Showcase() {
  const [modal, setModal] = useState(null);
  const open = (s) => setModal(s);
  return (
    <div className="lib">
      <header className="lib-head">
        <div className="mark"></div>
        <div>
          <h1>EXEC RENDERERS</h1>
          <div className="sub">// Timeline output renderers · component library</div>
        </div>
        <div className="meta">
          <div><b>SOURCE</b> exec-renderers.jsx</div>
          <div><b>KINDS</b> diff · tests · status · table · plain</div>
          <div><b>USED BY</b> <a href="Observatory.html">Observatory ↗</a></div>
        </div>
      </header>

      <div className="intro">
        <b>One pipeline, reusable UI.</b> The server parses each <code>exec_command</code> result once into
        structured <code>outputRender</code> JSON; the frontend renders it with these components — no client-side
        parsing. Each renders a <b>capped inline preview</b>; overflow shows an <b>Expand</b> bar that opens the
        <b> modal</b> with the full, scrollable output (same renderer) plus a <code>RAW</code> escape hatch.
        <div className="flow">
          <span className="box">server parse</span>
          <span className="arr">→</span>
          <span className="box">outputRender JSON</span>
          <span className="arr">→</span>
          <span className="box accent">renderer component</span>
          <span className="arr">→</span>
          <span className="box">preview → modal</span>
        </div>
      </div>

      <section className="cat" id="diff">
        <header>
          <div className="n">01</div>
          <div><h2>Diff</h2><div className="d">git diff / git show. Per-file headers with +/− counts, cyan hunk headers, green additions / red deletions. Inline caps at 6 lines.</div></div>
          <div className="tag">git diff · git show</div>
        </header>
        <div className="grid cols-2">
          <Card title="Diff · truncated" sample={diffBig} tone="preview" note="3 hunks, +38 −9 — capped → Expand opens full diff" onOpen={open} />
          <Card title="Diff · fits inline" sample={diffSmall} tone="ok" note="Small diff, no overflow, no expand bar" onOpen={open} />
        </div>
      </section>

      <section className="cat" id="file">
        <header>
          <div className="n">02</div>
          <div><h2>File Peek</h2><div className="d">nl / cat / sed -n / head — the highest-volume read commands. Filename + line-range header, line-numbered gutter, mono body. Inline caps at 8 lines.</div></div>
          <div className="tag">nl · cat · sed -n · head</div>
        </header>
        <div className="grid cols-2">
          <Card title="File · full read" sample={fileBig} tone="preview" note="412-line file — capped at 8 → Expand opens full peek" onOpen={open} />
          <Card title="File · line slice" sample={fileSlice} tone="ok" note="sed -n '40,46p' — slice keeps real line numbers" onOpen={open} />
        </div>
      </section>

      <section className="cat" id="search">
        <header>
          <div className="n">03</div>
          <div><h2>Search</h2><div className="d">rg / grep. Matches grouped by file — path header with per-file count, line# + the matching line with the hit emphasized. Inline caps at 6 matches.</div></div>
          <div className="tag">rg · grep</div>
        </header>
        <div className="grid cols-2">
          <Card title="Search · multi-file" sample={matchesMulti} tone="preview" note="8 hits / 3 files — capped at 6 → Expand opens rest" onOpen={open} />
          <Card title="Search · single file" sample={matchesOne} tone="ok" note="2 hits, fits inline; matched term highlighted" onOpen={open} />
        </div>
      </section>

      <section className="cat" id="http">
        <header>
          <div className="n">04</div>
          <div><h2>HTTP</h2><div className="d">curl / wget. Method + URL, status code colored by class (2xx green · 3xx cyan · 4xx amber · 5xx red), headers + timing, JSON-aware body preview.</div></div>
          <div className="tag">curl · wget</div>
        </header>
        <div className="grid cols-2">
          <Card title="HTTP · 200 OK" sample={httpOk} tone="ok" note="GET 200 — JSON body, headers capped at 3 inline" onOpen={open} />
          <Card title="HTTP · 503 error" sample={httpErr} tone="fail" note="POST 503 — red status, slow (5s), retryable body" onOpen={open} />
        </div>
      </section>

      <section className="cat" id="tests">
        <header>
          <div className="n">05</div>
          <div><h2>Tests</h2><div className="d">pytest / cargo test / vitest / go test. Headline pass·fail·skip + duration; failing names listed. Failure reads loud, all-pass quiet.</div></div>
          <div className="tag">test runners</div>
        </header>
        <div className="grid cols-2">
          <Card title="Tests · failing" sample={testsFail} tone="fail" note="exit 1 — failing names listed, +1 more in modal" onOpen={open} />
          <Card title="Tests · all pass" sample={testsPass} tone="ok" note="Quiet success, no failing list" onOpen={open} />
        </div>
      </section>

      <section className="cat" id="status">
        <header>
          <div className="n">06</div>
          <div><h2>Git Status</h2><div className="d">git status --short. File list with per-code glyph tones — M amber · A green · D red · R cyan · ?? faint. Inline caps at 5.</div></div>
          <div className="tag">git status --short</div>
        </header>
        <div className="grid cols-2">
          <Card title="Status · changes" sample={statusBig} tone="preview" note="8 files — capped at 5 → Expand opens rest" onOpen={open} />
          <Card title="Status · clean tree" sample={statusClean} tone="empty" note="Empty result — no rows render" onOpen={open} />
        </div>
      </section>

      <section className="cat" id="table">
        <header>
          <div className="n">07</div>
          <div><h2>Table</h2><div className="d">sqlite3 -column / columnar output. Aligned columns, header emphasis, row count, horizontal scroll for wide results. Inline caps at 6 rows.</div></div>
          <div className="tag">sqlite3 · columnar</div>
        </header>
        <div className="grid cols-2">
          <Card title="Table · small" sample={tableSmall} tone="ok" note="4 rows, fits inline" onOpen={open} />
          <Card title="Table · wide + truncated" sample={tableBig} tone="preview" note="6-col / 50-row — capped, modal scrolls H+V" onOpen={open} />
        </div>
      </section>

      <section className="cat" id="plain">
        <header>
          <div className="n">08</div>
          <div><h2>Plain</h2><div className="d">Fallback for everything else (and parser misses). Today's &lt;pre&gt; preview, same preview→modal model. Secrets arrive pre-redacted.</div></div>
          <div className="tag">fallback</div>
        </header>
        <div className="grid cols-2">
          <Card title="Plain · short" sample={plainShort} tone="ok" note="One line, no expand" onOpen={open} />
          <Card title="Plain · long + redacted" sample={plainLong} tone="preview" note="Capped at 8 lines; [REDACTED] secrets preserved" onOpen={open} />
          <Card title="Plain · failed" sample={plainFail} tone="fail" note="exit 1 — FAILED tag, warn border" onOpen={open} />
        </div>
      </section>

      <div className="lib-footer">
        <div>// WORKFLOWKIT · OBSERVATORY</div>
        <div className="center">EXEC RENDERERS · 出力描画</div>
        <div style={{ textAlign: "right" }}>v0.3 · 2026.05.29</div>
      </div>

      {modal && <ExecModal ev={modal.ev} out={modal.out} onClose={() => setModal(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Showcase />);
