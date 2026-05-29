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
  return (
    <div className="xr xr-table-wrap">
      <table className="xr-table">
        <thead><tr>{r.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="num">{cell}</td>)}</tr>
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
      <div className="xr-http-req">
        <span className="method">{r.method || "GET"}</span>
        <span className="url">{r.url}</span>
      </div>
      <div className="xr-http-status">
        <span className={"code " + statusClass}>{r.status}</span>
        <span className="reason">{r.statusText || ""}</span>
        {r.durationMs != null && <span className="t num">{r.durationMs}ms</span>}
        {r.size != null && <span className="sz num">{r.size}</span>}
      </div>
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
    : <PlainOut output={out.output} />;

  const label = { diff: "DIFF", tests: "TEST RESULTS", status: "GIT STATUS", table: `${(out.outputRender && out.outputRender.totalRows) || ""} ROWS`.trim() || "TABLE", file: `FILE · ${((out.outputRender && out.outputRender.path) || "").split("/").pop()}`, matches: `${(r && r.kind === "matches") ? r.files.reduce((a, f) => a + f.matches.length, 0) : ""} MATCHES`.trim() || "MATCHES", http: `HTTP ${(r && r.status) || ""}`.trim(), plain: `STDOUT · ${(out.output || "").length} bytes` }[kind];

  return (
    <div className={"out xr-out" + (out.fail ? " fail" : "")}>
      <div className="xr-out-hd">
        <span className="xr-kind" data-kind={kind}>{label}</span>
        {out.fail && <span className="xr-failtag">FAILED</span>}
      </div>
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
