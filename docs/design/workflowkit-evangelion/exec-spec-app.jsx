/* ============================================================
   EXEC RENDERERS — FULL SPEC · app layer
   Renders the full specification: shared envelope contract, one
   spec sheet per renderer kind (schema · behavior · tokens ·
   states · LIVE example via the real renderers), and appendices.
   Depends on globals from exec-renderers.jsx (ExecOutput, ExecModal)
   and exec-spec-data.jsx (EXEC_SPECS, EXEC_ENVELOPE).
   ============================================================ */

const { useState } = React;
const SPECS = window.EXEC_SPECS;
const ENVELOPE = window.EXEC_ENVELOPE;
const CALL_SPECS = window.CALL_SPECS;
const CALL_ENVELOPE = window.CALL_ENVELOPE;

// display order: group order, then number within group
const GROUP_ORDER = ["READING THE REPO", "EXECUTION & DIAGNOSTICS", "STATE & FALLBACK"];
const ORDERED = [...SPECS].sort((a, b) => {
  const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
  return g !== 0 ? g : a.n.localeCompare(b.n);
});
const CALL_GROUP_ORDER = ["FILE OPERATIONS", "RESEARCH & AGENTS"];
const CALL_ORDERED = [...CALL_SPECS].sort((a, b) => {
  const g = CALL_GROUP_ORDER.indexOf(a.group) - CALL_GROUP_ORDER.indexOf(b.group);
  return g !== 0 ? g : a.n.localeCompare(b.n);
});

// Lightweight TS-ish colorizer for schema blocks: comments, strings, numbers.
function Code({ text }) {
  const lines = text.split("\n");
  return (
    <pre className="code">
      {lines.map((line, li) => {
        if (/^\s*\/\//.test(line)) {
          return <div key={li} className="cl"><span className="cm">{line || "\u00a0"}</span></div>;
        }
        const parts = line.split(/("(?:[^"\\]|\\.)*")/g);
        return (
          <div key={li} className="cl">
            {parts.length === 1 && parts[0] === "" ? "\u00a0" : parts.map((p, i) => {
              if (/^".*"$/.test(p)) return <span key={i} className="str">{p}</span>;
              // split out // trailing comments + numbers in the non-string segment
              const cidx = p.indexOf("//");
              if (cidx >= 0) {
                return (
                  <span key={i}>
                    <Frag s={p.slice(0, cidx)} />
                    <span className="cm">{p.slice(cidx)}</span>
                  </span>
                );
              }
              return <Frag key={i} s={p} />;
            })}
          </div>
        );
      })}
    </pre>
  );
}
// number-highlighting fragment
function Frag({ s }) {
  const bits = s.split(/(\b\d+\b)/g);
  return <>{bits.map((b, i) => /^\d+$/.test(b) ? <span key={i} className="numlit">{b}</span> : <span key={i}>{b}</span>)}</>;
}

// a single live render, framed like an Observatory timeline event row
function LiveFrame({ sample, onOpen }) {
  const { ev, out, isCall } = sample.s;
  const toneLabel = sample.tone === "fail" ? "FAILURE" : sample.tone === "ok" ? "SUCCESS" : sample.tone === "empty" ? "EMPTY" : "TRUNCATED";
  return (
    <div className="live-item">
      <div className="live-cap">
        <span className="li-label">{sample.label}</span>
        <span className="li-tone" data-tone={sample.tone}>{toneLabel}</span>
      </div>
      <div className={"ev-faux" + (out.fail ? " fail" : "")}>
        {isCall ? (
          <React.Fragment>
            <div className="head">
              <span className="who">▸ {ev.name.toUpperCase()}</span>
              <span className="cmd">call_id {ev.call_id}</span>
            </div>
            <CallOutput ev={ev} out={out} onExpand={() => onOpen(sample.s)} />
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="head">
              <span className="who">▸ EXEC_COMMAND</span>
              <span className="cmd">$ {ev.command_preview}</span>
            </div>
            <ExecOutput out={out} onExpand={() => onOpen(sample.s)} />
          </React.Fragment>
        )}
      </div>
      <div className="li-note">{sample.note}</div>
    </div>
  );
}

