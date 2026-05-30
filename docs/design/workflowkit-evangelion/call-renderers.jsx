/* ============================================================
   CALL RENDERERS  (shared: Observatory + Component Library)
   Sibling class to the exec OUTPUT renderers. These render the
   tool_call INVOCATION side — dispatched by event `name` (via
   ev.callRender), complementary to ExecOutput which renders the
   tool_output by outputRender.kind.
   apply_patch is the flagship: a COMPOSITE that reuses the diff
   line vocabulary for the patch body + an M/A/D write summary.
   Depends on exec-renderers.jsx (PlainOut) loaded first.
   kinds: patch · read · search_call · fetch · agent · skill
   ============================================================ */

// apply_patch / write_file — patch body (Update/Add/Delete/Move) + write summary
function PatchView({ r, out, full }) {
  const CAP = 8; // total hunk lines inline across all files
  let shown = 0;
  const opLabel = { update: "UPDATE", add: "ADD", delete: "DELETE", move: "MOVE" };
  const opCls = { update: "upd", add: "add", delete: "del", move: "mov" };
  const code = { update: "M", add: "A", delete: "D", move: "R" };
  const totals = r.files.reduce((a, f) => ({ add: a.add + (f.added || 0), del: a.del + (f.removed || 0) }), { add: 0, del: 0 });
  const resultLine = out && (out.output || "").split("\n")[0];
  return (
    <div className="xr xr-patch">
      <div className="xr-patch-hd">
        <span className="files">{r.files.length} file{r.files.length > 1 ? "s" : ""}</span>
        <span className="adds">+{totals.add}</span>
        <span className="dels">−{totals.del}</span>
      </div>
      {r.files.map((f, fi) => (
        <div key={fi} className="xr-patch-file">
          <div className="xr-patch-file-hd">
            <span className={"op " + opCls[f.op]}>{opLabel[f.op]}</span>
            <span className="path">{f.path}{f.op === "move" && f.newPath ? <span className="moveto"> → {f.newPath}</span> : null}</span>
            {(f.added || f.removed) ? <span className="cnt"><span className="a">+{f.added || 0}</span><span className="d">−{f.removed || 0}</span></span> : null}
          </div>
          {(f.hunks || []).map((h, hi) => (
            <div key={hi} className="xr-hunk">
              {h.header && <div className="xr-hunk-hd">{h.header}</div>}
              {h.lines.map((ln, li) => {
                if (!full && shown >= CAP) return null;
                shown++;
                return (
                  <div key={li} className={"xr-line " + ln.t}>
                    <span className="g">{ln.t === "add" ? "+" : ln.t === "del" ? "−" : " "}</span>
                    <span className="c">{ln.text === "" ? "\u00a0" : ln.text}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      {out && (
        <div className={"xr-patch-result" + (out.fail ? " fail" : "")}>
          <span className="rk">{out.fail ? "✗" : "✓"}</span>
          <span className="rt">{out.fail ? "patch failed" : (resultLine || "patch applied")}</span>
          <span className="rcodes">
            {r.files.map((f, i) => (
              <span key={i} className={"rc " + opCls[f.op]}><span className="cd">{code[f.op]}</span>{f.path.split("/").pop()}</span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

// read_file — path + line range, bytes/lines read
function ReadView({ r, out }) {
  return (
    <div className="xr xr-call-line">
      <span className="cl-icon">≡</span>
      <span className="cl-path">{r.path}</span>
      {r.startLine != null && <span className="cl-meta num">L{r.startLine}{r.endLine ? `–${r.endLine}` : ""}</span>}
      {r.totalLines != null && <span className="cl-res num">{r.totalLines} lines</span>}
    </div>
  );
}

// grep / search_files — pattern + scope, hit count (the REQUEST; MatchesView is the result)
function SearchCallView({ r }) {
  return (
    <div className="xr xr-call-line">
      <span className="cl-icon">⌕</span>
      <span className="cl-pat">/{r.pattern}/{r.flags || ""}</span>
      {r.path && <span className="cl-scope">{r.path}</span>}
      {r.hits != null && <span className={"cl-res num" + (r.hits === 0 ? " zero" : "")}>{r.hits} hit{r.hits === 1 ? "" : "s"}</span>}
    </div>
  );
}

// web_search / web_fetch — query / URL + result count
function FetchView({ r }) {
  const isFetch = r.mode === "fetch";
  return (
    <div className="xr xr-call-line">
      <span className={"cl-mode " + (isFetch ? "get" : "srch")}>{isFetch ? "GET" : "WEB"}</span>
      <span className="cl-q">{r.query || r.url}</span>
      {r.results != null && <span className="cl-res num">{r.results} result{r.results === 1 ? "" : "s"}</span>}
      {r.status != null && <span className="cl-res num">{r.status}</span>}
    </div>
  );
}

// spawn_agent / wait_agent / send_input — agent ops
function AgentView({ r }) {
  const icon = r.op === "spawn" ? "⊕" : r.op === "send" ? "→" : "◌";
  const opCls = r.op === "spawn" ? "spawn" : r.op === "send" ? "send" : "wait";
  const resTone = (r.status === "open" || r.status === "ok") ? "ok"
    : (r.status === "failed" || r.status === "timed_out") ? "warn" : "";
  const waitTargets = r.targets ? r.targets.join(", ") : r.threadId;
  return (
    <div className="xr xr-call-line agent">
      <span className={"cl-op " + opCls}>{icon}</span>
      {r.op === "spawn" ? (
        <>
          <span className="cl-nick">{r.nickname}</span>
          {r.role && <span className="cl-role">{r.role}</span>}
          <span className="cl-task">// {r.task}</span>
        </>
      ) : r.op === "send" ? (
        <>
          <span className="cl-nick">{r.nickname || r.target}</span>
          <span className="cl-task">// {r.message}</span>
        </>
      ) : (
        <span className="cl-q">await {waitTargets}{r.targets && r.targets.length > 1 ? ` (${r.targets.length})` : ""}…</span>
      )}
      {r.status && <span className={"cl-res " + resTone}>{r.status === "timed_out" ? "timed out" : r.status}</span>}
    </div>
  );
}

// skill_invoke — skill name + summary + status
function SkillView({ r }) {
  return (
    <div className="xr xr-call-line">
      <span className="cl-skill">{r.name}</span>
      <span className="cl-q">{r.summary}</span>
      {r.status && <span className={"cl-res " + (r.status === "ok" ? "ok" : "warn")}>{r.status}</span>}
    </div>
  );
}

// tool_search — tool-catalog discovery. Collapsed = search-call line (⌕ query · N tools);
// expanded = a namespace → function tree (function name + summary + param chips).
function ToolSearchView({ r, full }) {
  const CAP = 4; // functions shown inline across namespaces
  let shown = 0;
  return (
    <div className="xr xr-toolsearch">
      <div className="xr-ts-line">
        <span className="cl-icon">⌕</span>
        <span className="cl-q">"{r.query}"</span>
        <span className="cl-res num">{r.resultCount} tool{r.resultCount === 1 ? "" : "s"}</span>
      </div>
      {r.namespaces.map((ns, ni) => {
        if (!full && shown >= CAP) return null;
        const fns = full ? ns.functions : ns.functions.slice(0, Math.max(0, CAP - shown));
        shown += fns.length;
        return (
          <div key={ni} className="xr-ts-ns">
            <div className="xr-ts-ns-hd">
              <span className="ns-name">{ns.name}</span>
              {ns.description && <span className="ns-desc">{ns.description}</span>}
            </div>
            {fns.map((fn, fi) => (
              <div key={fi} className="xr-ts-fn">
                <span className="br">{fi === ns.functions.length - 1 ? "└" : "├"}</span>
                <span className="fn-name">{fn.name}</span>
                {fn.summary && <span className="fn-sum">{fn.summary}</span>}
                {fn.params && fn.params.length > 0 && (
                  <span className="fn-params">
                    {fn.params.slice(0, 4).map((p, pi) => <span key={pi} className="pchip">{p}</span>)}
                    {fn.params.length > 4 && <span className="pmore">+{fn.params.length - 4}</span>}
                  </span>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// dispatch the call body on ev.callRender.kind
function CallView({ ev, out, full }) {
  const r = ev.callRender;
  const kind = r ? r.kind : null;
  return kind === "patch" ? <PatchView r={r} out={out} full={full} />
    : kind === "read" ? <ReadView r={r} out={out} />
    : kind === "search_call" ? <SearchCallView r={r} />
    : kind === "fetch" ? <FetchView r={r} />
    : kind === "agent" ? <AgentView r={r} />
    : kind === "skill" ? <SkillView r={r} />
    : kind === "tool_search" ? <ToolSearchView r={r} full={full} />
    : <PlainOut output={out ? out.output : ""} full={full} />;
}

// does this call overflow its inline preview? (patch bodies + tool_search trees)
function callOverflow(ev) {
  const r = ev.callRender;
  if (!r) return null;
  if (r.kind === "patch") {
    let n = 0; r.files.forEach((f) => (f.hunks || []).forEach((h) => { n += h.lines.length; }));
    return n > 8 ? `+${n - 8} lines` : null;
  }
  if (r.kind === "tool_search") {
    const n = r.namespaces.reduce((a, ns) => a + ns.functions.length, 0);
    return n > 4 ? `+${n - 4} tools` : null;
  }
  return null;
}

// call kind → label + data-kind (color) for the output-block header
function callMeta(ev) {
  const r = ev.callRender || {};
  switch (r.kind) {
    case "patch": return { kind: "patch", label: `PATCH · ${r.files.length} file${r.files.length > 1 ? "s" : ""}` };
    case "read": return { kind: "read", label: "READ" };
    case "search_call": return { kind: "search_call", label: "SEARCH" };
    case "fetch": return { kind: "fetch", label: r.mode === "fetch" ? "WEB FETCH" : "WEB SEARCH" };
    case "agent": return { kind: "agent", label: r.op === "spawn" ? "SPAWN AGENT" : r.op === "send" ? "SEND INPUT" : "WAIT AGENT" };
    case "skill": return { kind: "skill", label: `SKILL · ${r.name}` };
    case "tool_search": return { kind: "tool_search", label: `TOOL SEARCH · ${r.resultCount} tool${r.resultCount === 1 ? "" : "s"}` };
    default: return { kind: "plain", label: ev.name ? ev.name.toUpperCase() : "CALL" };
  }
}

// inline preview wrapper (mirrors ExecOutput): label header + body + expand bar
function CallOutput({ ev, out, onExpand }) {
  const meta = callMeta(ev);
  const overflow = callOverflow(ev);
  const moreLabel = overflow ? (() => {
    const m = overflow.replace(/^\+/, "").match(/^(\d+)\s+(.*)$/);
    return m ? `Expand · ${m[1]} more ${m[2]}` : `Expand · ${overflow}`;
  })() : null;
  return (
    <div className={"out xr-out" + (out && out.fail ? " fail" : "")}>
      <div className="xr-out-hd">
        <span className="xr-kind" data-kind={meta.kind}>{meta.label}</span>
        {out && out.fail && <span className="xr-failtag">FAILED</span>}
      </div>
      <CallView ev={ev} out={out} />
      {moreLabel && (
        <button className="xr-expand" onClick={(e) => { e.stopPropagation(); onExpand && onExpand(); }}>{moreLabel} ›</button>
      )}
    </div>
  );
}

// full-call modal — same renderers, scrollable, with header context + raw escape hatch
function CallModal({ ev, out, onClose }) {
  const [raw, setRaw] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const meta = callMeta(ev);
  return (
    <div className="xr-modal-scrim" onClick={onClose}>
      <div className="xr-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="xr-modal-hd">
          <span className="xr-modal-kind" data-kind={meta.kind}>{(ev.name || meta.kind).toUpperCase()}</span>
          <span className="xr-modal-cmd num">call_id {ev.call_id}</span>
          <span className="spacer"></span>
          {out && <span className={"chip " + (out.fail ? "warn" : "good")}>exit {out.exit} · {Math.round(out.ts - ev.ts)}ms</span>}
          {out && out.output && <button className="xr-raw-btn" data-on={raw} onClick={() => setRaw((v) => !v)}>{raw ? "FORMATTED" : "RAW"}</button>}
          <button className="xr-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="xr-modal-body">
          {raw ? <PlainOut output={out ? out.output : ""} full /> : <CallView ev={ev} out={out} full />}
        </div>
      </div>
    </div>
  );
}
