/* ============================================================
   subagent_notification renderer
   When a child agent reports status, the host injects a
   <subagent_notification> block into the parent's context:

     { agent_path, status: { <state>: "<markdown report>" } }

   The status body is a structured findings report — bold section
   headers, bulleted findings each carrying a **Confidence:** marker
   and inline ([domain](url)) citations, a Contradictions section,
   and a Source List. This renderer parses that once and renders a
   capped INLINE preview + a full scrollable MODAL (same renderer),
   with a RAW escape hatch. Class prefix: sn-  ·  reuses .xr-modal* chrome.
   Uses React.* directly so the file is self-sufficient.
   ============================================================ */

/* ---- status states → tone + glyph + label ---- */
const SN_STATUS = {
  completed:   { tone: "good",  glyph: "✓", label: "COMPLETED" },
  done:        { tone: "good",  glyph: "✓", label: "COMPLETED" },
  in_progress: { tone: "amber", glyph: "◌", label: "IN PROGRESS" },
  running:     { tone: "amber", glyph: "◌", label: "RUNNING" },
  update:      { tone: "amber", glyph: "↻", label: "STATUS UPDATE" },
  blocked:     { tone: "cyan",  glyph: "⏸", label: "BLOCKED" },
  waiting:     { tone: "cyan",  glyph: "⏸", label: "WAITING" },
  failed:      { tone: "warn",  glyph: "✗", label: "FAILED" },
  error:       { tone: "warn",  glyph: "✗", label: "ERROR" },
};
function snStatus(key) {
  return SN_STATUS[String(key || "").toLowerCase()] || { tone: "primary", glyph: "▸", label: String(key || "STATUS").toUpperCase() };
}

/* ---- confidence label → tone + rank ---- */
function snConf(label) {
  if (!label) return { tone: "unknown", label: null, rank: 0 };
  const l = label.toLowerCase();
  const hasHigh = /high/.test(l), hasMed = /medium|moderate/.test(l), hasLow = /low/.test(l);
  let tone, rank;
  if (hasLow && (hasMed || hasHigh)) { tone = "mixed"; rank = 2; }
  else if (hasHigh && !hasMed && !hasLow) { tone = "high"; rank = 3; }
  else if (hasMed && !hasLow && !hasHigh) { tone = "med"; rank = 2; }
  else if (hasLow) { tone = "low"; rank = 1; }
  else { tone = "med"; rank = 2; }
  return { tone, label: label.trim(), rank };
}
const SN_CONF_COLOR = { high: "var(--good)", med: "var(--amber)", mixed: "var(--amber)", low: "var(--warn-bright)", unknown: "var(--ink-dim)" };

/* ---- citation extraction: ([label](url)) and bare [label](url) ---- */
const SN_CITE_RE = /\(?\[([^\]]+)\]\(([^)]+)\)\)?/g;

/* ---- parse one bullet into { prose, confidence, citations, sourceNote } ---- */
function snParseItem(text) {
  const citations = [];
  let m;
  SN_CITE_RE.lastIndex = 0;
  while ((m = SN_CITE_RE.exec(text))) citations.push({ domain: m[1].trim(), url: m[2].trim() });

  // confidence marker (bold) — capture then strip
  let confidence = null;
  const cm = text.match(/\*\*\s*Confidence:\s*([^.*]+?)\.?\s*\*\*/i);
  if (cm) confidence = cm[1].trim();

  let prose = text
    .replace(SN_CITE_RE, " ")
    .replace(/\*\*\s*Confidence:[^*]*\*\*/i, " ");

  // split off a trailing "Sources:/Source:" note (the plain-text citation list)
  let sourceNote = null;
  const si = prose.search(/\bSources?:/i);
  if (si >= 0) {
    sourceNote = prose.slice(si).replace(/^\s*Sources?:\s*/i, "").trim().replace(/\s{2,}/g, " ");
    prose = prose.slice(0, si);
  }
  prose = prose.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/[\s.;,]+$/, "").trim();

  // de-dup citations by domain (keep first url)
  const seen = new Set();
  const uniq = [];
  citations.forEach((c) => { if (!seen.has(c.domain)) { seen.add(c.domain); uniq.push(c); } });

  return { prose, confidence, citations: uniq, sourceNote };
}

