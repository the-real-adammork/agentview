/* WorkflowKit Observatory — mock data
   Loosely simulates what state_5.sqlite.threads + rollout JSONL + logs_2 would surface. */

(function () {
  // helpers
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const fmtTimeMs = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${fmtTime(d)}`;
  const now = new Date("2026-05-26T18:04:00Z");

  // 8 nicknames mapped to roles
  const NICKS = [
    "ARCHIMEDES", "SOCRATES", "BORGES", "HYPATIA", "FERMI", "TURING",
    "EUCLID", "DESCARTES", "GODEL", "RAMANUJAN", "LOVELACE", "BABBAGE",
    "PAULI", "DIRAC", "RIEMANN", "PASCAL", "FEYNMAN", "NOETHER",
  ];

  // session ID generator (uuid-7 style)
  const uid = (i) => {
    const a = ("019e" + (1000 + i).toString(16)).slice(0, 4) + ("65" + (i*7).toString(16).padStart(2,"0")).slice(0,2);
    const b = (3000 + i * 13).toString(16).padStart(4, "0");
    const c = (7700 + i * 17).toString(16).padStart(4, "0");
    const d = (9000 + i * 31).toString(16).padStart(4, "0");
    const e = (i * 91 + 1542000000).toString(16).padStart(12, "0");
    return `${a.padEnd(8,"0")}-${b}-${c}-${d}-${e.slice(0,12)}`;
  };

  const repos = [
    { cwd: "~/code/workflowkit", branch: "main", origin: "git@github.com:adam/workflowkit.git", sha: "a9b2c10" },
    { cwd: "~/code/workflowkit", branch: "feat/observatory", origin: "git@github.com:adam/workflowkit.git", sha: "f3e1d22" },
    { cwd: "~/code/codex-cli", branch: "main", origin: "git@github.com:openai/codex.git", sha: "84d72e0" },
    { cwd: "~/code/lattice", branch: "agent-graph", origin: "git@github.com:adam/lattice.git", sha: "c0ffee1" },
    { cwd: "~/code/observatory-ui", branch: "main", origin: "git@github.com:adam/observatory-ui.git", sha: "1234abc" },
    { cwd: "~/sandbox/scratch-026", branch: "(detached)", origin: null, sha: "df00d11" },
    { cwd: "~/code/maginet", branch: "spike/ingest", origin: "git@github.com:adam/maginet.git", sha: "9081726" },
  ];

  const models = [
    { model: "claude-opus-5", effort: "high" },
    { model: "claude-sonnet-4.5", effort: "medium" },
    { model: "claude-sonnet-4.5", effort: "low" },
    { model: "claude-haiku-4.5", effort: "low" },
    { model: "gpt-codex-5", effort: "high" },
  ];

  // base session titles
  const TITLES = [
    "Wire state_5.sqlite session index into dashboard ingest",
    "Refactor rollout JSONL parser to stream by byte offset",
    "Investigate stuck backfill job (last_watermark stalled)",
    "Add agent graph view backed by thread_spawn_edges",
    "Token snapshot chart — handle cached_input_tokens correctly",
    "Diagnose plugin loader warnings in codex_core_skills",
    "Test fixture: synthesize a sub-agent tree of depth 3",
    "Migrate dashboard preview to local file:// transport",
    "Sweep failing shell commands and surface exit codes",
    "Spike: live tail of rollout files via fs.watch",
    "Compare reasoning_effort=high vs medium on bench-04",
    "Bug: token_count event missing on resumed sessions",
    "Add rate-limit reset countdown badge to header",
    "Document state_5 vs logs_2 ingestion ordering",
    "Wire 'open in editor' from session row to rollout path",
    "Audit which tool names actually appear in rollouts",
    "Privacy pass: redact env vars from tool args preview",
    "Compute time-to-first-token from task_started → first chunk",
  ];

  const firstMsgs = [
    "build a dashboard that reads /Users/adam/.codex and shows sessions, agent trees, and warnings",
    "the parser is OOMing on big rollouts. fix it by streaming",
    "backfill state hasn't moved in 6 hours. why",
    "i want to see the parent/child agent relationship as a graph",
    "the token graph is wrong when cached_input is > 0",
    "ignore plugin loader warnings unless level >= WARN",
    "generate a fixture with 3 levels of spawn_agent",
    "open the html with file:// not localhost, please",
    "show me failed shell commands across all sessions today",
    "tail an active rollout file in real time",
    "rerun the bench at effort=high and diff the totals",
    "no token_count appears after resume — fix it",
    "i can never tell when my rate limit resets",
    "remind me which db has what",
    "clicking a row should open the rollout in $EDITOR",
    "list every tool name we've ever seen in jsonl",
    "anything that looks like a secret in tool args should be redacted",
    "report ttft for each turn",
  ];

  // build sessions
  function makeSessions() {
    const arr = [];
    for (let i = 0; i < 22; i++) {
      const r = repos[i % repos.length];
      const m = models[i % models.length];
      const isSub = i >= 14;
      const updated = new Date(now.getTime() - (i * 1000 * 60 * 7 + Math.random() * 60000));
      const created = new Date(updated.getTime() - (1000 * 60 * (5 + Math.random() * 90)));
      const tokens = Math.round(2400 + Math.random() * (i < 5 ? 180000 : 60000));
      const warn = Math.random() < 0.45 ? Math.round(Math.random() * (i === 0 ? 18 : 6)) : 0;
      const failedTools = Math.random() < 0.3 ? Math.round(Math.random() * 4) : 0;
      const id = uid(i);
      arr.push({
        id,
        rollout_path: `~/.codex/sessions/2026/05/26/rollout-${fmtDate(created).replace(/[: ]/g, "-")}-${id}.jsonl`,
        created_at: created,
        updated_at: updated,
        cwd: r.cwd,
        title: TITLES[i % TITLES.length],
        first_user_message: firstMsgs[i % firstMsgs.length],
        preview: TITLES[i % TITLES.length].slice(0, 80),
        model: m.model,
        reasoning_effort: m.effort,
        tokens_used: tokens,
        thread_source: isSub ? "subagent" : "user",
        agent_nickname: isSub ? NICKS[i % NICKS.length] : null,
        agent_role: isSub ? (Math.random() < 0.5 ? "worker" : "researcher") : null,
        git_sha: r.sha,
        git_branch: r.branch,
        git_origin_url: r.origin,
        archived: i > 18,
        children: 0,
        children_open: 0,
        warnings: warn,
        failed_tools: failedTools,
        ttft_ms: Math.round(400 + Math.random() * 2400),
        duration_ms: Math.round((1000 + Math.random() * 240000)),
        approval: i % 3 === 0 ? "on-failure" : "never",
        sandbox: i % 4 === 0 ? "workspace-write" : "read-only",
        parent_id: null,
      });
    }
    return arr;
  }

  const sessions = makeSessions();

  // agent edges: session 0 is the parent of a few sub-agents
  const parent = sessions[0];
  const subA = sessions[14]; subA.parent_id = parent.id; subA.agent_nickname = "ARCHIMEDES"; subA.agent_role = "researcher";
  const subB = sessions[15]; subB.parent_id = parent.id; subB.agent_nickname = "SOCRATES"; subB.agent_role = "worker";
  const subC = sessions[16]; subC.parent_id = parent.id; subC.agent_nickname = "BORGES"; subC.agent_role = "worker";
  const subD = sessions[17]; subD.parent_id = subA.id; subD.agent_nickname = "HYPATIA"; subD.agent_role = "worker";
  const subE = sessions[18]; subE.parent_id = subA.id; subE.agent_nickname = "FERMI"; subE.agent_role = "researcher";
  const subF = sessions[19]; subF.parent_id = subB.id; subF.agent_nickname = "TURING"; subF.agent_role = "worker";
  const subG = sessions[20]; subG.parent_id = subB.id; subG.agent_nickname = "EUCLID"; subG.agent_role = "worker";
  const subH = sessions[21]; subH.parent_id = subC.id; subH.agent_nickname = "DESCARTES"; subH.agent_role = "researcher";

  const edges = [
    { parent: parent.id, child: subA.id, status: "closed" },
    { parent: parent.id, child: subB.id, status: "open" },
    { parent: parent.id, child: subC.id, status: "closed" },
    { parent: subA.id, child: subD.id, status: "closed" },
    { parent: subA.id, child: subE.id, status: "closed" },
    { parent: subB.id, child: subF.id, status: "open" },
    { parent: subB.id, child: subG.id, status: "closed" },
    { parent: subC.id, child: subH.id, status: "closed" },
  ];

  // compute children counts
  edges.forEach((e) => {
    const p = sessions.find((s) => s.id === e.parent);
    if (p) { p.children++; if (e.status === "open") p.children_open++; }
  });
  parent.title = "Build observatory dashboard for ~/.codex with agent graph";
  parent.first_user_message = "build a dashboard that reads /Users/adam/.codex and shows sessions, agent trees, and warnings";
  parent.tokens_used = 184312;
  parent.warnings = 4;
  parent.failed_tools = 1;

  // timeline events for the parent session
  function makeTimeline(session) {
    const t0 = new Date(session.created_at);
    const ev = [];
    let cursor = new Date(t0);
    const push = (offsetMs, e) => {
      cursor = new Date(t0.getTime() + offsetMs);
      ev.push({ ...e, ts: new Date(cursor) });
    };

    push(0, { kind: "task_started", turn_id: "t01", text: "TURN 01 // task_started", approval: session.approval, sandbox: session.sandbox, model: session.model, effort: session.reasoning_effort });
    push(1200, { kind: "user", text: session.first_user_message });
    push(3400, { kind: "assistant", phase: "reasoning", text: "Plan: enumerate data sources in ~/.codex; index threads via state_5; lazy-parse JSONL for selected sessions; surface warnings from logs_2." });
    push(4600, { kind: "tool_call", name: "shell", args: { cmd: ["ls", "-la", "~/.codex/"] }, call_id: "c01" });
    push(5100, { kind: "tool_output", call_id: "c01", exit: 0, output: "drwxr-xr-x  adam  staff  2026-05-26 17:53 sessions\n-rw-r--r--  adam  staff  state_5.sqlite\n-rw-r--r--  adam  staff  logs_2.sqlite\n-rw-r--r--  adam  staff  codex-tui.log" });
    push(7800, { kind: "tool_call", name: "shell", args: { cmd: ["sqlite3", "-cmd", ".schema threads", "state_5.sqlite"] }, call_id: "c02" });
    push(9200, { kind: "tool_output", call_id: "c02", exit: 0, output: "CREATE TABLE threads ( id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, ... agent_nickname TEXT, agent_role TEXT, ... preview TEXT NOT NULL DEFAULT '');" });
    push(11000, { kind: "assistant", phase: "answer", text: "Found 673 rows in `threads`, 428 edges in `thread_spawn_edges`. logs_2 has 406,883 rows. Will model entities Session / Turn / ToolCall / ToolResult / TokenSnapshot / AgentEdge / RuntimeLog." });
    push(12000, { kind: "skill_invoke", name: "read_pdf", call_id: "sk01", summary: "extract the entity model from ~/.codex/observatory-spec.pdf (12 pp)", status: "ok" });
    push(13200, { kind: "token_count", total: 8420, input: 7200, output: 1220, cached: 320, ctx_pct: 4.1, rate_pct: 18 });
    push(15400, { kind: "tool_call", name: "spawn_agent", args: { nickname: "ARCHIMEDES", role: "researcher", task: "audit logs_2 noisy targets" }, call_id: "c03", spawn_thread_id: subA.id });
    push(16100, { kind: "tool_output", call_id: "c03", exit: 0, output: `{ "thread_id": "${subA.id}", "depth": 1, "agent_nickname": "ARCHIMEDES" }` });
    push(17200, { kind: "tool_call", name: "spawn_agent", args: { nickname: "SOCRATES", role: "worker", task: "draft the session timeline view" }, call_id: "c04", spawn_thread_id: subB.id });
    push(17900, { kind: "tool_output", call_id: "c04", exit: 0, output: `{ "thread_id": "${subB.id}", "depth": 1, "agent_nickname": "SOCRATES" }` });
    push(18800, { kind: "tool_call", name: "spawn_agent", args: { nickname: "BORGES", role: "worker", task: "compose the agent graph layout" }, call_id: "c05", spawn_thread_id: subC.id });
    push(19500, { kind: "tool_output", call_id: "c05", exit: 0, output: `{ "thread_id": "${subC.id}", "depth": 1, "agent_nickname": "BORGES" }` });
    push(22000, { kind: "assistant", phase: "answer", text: "Spawned 3 sub-agents in parallel; will await reports before integrating." });
    push(34000, { kind: "tool_call", name: "wait_agent", args: { thread_id: subA.id }, call_id: "c06" });
    push(64000, { kind: "tool_output", call_id: "c06", exit: 0, output: "ARCHIMEDES → 'Top noisy targets: codex_otel.log_only (62.4%), opentelemetry_sdk (11.2%), responses_websocket (8.1%). Recommend suppression list of 4 targets.'" });
    push(64200, { kind: "agent_report", from: "ARCHIMEDES", text: "Top noisy targets identified; suppression list ready." });
    push(66000, { kind: "tool_call", name: "shell", args: { cmd: ["sqlite3", "logs_2.sqlite", "SELECT target, COUNT(*) FROM logs WHERE level='WARN' GROUP BY target;"] }, call_id: "c07" });
    push(67800, { kind: "tool_output", call_id: "c07", exit: 1, output: "Error: database is locked", fail: true });
    push(70200, { kind: "warning", text: "DATABASE LOCK ENCOUNTERED // logs_2.sqlite — retrying with WAL fallback" });
    push(72000, { kind: "tool_call", name: "shell", args: { cmd: ["sqlite3", "-readonly", "logs_2.sqlite", "SELECT target, COUNT(*) FROM logs WHERE level='WARN' GROUP BY target;"] }, call_id: "c08" });
    push(73800, { kind: "tool_output", call_id: "c08", exit: 0, output: "codex_core_skills::loader|14\ncodex_api::sse::responses|6\ncodex_otel.log_only|3\ncodex_core::session::handlers|2\n", outputRender: { kind: "table", columns: ["target", "warnings"], rows: [["codex_core_skills::loader","14"],["codex_api::sse::responses","6"],["codex_otel.log_only","3"],["codex_core::session::handlers","2"]], totalRows: 4 } });
    push(75200, { kind: "token_count", total: 31200, input: 27400, output: 3800, cached: 2100, ctx_pct: 15.2, rate_pct: 31 });
    push(88000, { kind: "tool_call", name: "wait_agent", args: { thread_id: subC.id }, call_id: "c09" });
    push(112000, { kind: "tool_output", call_id: "c09", exit: 0, output: "BORGES → 'Graph layout: hierarchical w/ depth-1 spread, status color from edges.status. Ready to render 8-node tree.'" });
    push(112200, { kind: "agent_report", from: "BORGES", text: "Graph layout decided: hierarchical depth-1 spread, edges colored by status." });
    push(120000, { kind: "assistant", phase: "answer", text: "Integrating reports. Will draft the Sessions overview and timeline next." });
    push(124000, { kind: "tool_call", name: "write_file", args: { path: "dashboard/overview.tsx" }, call_id: "c10" });
    push(124800, { kind: "tool_output", call_id: "c10", exit: 0, output: "Wrote 8,420 bytes." });

    // exec_command: curl (http) → http renderer
    push(126900, { kind: "tool_call", name: "exec_command", args: { cmd: ["curl", "-sS", "http://localhost:4317/v1/health"] }, command_preview: "curl -sS http://localhost:4317/v1/health", call_id: "c12h" });
    push(127050, { kind: "tool_output", call_id: "c12h", exit: 0, output: "200 OK",
      outputRender: { kind: "http", method: "GET", url: "http://localhost:4317/v1/health", status: 200, statusText: "OK", durationMs: 38, size: "142 B", contentType: "application/json", json: true,
        headers: [
          { k: "content-type", v: "application/json" },
          { k: "x-otel-collector", v: "running" },
          { k: "date", v: "Thu, 29 May 2026 12:51:09 GMT" },
          { k: "content-length", v: "142" },
        ],
        body: "{\n  \"status\": \"healthy\",\n  \"uptime_s\": 84211,\n  \"exporters\": { \"otlp\": \"ok\", \"logging\": \"ok\" },\n  \"queue_depth\": 0\n}" } });

    // exec_command: rg (search) → matches renderer
    push(127200, { kind: "tool_call", name: "exec_command", args: { cmd: ["rg", "-n", "outputRender", "dashboard/"] }, command_preview: "rg -n outputRender dashboard/", call_id: "c12b" });
    push(127500, { kind: "tool_output", call_id: "c12b", exit: 0, output: "(9 matches in 3 files)",
      outputRender: { kind: "matches", files: [
        { path: "dashboard/EventRow.tsx", matches: [
          { n: 88, text: "  if (e.outputRender?.kind === \"diff\") return <DiffView r={e.outputRender} />;", col: [9, 21] },
          { n: 89, text: "  if (e.outputRender?.kind === \"tests\") return <TestsView r={e.outputRender} />;", col: [9, 21] },
          { n: 96, text: "  return e.outputRender ? <ExecOutput out={e} /> : <PlainOut out={e.output} />;", col: [11, 23] },
        ] },
        { path: "dashboard/exec-renderers.tsx", matches: [
          { n: 12, text: "export function ExecOutput({ out }: { out: ToolOutput }) {", col: [16, 26] },
          { n: 130, text: "  const r = out.outputRender;", col: [14, 26] },
          { n: 131, text: "  const kind = r ? r.kind : \"plain\";", col: [13, 14] },
        ] },
        { path: "dashboard/types.ts", matches: [
          { n: 42, text: "  outputRender?: OutputRender;  // server-parsed structured output", col: [2, 14] },
          { n: 51, text: "export type OutputRender =", col: [12, 24] },
          { n: 58, text: "  | { kind: \"plain\" };", col: [4, 8] },
        ] },
      ] } });

    // exec_command: nl (file peek) → file renderer
    push(126500, { kind: "tool_call", name: "exec_command", args: { cmd: ["nl", "-ba", "dashboard/overview.tsx"] }, command_preview: "nl -ba dashboard/overview.tsx", call_id: "c12a" });
    push(126800, { kind: "tool_output", call_id: "c12a", exit: 0, output: "(412 lines)",
      outputRender: { kind: "file", path: "dashboard/overview.tsx", startLine: 1, totalLines: 412, lines: [
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
      ] } });
    push(126000, { kind: "skill_invoke", name: "web_search", call_id: "sk02", summary: "sqlite WAL busy_timeout best practice for concurrent readers", status: "ok" });

    // exec_command: git status --short  → file-list renderer
    push(128000, { kind: "tool_call", name: "exec_command", args: { cmd: ["git", "status", "--short"] }, command_preview: "git status --short", call_id: "c12" });
    push(128300, { kind: "tool_output", call_id: "c12", exit: 0,
      output: " M dashboard/app.tsx\n M dashboard/styles.css\nA  dashboard/overview.tsx\nA  dashboard/timeline.tsx\nD  dashboard/legacy_list.tsx\nR  dashboard/graph.tsx -> dashboard/agent_graph.tsx\n?? scratch/notes.md\n?? scratch/query.sql",
      outputRender: { kind: "status", files: [
        { code: "M", path: "dashboard/app.tsx" },
        { code: "M", path: "dashboard/styles.css" },
        { code: "A", path: "dashboard/overview.tsx" },
        { code: "A", path: "dashboard/timeline.tsx" },
        { code: "D", path: "dashboard/legacy_list.tsx" },
        { code: "R", path: "dashboard/graph.tsx → dashboard/agent_graph.tsx" },
        { code: "??", path: "scratch/notes.md" },
        { code: "??", path: "scratch/query.sql" },
      ] } });

    // exec_command: git diff  → diff renderer (long → truncated preview + modal)
    push(131000, { kind: "tool_call", name: "exec_command", args: { cmd: ["git", "diff", "dashboard/timeline.tsx"] }, command_preview: "git diff dashboard/timeline.tsx", call_id: "c13" });
    push(131600, { kind: "tool_output", call_id: "c13", exit: 0, output: "diff --git a/dashboard/timeline.tsx b/dashboard/timeline.tsx (3 hunks, +38 −9)",
      outputRender: { kind: "diff", files: [
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
            { t: "ctx", text: "    <div className=\"tl-stream\">" },
            { t: "del", text: "      {events.map(renderRow)}" },
            { t: "add", text: "      {scoped.map((e) => <EventRow e={e} key={e.id} />)}" },
            { t: "ctx", text: "    </div>" },
          ] },
          { header: "@@ -88,3 +110,9 @@ function EventRow({ e }) {", lines: [
            { t: "add", text: "  if (e.outputRender?.kind === \"diff\") return <DiffView r={e.outputRender} />;" },
            { t: "add", text: "  if (e.outputRender?.kind === \"tests\") return <TestsView r={e.outputRender} />;" },
            { t: "ctx", text: "  return <PlainOut out={e.output} />;" },
          ] },
        ] },
      ] } });

    // exec_command: pytest  → test summary renderer (failures → loud)
    push(140000, { kind: "tool_call", name: "exec_command", args: { cmd: ["pytest", "-q", "tests/"] }, command_preview: "pytest -q tests/", call_id: "c14" });
    push(146200, { kind: "tool_output", call_id: "c14", exit: 1, fail: true, output: "==== 3 failed, 42 passed, 1 skipped in 6.2s ====",
      outputRender: { kind: "tests", passed: 42, failed: 3, skipped: 1, durationMs: 6200, failing: [
        "tests/test_parser.py::test_lazy_resume_after_token_count",
        "tests/test_tokens.py::test_negative_delta_guard",
        "tests/test_db.py::test_wal_busy_timeout_retry",
      ] } });

    push(150000, { kind: "token_count", total: 84200, input: 71200, output: 11000, cached: 5400, ctx_pct: 38.1, rate_pct: 54 });
    push(180000, { kind: "tool_call", name: "wait_agent", args: { thread_id: subB.id }, call_id: "c11" });
    push(180100, { kind: "warning", text: "SOCRATES STILL OPEN // exceeded soft deadline 120s — continuing to poll" });
    push(184000, { kind: "task_complete", turn_id: "t01", duration_ms: 184000, ttft_ms: 1820, last_agent_message: "Dashboard scaffolded; awaiting SOCRATES on timeline view." });
    return ev;
  }

  const timelines = {};
  timelines[parent.id] = makeTimeline(parent);

  // also build slimmer timelines for a couple sub-agents
  // sub timelines are anchored to a real offset within the PARENT run and spread
  // over their concurrent window, so the aggregated "+SUBS" view interleaves by time.
  const pT0 = new Date(parent.created_at);
  function makeSubTimeline(session, task, t0Date, spanMs) {
    const t0 = t0Date ? new Date(t0Date) : new Date(session.created_at);
    const scale = spanMs ? spanMs / 10100 : 1;
    const ev = [];
    const push = (offsetMs, e) => ev.push({ ...e, ts: new Date(t0.getTime() + offsetMs * scale) });
    push(0, { kind: "task_started", turn_id: "t01", text: "TURN 01 // task_started", approval: "never", sandbox: "read-only", model: session.model, effort: session.reasoning_effort });
    push(800, { kind: "user", text: `subagent task: ${task}` });
    push(2400, { kind: "assistant", phase: "reasoning", text: "Reading logs_2.sqlite schema; will group warnings by target and rank by count." });
    push(3800, { kind: "tool_call", name: "shell", args: { cmd: ["sqlite3", "logs_2.sqlite", "SELECT target, COUNT(*) FROM logs GROUP BY target ORDER BY 2 DESC LIMIT 12;"] }, call_id: "s01" });
    push(4900, { kind: "tool_output", call_id: "s01", exit: 0, output: "codex_otel.log_only|254011\ncodex_otel.trace_safe|41202\ncodex_api::endpoint::responses_websocket|36400\nlog|22014\nopentelemetry_sdk|18722\n..." });
    push(6000, { kind: "skill_invoke", name: "web_search", call_id: "s-sk1", summary: "OpenTelemetry log sampling defaults", status: "ok" });
    push(8200, { kind: "token_count", total: 4400, input: 3900, output: 500, cached: 0, ctx_pct: 2.1, rate_pct: 19 });
    push(9800, { kind: "assistant", phase: "answer", text: "Top noisy targets identified; suppression list ready." });
    push(10100, { kind: "task_complete", turn_id: "t01", duration_ms: 10100, ttft_ms: 920, last_agent_message: "Top noisy targets identified; suppression list ready." });
    return ev;
  }
  // ARCHIMEDES runs spawn(15.4s) → report(64s); SOCRATES spawn(17.2s) → still open (~180s)
  timelines[subA.id] = makeSubTimeline(subA, "audit logs_2 noisy targets", new Date(pT0.getTime() + 15400), 47000);
  timelines[subB.id] = makeSubTimeline(subB, "draft the session timeline view", new Date(pT0.getTime() + 17200), 150000);

  // sub-sub-agent timelines (depth 2) — anchored inside their parent sub's window
  function makeSubSubTimeline(session, task, t0Date, spanMs) {
    const t0 = t0Date ? new Date(t0Date) : new Date(session.created_at);
    const scale = spanMs ? spanMs / 6900 : 1;
    const ev = [];
    const push = (offsetMs, e) => ev.push({ ...e, ts: new Date(t0.getTime() + offsetMs * scale) });
    push(0, { kind: "task_started", turn_id: "t01", text: "TURN 01 // task_started", approval: "never", sandbox: "read-only", model: session.model, effort: session.reasoning_effort });
    push(600, { kind: "user", text: `subagent task: ${task}` });
    push(1900, { kind: "assistant", phase: "reasoning", text: "Scoping the request to a single file; will grep then patch." });
    push(2600, { kind: "tool_call", name: "read_file", args: { path: "src/index.ts" }, call_id: "ss01" });
    push(3200, { kind: "tool_output", call_id: "ss01", exit: 0, output: "// 412 lines read" });
    push(5200, { kind: "token_count", total: 2600, input: 2300, output: 300, cached: 200, ctx_pct: 1.3, rate_pct: 11 });
    push(6400, { kind: "assistant", phase: "answer", text: "Patch drafted; returning summary to parent." });
    push(6700, { kind: "agent_report", from: session.agent_nickname, text: "Done — 1 file changed, summary attached." });
    push(6900, { kind: "task_complete", turn_id: "t01", duration_ms: 6900, ttft_ms: 740, last_agent_message: "Done — 1 file changed." });
    return ev;
  }
  // HYPATIA inside ARCHIMEDES' window; TURING inside SOCRATES' window
  timelines[subD.id] = makeSubSubTimeline(subD, "patch the JSONL lazy-parser", new Date(pT0.getTime() + 28000), 22000);   // HYPATIA → under ARCHIMEDES
  timelines[subF.id] = makeSubSubTimeline(subF, "wire the scrubber dots", new Date(pT0.getTime() + 90000), 40000);        // TURING → under SOCRATES

  // token series for the parent
  function tokenSeries(session) {
    const tl = timelines[session.id] || [];
    const pts = tl.filter((e) => e.kind === "token_count").map((e) => ({
      ts: e.ts, total: e.total, input: e.input, output: e.output, cached: e.cached, ctx_pct: e.ctx_pct, rate_pct: e.rate_pct,
    }));
    return pts;
  }

  // logs (synthetic ~80 rows)
  const LOG_TARGETS = [
    "codex_otel.log_only",
    "codex_otel.trace_safe",
    "codex_api::endpoint::responses_websocket",
    "codex_core_skills::loader",
    "codex_core::stream_events_utils",
    "codex_tui::markdown_stream",
    "codex_core::session::handlers",
    "codex_core::session::turn",
    "opentelemetry_sdk",
    "log",
  ];
  const LOG_BODIES = {
    "codex_core_skills::loader": [
      ["WARN", "skill 'read_pdf' manifest missing required field 'description'; using defaults"],
      ["WARN", "skill loader: duplicate id 'pdf-extract' shadowed by user override"],
      ["INFO", "loaded 18 skills in 42ms"],
    ],
    "codex_api::endpoint::responses_websocket": [
      ["INFO", "ws open; protocol=codex.v3 region=us-west-2 rtt=42ms"],
      ["DEBUG", "frame in: type=delta content_len=812"],
      ["WARN", "ws close 1006 from server; will reconnect with backoff=2s"],
    ],
    "codex_core::session::handlers": [
      ["INFO", "task_started turn=t01 model=claude-opus-5 effort=high"],
      ["INFO", "task_complete turn=t01 duration=184000ms"],
      ["WARN", "approval policy=on-failure but no failure registered; auto-approving"],
    ],
    "codex_core::session::turn": [
      ["DEBUG", "first chunk received ttft=1820ms"],
      ["DEBUG", "token_count input=7200 output=1220 cached=320 ctx_pct=4.1"],
      ["INFO", "sub-agent spawn ok thread_id=" + subA.id],
    ],
    "codex_otel.log_only": [
      ["TRACE", "otel: emitted span responses.complete"],
      ["DEBUG", "otel: exporter batch flush n=64"],
    ],
    "codex_otel.trace_safe": [
      ["TRACE", "trace_safe redacted 2 fields"],
    ],
    "codex_tui::markdown_stream": [
      ["DEBUG", "md stream: closed code block at 240 char"],
    ],
    "codex_core::stream_events_utils": [
      ["DEBUG", "stream event response_item.type=function_call name=shell"],
    ],
    "opentelemetry_sdk": [
      ["WARN", "OTEL exporter timeout; queue=128 dropped=0"],
    ],
    "log": [
      ["INFO", "process bootstrap complete pid=84210"],
    ],
  };
  function makeLogs() {
    const arr = [];
    const t0 = new Date(parent.created_at);
    for (let i = 0; i < 220; i++) {
      const tgt = LOG_TARGETS[Math.floor(Math.random() * LOG_TARGETS.length)];
      const pool = LOG_BODIES[tgt] || [["DEBUG", "..."]];
      const [lvl, msg] = pool[Math.floor(Math.random() * pool.length)];
      const ts = new Date(t0.getTime() + Math.floor(Math.random() * 184000));
      arr.push({
        id: 1000 + i,
        ts,
        level: lvl,
        target: tgt,
        msg,
        thread_id: Math.random() < 0.6 ? parent.id : sessions[Math.floor(Math.random() * sessions.length)].id,
      });
    }
    return arr.sort((a, b) => b.ts - a.ts);
  }
  const logs = makeLogs();

  // tool name distribution for sidebar
  function toolUsage() {
    const counts = {};
    Object.values(timelines).forEach((arr) => {
      arr.forEach((e) => {
        if (e.kind === "tool_call") counts[e.name] = (counts[e.name] || 0) + 1;
      });
    });
    // boost some additional common tool names so distribution is interesting
    Object.assign(counts, {
      shell: (counts.shell || 0) + 47,
      read_file: 28,
      write_file: 14,
      grep: 12,
      web_search: 5,
      apply_patch: 9,
    });
    return Object.entries(counts).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  }

  // expose
  window.WK_DATA = {
    sessions,
    edges,
    timelines,
    tokenSeries,
    logs,
    toolUsage: toolUsage(),
    now,
    helpers: { fmtTime, fmtTimeMs, fmtDate, pad },
  };
})();
