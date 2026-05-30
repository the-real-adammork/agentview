/* ============================================================
   exec_command output renderers  (shared: Observatory + Component Library)
   Server emits structured `outputRender` JSON; these reusable components
   render it. Each renders a capped INLINE preview and, in the modal, the
   FULL output. kinds: diff · tests · status · table · plain
   Uses React.* hooks directly so the file is self-sufficient (no shared
   hook bindings required).
   ============================================================ */

function DiffView({ r, full }) {
  // flatten file→hunk→line, cap inline preview
  const CAP = 6;
  let shown = 0, total = 0;
  r.files.forEach((f) => f.hunks.forEach((h) => { total += h.lines.length; }));
  return (
    <div className="xr xr-diff">
      {r.files.map((f, fi) => (
        <div key={fi} className="xr-file">
          <div className="xr-file-hd">
            <span className="path">{f.path}</span>
            <span className="adds">+{f.added}</span>
            <span className="dels">−{f.removed}</span>
          </div>
          {f.hunks.map((h, hi) => (
            <div key={hi} className="xr-hunk">
              <div className="xr-hunk-hd">{h.header}</div>
              {h.lines.map((ln, li) => {
                if (!full && shown >= CAP) return null;
                shown++;
                return (
                  <div key={li} className={"xr-line " + ln.t}>
                    <span className="g">{ln.t === "add" ? "+" : ln.t === "del" ? "−" : " "}</span>
                    <span className="c">{ln.text}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TestsView({ r, full }) {
  const ok = r.failed === 0;
  return (
    <div className="xr xr-tests" data-ok={ok}>
      <div className="xr-tests-hd">
        <span className={"t-pass"}>✓ {r.passed} passed</span>
        {r.failed > 0 && <span className="t-fail">✗ {r.failed} failed</span>}
        {r.skipped > 0 && <span className="t-skip">⊘ {r.skipped} skipped</span>}
        <span className="t-dur num">{(r.durationMs / 1000).toFixed(1)}s</span>
      </div>
      {r.failing && r.failing.length > 0 && (
        <div className="xr-fail-list">
          {(full ? r.failing : r.failing.slice(0, 2)).map((name, i) => (
            <div key={i} className="xr-fail-row"><span className="x">✗</span><span className="nm">{name}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusView({ r, full }) {
  const CAP = 5;
  const files = full ? r.files : r.files.slice(0, CAP);
  const codeClass = (c) => c === "M" ? "m" : c === "A" ? "a" : c === "D" ? "d" : c === "R" ? "r" : "u";
  return (
    <div className="xr xr-status">
      {files.map((f, i) => (
        <div key={i} className="xr-st-row">
          <span className={"xr-st-code " + codeClass(f.code)}>{f.code}</span>
          <span className="xr-st-path">{f.path}</span>
        </div>
      ))}
    </div>
  );
}

function TableView({ r, full }) {
  const CAP = 6;
  const rows = full ? r.rows : r.rows.slice(0, CAP);
  // docker-style columnar: a STATUS column gets a health dot (Up/healthy green · Exited/Restarting red)
  const statusIdx = r.columns.findIndex((c) => /^\s*status\s*$/i.test(String(c)));
  const dotTone = (v) => /\b(up|healthy|running|active|open|ready|done|success|passed|ok)\b/i.test(v) ? "ok"
    : /\b(exit|exited|dead|restart|restarting|unhealthy|removing|paused|created|fail|failed|error|stopped|crash)\b/i.test(v) ? "warn" : "dim";
  return (
    <div className="xr xr-table-wrap">
      <table className="xr-table">
        <thead><tr>{r.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => (
              <td key={ci} className="num">
                {ci === statusIdx && cell !== "" && <span className={"xr-td-dot " + dotTone(String(cell))}></span>}
                {cell}
              </td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlainOut({ output, full }) {
  const text = output || "";
  const lines = text.split("\n");
  const CAP = 8;
  const shown = full ? text : lines.slice(0, CAP).join("\n");
  return <pre className="xr xr-plain" style={{ fontSize: 11 }}>{shown}</pre>;
}

// HTTP (curl / wget): method + URL + status, headers/timing, JSON-aware body preview
function HttpView({ r, full }) {
  const statusClass = r.status >= 500 ? "s5" : r.status >= 400 ? "s4" : r.status >= 300 ? "s3" : "s2";
  const headers = r.headers || [];
  const shownHeaders = full ? headers : headers.slice(0, 3);
  const bodyText = r.body || "";
  const bodyLines = bodyText.split("\n");
  const BODY_CAP = 8;
  const body = full ? bodyText : bodyLines.slice(0, BODY_CAP).join("\n");
  return (
    <div className="xr xr-http">
      <div className="xr-http-head">
        <span className="hk">HTTP</span>
        <span className="method">{r.method || "GET"}</span>
        <span className={"status " + statusClass}>
          <span className="dot"></span>
          <span className="scode num">{r.status}</span>
          {r.statusText && <span className="reason">{r.statusText}</span>}
        </span>
        <span className="metrics">
          {r.durationMs != null && <span className="t num">{r.durationMs}ms</span>}
          {r.size != null && <span className="sz num">{r.size}</span>}
        </span>
      </div>
      <div className="xr-http-url">{r.url}</div>
      {shownHeaders.length > 0 && (
        <div className="xr-http-hdrs">
          {shownHeaders.map((h, i) => (
            <div key={i} className="hrow"><span className="hk">{h.k}</span><span className="hv">{h.v}</span></div>
          ))}
        </div>
      )}
      {bodyText && (
        <div className="xr-http-body">
          <div className="bd-lbl">{r.contentType || (r.json ? "application/json" : "body")}</div>
          <pre className={"bd" + (r.json ? " json" : "")}>{body}</pre>
        </div>
      )}
    </div>
  );
}

// search matches (rg / grep): grouped by file, line# + matched line with hit emphasized
function MatchesView({ r, full }) {
  const CAP = 6; // total match lines shown inline across files
  let shown = 0;
  const renderHit = (m) => {
    // m.col is [start, end] within m.text to emphasize; fall back to whole line
    if (!m.col) return <span className="c">{m.text}</span>;
    const [s, e] = m.col;
    return (
      <span className="c">
        {m.text.slice(0, s)}
        <span className="hit">{m.text.slice(s, e)}</span>
        {m.text.slice(e)}
      </span>
    );
  };
  return (
    <div className="xr xr-matches">
      {r.files.map((f, fi) => {
        if (!full && shown >= CAP) return null;
        const lines = full ? f.matches : f.matches.slice(0, Math.max(0, CAP - shown));
        shown += lines.length;
        return (
          <div key={fi} className="xr-mt-file">
            <div className="xr-mt-file-hd">
              <span className="path">{f.path}</span>
              <span className="cnt num">{f.matches.length}</span>
            </div>
            {lines.map((m, mi) => (
              <div key={mi} className="xr-mt-row">
                <span className="ln num">{m.n}</span>
                {renderHit(m)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// file peek (nl / cat / sed -n / head): line-numbered gutter + mono body
function FileView({ r, full }) {
  const CAP = 8;
  const lines = full ? r.lines : r.lines.slice(0, CAP);
  const start = r.startLine || (r.lines[0] && r.lines[0].n) || 1;
  const last = r.lines.length ? r.lines[r.lines.length - 1].n : start;
  return (
    <div className="xr xr-file-peek">
      <div className="xr-fp-hd">
        <span className="path">{r.path}</span>
        <span className="rng num">L{start}–{last}{r.totalLines ? ` / ${r.totalLines}` : ""}</span>
      </div>
      <div className="xr-fp-body">
        {lines.map((ln, i) => (
          <div key={i} className="xr-fp-line">
            <span className="n num">{ln.n}</span>
            <span className="c">{ln.text === "" ? "\u00a0" : ln.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// compiler / build diagnostics (cargo build · tsc · go build · webpack)
function BuildView({ r, full }) {
  const CAP = 3;
  const diags = full ? (r.diagnostics || []) : (r.diagnostics || []).slice(0, CAP);
  const ok = (r.errors || 0) === 0;
  return (
    <div className="xr xr-build" data-ok={ok}>
      <div className="xr-build-hd">
        <span className="tool">{r.tool}</span>
        {r.errors > 0 && <span className="b-err">✗ {r.errors} error{r.errors > 1 ? "s" : ""}</span>}
        {r.warnings > 0 && <span className="b-warn">▲ {r.warnings} warning{r.warnings > 1 ? "s" : ""}</span>}
        {ok && !r.warnings && <span className="b-ok">✓ clean</span>}
        {r.durationMs != null && <span className="b-dur num">{(r.durationMs / 1000).toFixed(1)}s</span>}
      </div>
      <div className="xr-build-list">
        {diags.map((d, i) => (
          <div key={i} className={"xr-diag " + d.severity}>
            <div className="d-hd">
              <span className="sev">{d.severity}{d.code ? `[${d.code}]` : ""}</span>
              <span className="loc num">{d.file}:{d.line}{d.col ? `:${d.col}` : ""}</span>
            </div>
            <div className="d-msg">{d.message}</div>
            {d.snippet && d.snippet.length > 0 && (
              <div className="d-snip">
                {d.snippet.map((s, si) => (
                  <React.Fragment key={si}>
                    <div className="d-snip-line">
                      <span className="n num">{s.n}</span>
                      <span className="c">{s.text === "" ? "\u00a0" : s.text}</span>
                    </div>
                    {s.caret && (
                      <div className="d-snip-line caret">
                        <span className="n"></span>
                        <span className="c">{" ".repeat(s.caret[0])}{"^".repeat(Math.max(1, s.caret[1] - s.caret[0]))}</span>
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// stack trace / panic (python traceback · rust panic · node error)
// frames ordered outermost → innermost; the LAST frame is the error site
function TraceView({ r, full }) {
  const frames = r.frames || [];
  const CAP = 3;
  const hidden = !full && frames.length > CAP ? frames.length - CAP : 0;
  const shown = full ? frames : frames.slice(frames.length - CAP);
  return (
    <div className="xr xr-trace">
      <div className="xr-trace-hd">
        <span className="exc">{r.exception}</span>
        {r.lang && <span className="lang num">{r.lang}</span>}
      </div>
      {r.message && <div className="xr-trace-msg">{r.message}</div>}
      <div className="xr-trace-frames">
        {hidden > 0 && <div className="xr-tr-elide">⋯ {hidden} earlier frame{hidden > 1 ? "s" : ""}</div>}
        {shown.map((f, i) => (
          <div key={i} className={"xr-tr-frame " + (f.user ? "user" : "lib")}>
            <div className="f-loc">
              <span className="arrow">{f.user ? "▸" : "·"}</span>
              <span className="fn">{f.fn}</span>
              <span className="at num">{f.file}:{f.line}</span>
            </div>
            {f.code && <div className="f-code">{f.code}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// linter diagnostics (eslint · ruff · clippy): grouped by file w/ severity
function LintView({ r, full }) {
  const CAP = 6;
  let shown = 0;
  return (
    <div className="xr xr-lint">
      <div className="xr-lint-hd">
        <span className="tool">{r.tool}</span>
        {r.errors > 0 && <span className="l-err">{r.errors} error{r.errors > 1 ? "s" : ""}</span>}
        {r.warnings > 0 && <span className="l-warn">{r.warnings} warning{r.warnings > 1 ? "s" : ""}</span>}
        {!r.errors && !r.warnings && <span className="l-ok">✓ clean</span>}
      </div>
      {r.files.map((f, fi) => {
        if (!full && shown >= CAP) return null;
        const issues = full ? f.issues : f.issues.slice(0, Math.max(0, CAP - shown));
        shown += issues.length;
        return (
          <div key={fi} className="xr-lint-file">
            <div className="xr-lint-file-hd"><span className="path">{f.path}</span><span className="cnt num">{f.issues.length}</span></div>
            {issues.map((it, ii) => (
              <div key={ii} className={"xr-lint-row " + it.severity}>
                <span className="sev-dot"></span>
                <span className="loc num">{it.line}:{it.col}</span>
                <span className="msg">{it.message}</span>
                <span className="rule num">{it.rule}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// directory listing (ls -la · tree · find): structure, type glyphs, sizes
function TreeView({ r, full }) {
  const CAP = 8;
  const entries = full ? r.entries : r.entries.slice(0, CAP);
  const glyph = (t) => t === "dir" ? "▸" : t === "link" ? "↳" : "·";
  return (
    <div className="xr xr-tree">
      {r.root && <div className="xr-tree-root">{r.root}</div>}
      {entries.map((e, i) => (
        <div key={i} className={"xr-tree-row " + e.type}>
          <span className="indent" style={{ width: (e.depth || 0) * 14 }}></span>
          <span className="tg">{glyph(e.type)}</span>
          <span className="nm">{e.name}{e.type === "dir" ? "/" : ""}</span>
          {e.count != null && <span className="ct num">{e.count} item{e.count !== 1 ? "s" : ""}</span>}
          {e.size && <span className="sz num">{e.size}</span>}
        </div>
      ))}
    </div>
  );
}

// commit history (git log --oneline · git blame)
function LogView({ r, full }) {
  const CAP = 5;
  const commits = full ? r.commits : r.commits.slice(0, CAP);
  return (
    <div className="xr xr-log">
      {commits.map((c, i) => (
        <div key={i} className="xr-log-row">
          <span className="rail" aria-hidden="true">{i === 0 ? "●" : "│"}</span>
          <span className="hash num">{c.hash}</span>
          {c.refs && c.refs.length > 0 && (
            <span className="refs">{c.refs.map((rf, ri) => <span key={ri} className={"ref" + (/HEAD/.test(rf) ? " head" : "")}>{rf}</span>)}</span>
          )}
          <span className="subj">{c.subject}</span>
          <span className="meta num">{c.author} · {c.date}</span>
        </div>
      ))}
    </div>
  );
}

// diffstat (git diff --stat · git show --stat): changed-files summary, no hunks.
// per-file +ins/−del with a proportional add/del bar, scaled to the busiest file.
function DiffstatView({ r, full }) {
  const CAP = 6;
  const files = full ? r.files : r.files.slice(0, CAP);
  const maxCh = Math.max(1, ...r.files.map((f) => (f.insertions || 0) + (f.deletions || 0)));
  const seg = (f) => {
    const ch = (f.insertions || 0) + (f.deletions || 0);
    const len = Math.max(1, Math.round((ch / maxCh) * 12));
    let g = ch ? Math.round((f.insertions / ch) * len) : 0;
    if (f.insertions > 0 && g === 0) g = 1;
    let d = len - g;
    if (f.deletions > 0 && d === 0) { d = 1; if (g > 1) g -= 1; }
    return { g: Math.max(0, g), d: Math.max(0, d) };
  };
  return (
    <div className="xr xr-diffstat">
      {files.map((f, i) => {
        const { g, d } = seg(f);
        return (
          <div key={i} className="xr-ds-row">
            <span className="path">{f.path}</span>
            <span className="delta num">
              {f.insertions > 0 && <span className="a">+{f.insertions}</span>}
              {f.deletions > 0 && <span className="d">−{f.deletions}</span>}
            </span>
            <span className="bar" aria-hidden="true">
              <span className="ga">{"▰".repeat(g)}</span><span className="gd">{"▰".repeat(d)}</span>
            </span>
          </div>
        );
      })}
      {r.totals && (
        <div className="xr-ds-total">
          <span className="f">{r.totals.files} file{r.totals.files === 1 ? "" : "s"} changed</span>
          <span className="a num">+{r.totals.insertions}</span>
          <span className="d num">−{r.totals.deletions}</span>
        </div>
      )}
    </div>
  );
}

// git ops (commit · add · merge · worktree · branch): one card, body switches on `sub`.
// commit rides the log-row · add the status list · merge embeds a diffstat ·
// worktree the call-line · branch a chip pair.
function GitCommit({ r }) {
  return (
    <div className="xr xr-git-commit">
      <span className="dot">●</span>
      <span className="sha num">{r.shortSha}</span>
      {r.branch && <span className="branch">{r.branch}</span>}
      <span className="subj">{r.subject}</span>
      <span className="stat num">
        <span className="a">+{r.insertions || 0}</span>
        <span className="d">−{r.deletions || 0}</span>
        <span className="sep">·</span>
        <span className="fc">{r.filesChanged} file{r.filesChanged === 1 ? "" : "s"}</span>
      </span>
    </div>
  );
}

function GitAdd({ r, full }) {
  const CAP = 6;
  const paths = full ? r.staged : r.staged.slice(0, CAP);
  return (
    <div className="xr xr-git-add">
      <div className="xr-ga-hd"><span className="plus">+</span> staged {r.staged.length} file{r.staged.length === 1 ? "" : "s"}</div>
      <div className="xr-ga-list">
        {paths.map((p, i) => (
          <div key={i} className="xr-ga-row"><span className="g">+</span><span className="path">{p}</span></div>
        ))}
      </div>
    </div>
  );
}

function GitWorktree({ r }) {
  return (
    <div className="xr xr-call-line git-wt">
      <span className="cl-icon">⌂</span>
      <span className="cl-path">{r.branch}</span>
      <span className="cl-q">{r.path || (r.ok ? "" : "")}</span>
      {r.ok && r.head && <span className="cl-meta num">HEAD {r.head}</span>}
      <span className={"cl-res " + (r.ok ? "ok" : "warn")}>{r.ok ? "worktree ready" : (r.error || "failed")}</span>
    </div>
  );
}

function GitBranch({ r }) {
  return (
    <div className="xr xr-git-chips">
      <span className="gchip branch">{r.branch}</span>
      {r.sha && <span className="gchip sha num">{r.sha}</span>}
    </div>
  );
}

function GitMerge({ r, full }) {
  const tone = r.conflict ? "conflict" : r.fastForward ? "ff" : "merge";
  const line = r.conflict ? `CONFLICT — ${r.conflict}`
    : r.fastForward ? `Fast-forward${r.head ? ` → ${r.head}` : ""}`
    : `Merge made by the '${r.strategy || "ort"}' strategy`;
  return (
    <div className="xr xr-git-merge">
      <div className={"xr-gm-result " + tone}>
        <span className="gm-glyph">{r.conflict ? "✗" : "⎇"}</span>
        <span className="gm-line">{line}</span>
      </div>
      {r.diffstat && <DiffstatView r={r.diffstat} full={full} />}
    </div>
  );
}

function GitView({ r, out, full }) {
  switch (r.sub) {
    case "commit": return <GitCommit r={r} />;
    case "add": return <GitAdd r={r} full={full} />;
    case "worktree": return <GitWorktree r={r} />;
    case "branch": return <GitBranch r={r} />;
    case "merge": return <GitMerge r={r} full={full} />;
    default: return <PlainOut output={out ? out.output : ""} full={full} />;
  }
}

// docker compose up — streaming lifecycle collapsed to terminal state per resource.
// reuses the status dot+row vocabulary; image-pull churn collapses to one summary chip.
function ComposeView({ r, full }) {
  const CAP = 5;
  const res = full ? r.resources : r.resources.slice(0, CAP);
  const tone = (s) => /^(started|created|recreated|healthy|running)$/i.test(s) ? "ok"
    : /^(creating|starting|recreate|pulling|waiting)$/i.test(s) ? "wait"
    : /^(error|exited|dead|unhealthy)$/i.test(s) ? "warn" : "dim";
  return (
    <div className="xr xr-compose">
      {r.pull && (
        <div className="xr-cp-pull">
          <span className="g">↓</span>
          <span className="lbl">{r.pull.done}/{r.pull.layers} layer{r.pull.layers === 1 ? "" : "s"} pulled</span>
        </div>
      )}
      {res.map((c, i) => (
        <div key={i} className="xr-cp-row">
          <span className={"xr-cp-dot " + tone(c.state)}></span>
          <span className="ty">{c.type}</span>
          <span className="nm">{c.name}</span>
          <span className={"stt " + tone(c.state)}>{c.state}</span>
        </div>
      ))}
    </div>
  );
}

// JSON token colorizer — keys, strings, numbers, keywords
function tokenizeJson(line) {
  const out = [];
  const re = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(true|false|null)/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(<span key={k++}>{line.slice(last, m.index)}</span>);
    if (m[1]) out.push(<span key={k++} className="j-key">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="j-str">{m[2]}</span>);
    else if (m[3]) out.push(<span key={k++} className="j-num">{m[3]}</span>);
    else if (m[4]) out.push(<span key={k++} className="j-kw">{m[4]}</span>);
    last = re.lastIndex;
  }
  if (last < line.length) out.push(<span key={k++}>{line.slice(last)}</span>);
  return out.length ? out : "\u00a0";
}

// structured data (jq · cat *.json): pretty-printed, syntax-colored
function JsonView({ r, full }) {
  const text = typeof r.value === "string" ? r.value : JSON.stringify(r.value, null, 2);
  const lines = text.split("\n");
  const CAP = 8;
  const shown = full ? lines : lines.slice(0, CAP);
  return (
    <div className="xr xr-json">
      {r.source && <div className="xr-json-src">{r.source}</div>}
      <pre className="xr-json-body">
        {shown.map((ln, i) => <div key={i} className="jl">{tokenizeJson(ln)}</div>)}
      </pre>
    </div>
  );
}

// JSON line count helper (for overflow)
function jsonLineCount(r) {
  const text = typeof r.value === "string" ? r.value : JSON.stringify(r.value, null, 2);
  return text.split("\n").length;
}

// does this exec output overflow its inline preview? returns a label or null
function execOverflow(out) {
  const r = out.outputRender;
  if (!r) {
    const ln = (out.output || "").split("\n").length;
    return ln > 8 ? `+${ln - 8} lines` : null;
  }
  if (r.kind === "diff") {
    let total = 0; r.files.forEach((f) => f.hunks.forEach((h) => { total += h.lines.length; }));
    return total > 6 ? `+${total - 6} lines` : null;
  }
  if (r.kind === "tests") return r.failed > 2 ? `+${r.failed - 2} failures` : null;
  if (r.kind === "status") return r.files.length > 5 ? `+${r.files.length - 5} files` : null;
  if (r.kind === "table") return r.rows.length > 6 ? `+${(r.totalRows || r.rows.length) - 6} rows` : null;
  if (r.kind === "file") return r.lines.length > 8 ? `+${(r.totalLines || r.lines.length) - 8} lines` : null;
  if (r.kind === "matches") {
    const total = r.files.reduce((a, f) => a + f.matches.length, 0);
    return total > 6 ? `+${total - 6} matches` : null;
  }
  if (r.kind === "http") {
    const hdrs = (r.headers || []).length;
    const bodyLines = (r.body || "").split("\n").length;
    const extra = Math.max(0, hdrs - 3) + Math.max(0, bodyLines - 8);
    return extra > 0 ? `headers + body` : null;
  }
  if (r.kind === "build") { const n = (r.diagnostics || []).length; return n > 3 ? `+${n - 3} diagnostics` : null; }
  if (r.kind === "trace") { const n = (r.frames || []).length; return n > 3 ? `+${n - 3} frames` : null; }
  if (r.kind === "lint") { const n = r.files.reduce((a, f) => a + f.issues.length, 0); return n > 6 ? `+${n - 6} issues` : null; }
  if (r.kind === "tree") { const n = r.entries.length; return n > 8 ? `+${(r.totalEntries || n) - 8} entries` : null; }
  if (r.kind === "log") { const n = r.commits.length; return n > 5 ? `+${(r.total || n) - 5} commits` : null; }
  if (r.kind === "json") { const n = jsonLineCount(r); return n > 8 ? `+${n - 8} lines` : null; }
  if (r.kind === "diffstat") { const n = r.files.length; return n > 6 ? `+${n - 6} files` : null; }
  if (r.kind === "git") {
    if (r.sub === "add") return r.staged.length > 6 ? `+${r.staged.length - 6} files` : null;
    if (r.sub === "merge" && r.diffstat) return r.diffstat.files.length > 6 ? `+${r.diffstat.files.length - 6} files` : null;
    return null;
  }
  if (r.kind === "compose") { const n = r.resources.length; return n > 5 ? `+${n - 5} resources` : null; }
  return null;
}

// dispatch + inline preview, with a bottom "expand" bar when output overflows
function ExecOutput({ out, onExpand }) {
  const r = out.outputRender;
  const kind = r ? r.kind : "plain";
  const overflow = execOverflow(out); // "+N lines" | null
  const moreLabel = overflow ? (() => {
    const m = overflow.replace(/^\+/, "").match(/^(\d+)\s+(.*)$/);
    return m ? `Expand · ${m[1]} more ${m[2]}` : `Expand · ${overflow}`;
  })() : null;

  const body =
    kind === "diff" ? <DiffView r={r} />
    : kind === "tests" ? <TestsView r={r} />
    : kind === "status" ? <StatusView r={r} />
    : kind === "table" ? <TableView r={r} />
    : kind === "file" ? <FileView r={r} />
    : kind === "matches" ? <MatchesView r={r} />
    : kind === "http" ? <HttpView r={r} />
    : kind === "build" ? <BuildView r={r} />
    : kind === "trace" ? <TraceView r={r} />
    : kind === "lint" ? <LintView r={r} />
    : kind === "tree" ? <TreeView r={r} />
    : kind === "log" ? <LogView r={r} />
    : kind === "json" ? <JsonView r={r} />
    : kind === "diffstat" ? <DiffstatView r={r} />
    : kind === "git" ? <GitView r={r} out={out} />
    : kind === "compose" ? <ComposeView r={r} />
    : <PlainOut output={out.output} />;

  const label = { diff: "DIFF", tests: "TEST RESULTS", status: "GIT STATUS", table: `${(out.outputRender && out.outputRender.totalRows) || ""} ROWS`.trim() || "TABLE", file: `FILE · ${((out.outputRender && out.outputRender.path) || "").split("/").pop()}`, matches: `${(r && r.kind === "matches") ? r.files.reduce((a, f) => a + f.matches.length, 0) : ""} MATCHES`.trim() || "MATCHES", http: `HTTP ${(r && r.status) || ""}`.trim(), build: `BUILD${r && r.errors ? ` · ${r.errors} ERR` : ""}`, trace: `TRACE · ${(r && r.exception) || ""}`.trim(), lint: `LINT${r && (r.errors + r.warnings) ? ` · ${r.errors + r.warnings}` : ""}`, tree: `TREE${r && r.totalEntries ? ` · ${r.totalEntries}` : ""}`, log: "GIT LOG", json: `JSON · ${(((r && r.source) || "").split("/").pop()) || "data"}`, diffstat: `DIFFSTAT${r && r.totals ? ` · ${r.totals.files} FILES` : ""}`, git: `GIT · ${(r && r.sub ? r.sub.toUpperCase() : "")}`, compose: `COMPOSE${r && r.resources ? ` · ${r.resources.length} RES` : ""}`, plain: `STDOUT · ${(out.output || "").length} bytes` }[kind];

  return (
    <div className={"out xr-out" + (out.fail ? " fail" : "")}>
      {kind !== "http" && (
        <div className="xr-out-hd">
          <span className="xr-kind" data-kind={kind}>{label}</span>
          {out.fail && <span className="xr-failtag">FAILED</span>}
        </div>
      )}
      {body}
      {moreLabel && (
        <button className="xr-expand" onClick={(ev) => { ev.stopPropagation(); onExpand && onExpand(); }}>{moreLabel} ›</button>
      )}
    </div>
  );
}

// full-output modal — same renderers, scrollable, with header context + raw escape hatch
function ExecModal({ ev, out, onClose }) {
  const [raw, setRaw] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const r = out.outputRender;
  const kind = r ? r.kind : "plain";
  const cmd = ev.command_preview || (ev.args && ev.args.cmd ? ev.args.cmd.join(" ") : ev.name);
  const body = raw ? <PlainOut output={out.output} full />
    : kind === "diff" ? <DiffView r={r} full />
    : kind === "tests" ? <TestsView r={r} full />
    : kind === "status" ? <StatusView r={r} full />
    : kind === "table" ? <TableView r={r} full />
    : kind === "file" ? <FileView r={r} full />
    : kind === "matches" ? <MatchesView r={r} full />
    : kind === "http" ? <HttpView r={r} full />
    : kind === "build" ? <BuildView r={r} full />
    : kind === "trace" ? <TraceView r={r} full />
    : kind === "lint" ? <LintView r={r} full />
    : kind === "tree" ? <TreeView r={r} full />
    : kind === "log" ? <LogView r={r} full />
    : kind === "json" ? <JsonView r={r} full />
    : kind === "diffstat" ? <DiffstatView r={r} full />
    : kind === "git" ? <GitView r={r} out={out} full />
    : kind === "compose" ? <ComposeView r={r} full />
    : <PlainOut output={out.output} full />;
  return (
    <div className="xr-modal-scrim" onClick={onClose}>
      <div className="xr-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="xr-modal-hd">
          <span className="xr-modal-kind" data-kind={kind}>{kind.toUpperCase()}</span>
          <span className="xr-modal-cmd num">$ {cmd}</span>
          <span className="spacer"></span>
          <span className={"chip " + (out.fail ? "warn" : "good")}>exit {out.exit} · {Math.round(out.ts - ev.ts)}ms</span>
          {r && <button className="xr-raw-btn" data-on={raw} onClick={() => setRaw((v) => !v)}>{raw ? "FORMATTED" : "RAW"}</button>}
          <button className="xr-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="xr-modal-body">{body}</div>
      </div>
    </div>
  );
}