/* ---- classify a section by its header ---- */
function snSectionType(title) {
  if (!title) return "findings";
  if (/contradict|uncertaint|risk|open question|conflict/i.test(title)) return "risk";
  if (/source/i.test(title)) return "sources";
  return "findings";
}

/* ---- parse the full markdown report body into sections ---- */
function snParseReport(body) {
  const lines = String(body || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let buf = [];
  const flush = () => { if (buf.length) { blocks.push(buf.join("\n")); buf = []; } };
  for (const ln of lines) { if (ln.trim() === "") flush(); else buf.push(ln); }
  flush();

  const sections = [];
  let cur = null;
  const ensure = (title) => { cur = { title: title || null, type: snSectionType(title), items: [], paras: [] }; sections.push(cur); };

  for (const block of blocks) {
    const t = block.trim();
    const hdr = t.match(/^\*\*(.+?)\*\*$/s);
    if (hdr && !/^[-*]\s/.test(t) && !/\n/.test(t)) { ensure(hdr[1].trim()); continue; }
    if (!cur) ensure(null);
    if (/^\s*[-*]\s+/.test(t)) {
      let item = null;
      for (const raw of block.split("\n")) {
        if (/^\s*[-*]\s+/.test(raw)) { if (item != null) cur.items.push(snParseItem(item)); item = raw.replace(/^\s*[-*]\s+/, ""); }
        else if (item != null) item += " " + raw.trim();
      }
      if (item != null) cur.items.push(snParseItem(item));
    } else {
      cur.paras.push(t);
    }
  }
  return sections;
}

/* ---- derive headline stats from parsed sections ---- */
function snStats(sections) {
  const findings = [];
  let contradictions = 0;
  const domains = new Set();
  sections.forEach((s) => {
    if (s.type === "findings") s.items.forEach((it) => findings.push(it));
    if (s.type === "risk") contradictions += s.items.length;
    s.items.forEach((it) => it.citations.forEach((c) => domains.add(c.domain)));
    s.paras.forEach((p) => { SN_CITE_RE.lastIndex = 0; let m; while ((m = SN_CITE_RE.exec(p))) domains.add(m[1].trim()); });
  });
  const dist = { high: 0, med: 0, low: 0, unknown: 0 };
  findings.forEach((f) => {
    const c = snConf(f.confidence);
    if (c.tone === "high") dist.high++;
    else if (c.tone === "low") dist.low++;
    else if (c.tone === "unknown") dist.unknown++;
    else dist.med++;
  });
  return { findings, contradictions, domains: Array.from(domains), dist };
}

/* small inline renderer: **bold** + [label](url) → React nodes */
function snRich(text, kp) {
  const nodes = [];
  const re = /\*\*(.+?)\*\*|\(?\[([^\]]+)\]\(([^)]+)\)\)?/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] != null) nodes.push(<b key={(kp || "r") + k++} className="sn-em">{m[1]}</b>);
    else nodes.push(<a key={(kp || "r") + k++} className="sn-clink" href={m[3]} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{m[2]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ---- citation chip ---- */
function SnCite({ c }) {
  return (
    <a className="sn-cite" href={c.url} target="_blank" rel="noreferrer" title={c.url} onClick={(e) => e.stopPropagation()}>
      <span className="sn-cite-glyph" aria-hidden="true">↗</span>
      <span className="sn-cite-dom">{c.domain}</span>
    </a>
  );
}

/* ---- confidence pill ---- */
function SnConfPill({ confidence, compact }) {
  const c = snConf(confidence);
  return (
    <span className={"sn-conf sn-conf-" + c.tone} title={confidence ? "Confidence: " + c.label : "Confidence not stated"}>
      <span className="sn-conf-dot" style={{ background: SN_CONF_COLOR[c.tone] }}></span>
      {!compact && <span className="sn-conf-lbl">{c.label || "—"}</span>}
    </span>
  );
}

/* ---- a single finding card ---- */
function SnFinding({ f, n }) {
  const c = snConf(f.confidence);
  return (
    <div className="sn-finding" data-conf={c.tone}>
      <div className="sn-finding-top">
        <span className="sn-fn-n num">{String(n).padStart(2, "0")}</span>
        <SnConfPill confidence={f.confidence} />
        <span className="sn-fn-rule" aria-hidden="true"></span>
        {f.citations.length > 0 && <span className="sn-fn-srccount num">{f.citations.length} src</span>}
      </div>
      <div className="sn-finding-prose">{snRich(f.prose, "f" + n)}</div>
      {f.citations.length > 0 && (
        <div className="sn-cites">{f.citations.map((c, i) => <SnCite key={i} c={c} />)}</div>
      )}
    </div>
  );
}

/* ---- confidence distribution bar ---- */
function SnDist({ dist, total }) {
  const seg = (n, tone) => n > 0 ? <span className="sn-dist-seg" style={{ flex: n, background: SN_CONF_COLOR[tone] }} title={tone + " · " + n}></span> : null;
  return (
    <span className="sn-dist" aria-hidden="true">
      {seg(dist.high, "high")}
      {seg(dist.med, "med")}
      {seg(dist.low, "low")}
      {seg(dist.unknown, "unknown")}
    </span>
  );
}

/* ---- the summary band (agent id + status + counts + dist) ---- */
function SnSummary({ notif, statusKey, stats }) {
  const st = snStatus(statusKey);
  const path = notif.agent_path || "";
  const shortPath = path.length > 13 ? path.slice(0, 8) + "…" + path.slice(-4) : path;
  return (
    <div className="sn-summary">
      <div className="sn-sum-id">
        <span className="sn-sum-glyph" data-tone={st.tone}>{st.glyph}</span>
        <span className="sn-sum-meta">
          <span className="sn-sum-nick">{notif.agent_nickname || "SUB-AGENT"}{notif.agent_role && <span className="sn-sum-role">· {notif.agent_role}</span>}</span>
          <span className="sn-sum-path num">agent_path {shortPath}</span>
        </span>
        <span className={"sn-status sn-status-" + st.tone}>{st.glyph} {st.label}</span>
      </div>
      <div className="sn-sum-counts">
        <span className="sn-count"><b className="num">{stats.findings.length}</b> findings</span>
        <span className="sn-count"><b className="num">{stats.domains.length}</b> sources</span>
        {stats.contradictions > 0 && <span className="sn-count warn"><b className="num">{stats.contradictions}</b> open</span>}
        <span className="sn-sum-dist">
          <SnDist dist={stats.dist} total={stats.findings.length} />
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   INLINE preview  — summary band + first N findings + expand bar
   ============================================================ */
const SN_INLINE_CAP = 2;
function SubagentOutput({ notif, onExpand }) {
  const [statusKey, body] = Object.entries(notif.status || { update: "" })[0];
  const sections = React.useMemo(() => snParseReport(body), [body]);
  const stats = React.useMemo(() => snStats(sections), [sections]);
  const shown = stats.findings.slice(0, SN_INLINE_CAP);
  const hiddenFindings = stats.findings.length - shown.length;
  const st = snStatus(statusKey);

  return (
    <div className="out xr-out sn-out" data-tone={st.tone}>
      <div className="xr-out-hd">
        <span className="xr-kind sn-kind" data-tone={st.tone}>SUBAGENT_NOTIFICATION</span>
        <span className="sn-hd-status" style={{ color: `var(--${st.tone === "primary" ? "primary" : st.tone})` }}>{st.glyph} {st.label}</span>
      </div>
      <SnSummary notif={notif} statusKey={statusKey} stats={stats} />
      <div className="sn-findings">
        {shown.map((f, i) => <SnFinding key={i} f={f} n={i + 1} />)}
        {stats.findings.length === 0 && (
          <div className="sn-empty">— no structured findings — status note only</div>
        )}
      </div>
      <button className="xr-expand" onClick={(e) => { e.stopPropagation(); onExpand && onExpand(); }}>
        Expand · {hiddenFindings > 0 ? `${hiddenFindings} more finding${hiddenFindings === 1 ? "" : "s"}` : "full report"}
        {stats.contradictions > 0 ? ` · ${stats.contradictions} open` : ""} ›
      </button>
    </div>
  );
}

/* overflow label (for hosts that want one) */
function subagentOverflow(notif) {
  const body = Object.values(notif.status || {})[0] || "";
  const stats = snStats(snParseReport(body));
  const hidden = Math.max(0, stats.findings.length - SN_INLINE_CAP);
  return hidden > 0 ? `+${hidden} findings` : "full report";
}

/* ============================================================
   MODAL — full report, every section, RAW escape hatch
   ============================================================ */
function SubagentModal({ notif, onClose }) {
  const [raw, setRaw] = React.useState(false);
  const [statusKey, body] = Object.entries(notif.status || { update: "" })[0];
  const sections = React.useMemo(() => snParseReport(body), [body]);
  const stats = React.useMemo(() => snStats(sections), [sections]);
  const st = snStatus(statusKey);
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let fnCounter = 0;
  return (
    <div className="xr-modal-scrim" onClick={onClose}>
      <div className="xr-modal sn-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="xr-modal-hd">
          <span className="xr-modal-kind sn-modal-kind" data-tone={st.tone}>SUBAGENT_NOTIF</span>
          <span className="xr-modal-cmd num">{notif.agent_nickname ? notif.agent_nickname + " · " : ""}{notif.agent_path}</span>
          <span className="spacer"></span>
          <span className={"chip " + (st.tone === "good" ? "good" : st.tone === "warn" ? "warn" : st.tone === "cyan" ? "cyan" : "amber")}>{st.glyph} {st.label}</span>
          {notif.tokens != null && <span className="chip dim num">{(notif.tokens / 1000).toFixed(1)}K tok</span>}
          <button className="xr-raw-btn" data-on={raw} onClick={() => setRaw((v) => !v)}>{raw ? "FORMATTED" : "RAW"}</button>
          <button className="xr-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="xr-modal-body sn-modal-body">
          {raw ? (
            <pre className="sn-raw">{`<subagent_notification>\n` + JSON.stringify(notif, null, 2) + `\n</subagent_notification>`}</pre>
          ) : (
            <div className="sn-report">
              <div className="sn-band">
                <SnSummary notif={notif} statusKey={statusKey} stats={stats} />
              </div>
              {sections.map((sec, si) => (
                <section key={si} className="sn-section" data-type={sec.type}>
                  {sec.title && (
                    <header className="sn-sec-hd" data-type={sec.type}>
                      <span className="sn-sec-bar" aria-hidden="true"></span>
                      <span className="sn-sec-title">{sec.title}</span>
                      {sec.type === "findings" && sec.items.length > 0 && <span className="sn-sec-n num">{sec.items.length}</span>}
                      {sec.type === "risk" && sec.items.length > 0 && <span className="sn-sec-n num warn">{sec.items.length}</span>}
                    </header>
                  )}
                  {sec.type === "findings" && sec.items.map((f, i) => <SnFinding key={i} f={f} n={++fnCounter} />)}
                  {sec.type === "risk" && (
                    <div className="sn-risks">
                      {sec.items.map((it, i) => (
                        <div key={i} className="sn-risk">
                          <span className="sn-risk-glyph" aria-hidden="true">▸</span>
                          <span className="sn-risk-text">{snRich(it.prose, "rk" + i)}{it.citations.length > 0 && <span className="sn-cites inline">{it.citations.map((c, ci) => <SnCite key={ci} c={c} />)}</span>}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(sec.type === "sources" || sec.type === "findings") && sec.paras.map((p, i) => (
                    <p key={i} className="sn-para">{snRich(p, "p" + si + "_" + i)}</p>
                  ))}
                  {sec.type === "risk" && sec.paras.map((p, i) => (
                    <p key={i} className="sn-para">{snRich(p, "rp" + si + "_" + i)}</p>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