function SpecSheet({ spec, onOpen }) {
  const isCall = spec.n[0] === "C";
  const srcFile = isCall ? "call-renderers.jsx" : "exec-renderers.jsx";
  const schemaLabel = isCall ? "SCHEMA · callRender" : "SCHEMA · outputRender";
  return (
    <section className="sheet" id={spec.id}>
      <header className="sheet-hd">
        <div className="n" style={{ color: `var(${spec.accent})` }}>{spec.n}</div>
        <div className="ttl">
          <div className="ttl-row">
            <h2>{spec.title}</h2>
            <code className="comp">&lt;{spec.name} /&gt;</code>
          </div>
          <div className="desc">{spec.desc}</div>
        </div>
        <div className="trig">
          <span className="trig-lbl">TRIGGERS</span>
          <span className="trig-v">{spec.triggers}</span>
        </div>
      </header>

      <div className="sheet-grid">
        {/* LEFT — live renders */}
        <div className="col col-live">
          <div className="col-lbl"><span className="dot" style={{ background: `var(${spec.accent})`, boxShadow: `0 0 6px var(${spec.accent})` }}></span>LIVE · {srcFile}</div>
          <div className="live-stack">
            {spec.samples.map((s, i) => <LiveFrame key={i} sample={s} onOpen={onOpen} />)}
          </div>
        </div>

        {/* RIGHT — spec */}
        <div className="col col-doc">
          <div className="doc-block">
            <div className="doc-lbl">{schemaLabel}</div>
            <Code text={spec.schema} />
          </div>

          <div className="doc-grid">
            <div className="doc-block">
              <div className="doc-lbl">BEHAVIOR</div>
              <table className="kv">
                <tbody>
                  {spec.behavior.map(([k, v], i) => (
                    <tr key={i}><th>{k}</th><td>{v}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="doc-block">
              <div className="doc-lbl">STATES</div>
              <div className="chip-row">
                {spec.states.map(([label, tone], i) => (
                  <span key={i} className="st-chip" data-tone={tone}>{label}</span>
                ))}
              </div>
              <div className="doc-lbl" style={{ marginTop: 14 }}>TOKENS</div>
              <div className="chip-row">
                {spec.tokens.map(([label, varname], i) => (
                  <span key={i} className="tok-chip">
                    <i style={{ background: `var(${varname})` }}></i>
                    <b>{label}</b>
                    <code>{varname}</code>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Envelope({ variant }) {
  const isCall = variant === "call";
  const env = isCall ? CALL_ENVELOPE : ENVELOPE;
  const flow = env.pipeline;
  const id = isCall ? "call-envelope" : "envelope";
  const n = isCall ? "C0" : "00";
  const title = isCall ? "THE CALL ENVELOPE" : "THE ENVELOPE";
  const comp = isCall ? "tool_call ↔ tool_output" : "exec_command · (ev, out)";
  const src = isCall ? "call-renderers.jsx" : "exec-renderers.jsx";
  return (
    <section className="sheet envelope" id={id}>
      <header className="sheet-hd">
        <div className="n">{n}</div>
        <div className="ttl">
          <div className="ttl-row">
            <h2>{title}</h2>
            <code className="comp">{comp}</code>
          </div>
          <div className="desc">
            {isCall
              ? <React.Fragment>The sibling contract. A <code className="inl">tool_call</code> carries the invocation; the server parses its args into <code className="inl">callRender</code> JSON, dispatched by tool <code className="inl">name</code> — complementary to <code className="inl">outputRender</code>, which is keyed on output <code className="inl">.kind</code>. The paired <code className="inl">tool_output</code> (by <code className="inl">call_id</code>) supplies the result.</React.Fragment>
              : <React.Fragment>Every renderer rides the same contract. The server parses each result once into <code className="inl">outputRender</code> JSON; a <code className="inl">.kind</code> discriminant dispatches the component. No client-side parsing.</React.Fragment>}
          </div>
        </div>
        <div className="trig">
          <span className="trig-lbl">SOURCE</span>
          <span className="trig-v">{src}</span>
        </div>
      </header>

      <div className="sheet-grid">
        <div className="col col-live">
          <div className="col-lbl"><span className="dot"></span>{isCall ? "CALL CONTRACT" : "SHARED CONTRACT"}</div>
          <div className="doc-block"><Code text={env.schema} /></div>
        </div>
        <div className="col col-doc">
          <div className="doc-block">
            <div className="doc-lbl">{isCall ? "CALL PIPELINE" : "RENDER PIPELINE"}</div>
            <div className="pipe">
              {flow.map((step, i) => (
                <React.Fragment key={i}>
                  <span className={"pipe-box" + (i === 2 ? " accent" : "") + (i >= 3 ? " stage" : "")}>{step}</span>
                  {i < flow.length - 1 && <span className="pipe-arr">{i === 2 || i === 3 || i === 4 ? "↓" : "→"}</span>}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="doc-block">
            <div className="doc-lbl">{isCall ? "DISPATCH & DISCLOSURE" : "PROGRESSIVE DISCLOSURE"}</div>
            <table className="kv">
              <tbody>
                {isCall ? (
                  <React.Fragment>
                    <tr><th>Dispatch</th><td>by event <code className="inl">name</code> → <code className="inl">callRender.kind</code></td></tr>
                    <tr><th>Composite</th><td><code className="inl">apply_patch</code> reuses the diff vocabulary + M/A/D strip</td></tr>
                    <tr><th>Overflow</th><td>only patch bodies overflow; light calls are single-line</td></tr>
                    <tr><th>Result</th><td>paired <code className="inl">tool_output</code> supplies counts / status</td></tr>
                  </React.Fragment>
                ) : (
                  <React.Fragment>
                    <tr><th>Preview</th><td>capped inline render — every kind defines its own cap</td></tr>
                    <tr><th>Expand bar</th><td>shown only on overflow; label = <code className="inl">execOverflow(out)</code></td></tr>
                    <tr><th>Modal</th><td>same component, <code className="inl">full</code> — scrollable, no truncation</td></tr>
                    <tr><th>RAW</th><td>escape hatch in modal → unstructured <code className="inl">out.output</code></td></tr>
                  </React.Fragment>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

// Appendix — cap summary + full color-token legend in one reference table
function Appendix() {
  const toRow = (s) => {
    const cap = s.behavior.find((b) => b[0] === "Inline cap");
    const of = s.behavior.find((b) => b[0] === "Overflow");
    return { name: s.name, kind: s.id, accent: s.accent, cap: cap ? cap[1] : "—", of: of ? of[1] : "—", triggers: s.triggers };
  };
  const rows = [
    { sep: "OUTPUT RENDERERS · by outputRender.kind" },
    ...ORDERED.map(toRow),
    { sep: "CALL RENDERERS · by tool name" },
    ...CALL_ORDERED.map(toRow),
  ];
  return (
    <section className="appendix" id="appendix">
      <header className="app-hd">
        <h2>APPENDIX · CAP &amp; OVERFLOW MATRIX</h2>
        <span className="app-sub">every renderer at a glance</span>
      </header>
      <table className="matrix">
        <thead>
          <tr><th>KIND</th><th>COMPONENT</th><th>TRIGGERS</th><th>INLINE CAP</th><th>OVERFLOW LABEL</th></tr>
        </thead>
        <tbody>
          {rows.map((c, i) => (
            c.sep ? (
              <tr key={i} className="mx-sep"><td colSpan="5">{c.sep}</td></tr>
            ) : (
              <tr key={i}>
                <td><span className="mx-kind" style={{ color: `var(${c.accent})` }}><i style={{ background: `var(${c.accent})` }}></i>{c.kind}</span></td>
                <td><code>&lt;{c.name} /&gt;</code></td>
                <td className="dim">{c.triggers}</td>
                <td>{c.cap}</td>
                <td className="ov">{c.of}</td>
              </tr>
            )
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ClassBanner({ n, title, sub, id }) {
  return (
    <div className="class-banner" id={id}>
      <span className="cb-n">CLASS {n}</span>
      <span className="cb-title">{title}</span>
      <span className="cb-sub">{sub}</span>
    </div>
  );
}

function SheetGroup({ specs, onOpen }) {
  return specs.map((s, i) => {
    const newGroup = i === 0 || specs[i - 1].group !== s.group;
    return (
      <React.Fragment key={s.id}>
        {newGroup && (
          <div className="group-divider">
            <span className="gd-line"></span>
            <span className="gd-name">{s.group}</span>
            <span className="gd-line"></span>
          </div>
        )}
        <SpecSheet spec={s} onOpen={onOpen} />
      </React.Fragment>
    );
  });
}

function SpecApp() {
  const [modal, setModal] = useState(null);
  const open = (s) => setModal(s);
  return (
    <div className="lib">
      <header className="lib-head">
        <div className="mark"></div>
        <div>
          <h1>EXEC RENDERERS</h1>
          <div className="sub">// full specification · output renderers + call renderers</div>
        </div>
        <div className="meta">
          <div><b>SOURCE</b> exec · call-renderers.jsx</div>
          <div><b>KINDS</b> {SPECS.length} output · {CALL_SPECS.length} call</div>
          <div><b>USED BY</b> <a href="Observatory.html">Observatory ↗</a></div>
        </div>
      </header>

      <nav className="toc">
        <span className="toc-lbl">CONTENTS</span>
        <a href="#class-1" className="toc-cls">I · OUTPUT</a>
        <a href="#envelope"><i>00</i> Envelope</a>
        {ORDERED.map((s) => <a key={s.id} href={"#" + s.id}><i>{s.n}</i> {s.title}</a>)}
        <a href="#class-2" className="toc-cls">II · CALL</a>
        <a href="#call-envelope"><i>C0</i> Call Envelope</a>
        {CALL_ORDERED.map((s) => <a key={s.id} href={"#" + s.id}><i>{s.n}</i> {s.title}</a>)}
        <a href="#appendix"><i>▦</i> Appendix</a>
      </nav>

      <ClassBanner n="I" id="class-1" title="OUTPUT RENDERERS" sub="render the tool_output · dispatched by outputRender.kind" />
      <Envelope variant="output" />
      <SheetGroup specs={ORDERED} onOpen={open} />

      <ClassBanner n="II" id="class-2" title="CALL RENDERERS" sub="render the tool_call · dispatched by event name" />
      <Envelope variant="call" />
      <SheetGroup specs={CALL_ORDERED} onOpen={open} />

      <Appendix />

      <div className="lib-footer">
        <div>// WORKFLOWKIT · OBSERVATORY</div>
        <div className="center">EXEC RENDERERS · 出力描画 · FULL SPEC</div>
        <div style={{ textAlign: "right" }}>v0.5 · 2026.05.30</div>
      </div>

      {modal && (modal.isCall
        ? <CallModal ev={modal.ev} out={modal.out} onClose={() => setModal(null)} />
        : <ExecModal ev={modal.ev} out={modal.out} onClose={() => setModal(null)} />)}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<SpecApp />);
