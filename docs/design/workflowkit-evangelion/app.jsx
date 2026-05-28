/* WorkflowKit Observatory — main app */

const { useState, useEffect, useMemo, useRef } = React;
const { sessions: SESSIONS, edges: EDGES, timelines: TIMELINES, logs: LOGS, toolUsage: TOOLS, now: NOW, helpers } = window.WK_DATA;
const { fmtTime, fmtTimeMs, pad } = helpers;

const VIEWS = [
  { key: "sessions", label: "Sessions", code: "00" },
  { key: "timeline", label: "Timeline", code: "01" },
  { key: "graph", label: "Agent Graph", code: "02" },
  { key: "tokens", label: "Tokens", code: "03" },
  { key: "diag", label: "Diagnostics", code: "04" },
];

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "orange",
  "scanlines": true,
  "scanStrength": 22,
  "density": "regular",
  "showWatermark": false
}/*EDITMODE-END*/;

function App() {
  const [view, setView] = useState("sessions");
  const [selected, setSelected] = useState(SESSIONS[0].id);
  const [clock, setClock] = useState(NOW);

  // tweaks
  const [tweaks, setTweak] = useTweaks(DEFAULTS);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-palette", tweaks.palette);
    root.style.setProperty("--scan-strength", String(tweaks.scanStrength / 100));
  }, [tweaks.palette, tweaks.scanStrength]);

  // tick the header clock
  useEffect(() => {
    const id = setInterval(() => setClock((c) => new Date(c.getTime() + 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const session = SESSIONS.find((s) => s.id === selected) || SESSIONS[0];

  return (
    <div className="shell" data-screen-label={`Observatory · ${view}`}>
      <TopHazardStrip clock={clock} />

      <header className="header">
        <div className="brand">
          <div className="mark"></div>
          <div>
            <div className="name">WORKFLOWKIT</div>
            <div className="sub">// Observatory · 観測</div>
          </div>
        </div>

        <nav className="nav">
          {VIEWS.map((v) => (
            <button key={v.key} data-active={view === v.key} onClick={() => setView(v.key)}>
              <span className="idx">{v.code}</span>
              <span>{v.label}</span>
            </button>
          ))}
        </nav>

        <div className="right">
          <div className="stat">
            <div className="v num">{SESSIONS.length}</div>
            <div className="l">Sessions</div>
          </div>
          <div className="stat">
            <div className="v num warn-c">{SESSIONS.reduce((a, s) => a + (s.warnings > 0 ? 1 : 0), 0)}</div>
            <div className="l">w/ Warn</div>
          </div>
          <div className="stat">
            <div className="v num">{Math.round(SESSIONS.reduce((a, s) => a + s.tokens_used, 0) / 1000)}K</div>
            <div className="l">Tokens</div>
          </div>
          <div className="stat">
            <div className="v num cyan-c">{fmtTime(clock)}</div>
            <div className="l">UTC-7 · LOCAL</div>
          </div>
        </div>
      </header>

      <main className="main">
        {view === "sessions" && (
          <SessionsView selected={selected} setSelected={setSelected} setView={setView} />
        )}
        {view === "timeline" && (
          <TimelineView session={session} setSelected={setSelected} setView={setView} />
        )}
        {view === "graph" && (
          <GraphView selected={selected} setSelected={setSelected} setView={setView} />
        )}
        {view === "tokens" && <TokensView session={session} setSelected={setSelected} setView={setView} />}
        {view === "diag" && <DiagnosticsView session={session} setSelected={setSelected} setView={setView} />}
      </main>

      <StatusBar view={view} clock={clock} session={session} />

      <TweaksPanel title="Observatory Tweaks">
        <TweakSection title="Palette">
          <TweakRadio
            label="Channel"
            value={tweaks.palette}
            onChange={(v) => setTweak("palette", v)}
            options={[
              { value: "orange", label: "Orange" },
              { value: "amber", label: "Amber" },
              { value: "red", label: "Red" },
              { value: "cyan", label: "Cyan" },
            ]}
          />
        </TweakSection>
        <TweakSection title="CRT Effect">
          <TweakToggle label="Scanlines" value={tweaks.scanlines} onChange={(v) => setTweak("scanlines", v)} />
          <TweakSlider label="Scan strength" value={tweaks.scanStrength} min={0} max={60} step={1} onChange={(v) => setTweak("scanStrength", v)} />
        </TweakSection>
        <TweakSection title="Chrome">
          <TweakToggle label="Watermark" value={tweaks.showWatermark} onChange={(v) => setTweak("showWatermark", v)} />
        </TweakSection>
      </TweaksPanel>

      {tweaks.scanlines && <div className="scanlines"></div>}
      <div className="crt-vignette"></div>
      {tweaks.showWatermark && <Watermark />}
    </div>
  );
}

/* --- Top hazard strip with center wordmark ---- */
function TopHazardStrip({ clock }) {
  return (
    <div className="top-hazard" style={{ background: "var(--bg-1)" }}>
      <Hazard kind="primary" style={{ height: 22, flex: 1 }} />
      <div className="center" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 11, color: "var(--ink-dim)", letterSpacing: "0.3em" }}>SYS:</span>
        <span>OBSERVATORY · 観測装置</span>
        <span className="jp" style={{ fontSize: 11, color: "var(--ink-dim)" }}>機密 / レベル 7</span>
        <span className="blink" style={{ color: "var(--warn)", fontSize: 11, letterSpacing: "0.3em" }}>● LIVE</span>
      </div>
      <Hazard kind="primary" style={{ height: 22, flex: 1 }} />
    </div>
  );
}

/* --- Status bar (footer) ---- */
function StatusBar({ view, clock, session }) {
  const tickerItems = [
    "PATTERN: CODEX OPS — NORMAL",
    "BACKFILL · OK · last_watermark=2026-05-26T17:59:44Z",
    "logs_2 ingest queue · 0 / capacity 1024",
    "rate_limit · primary 31% · secondary 18%",
    "session " + session.id.slice(0, 18) + " · ACTIVE",
    "MEMORY MODE · enabled",
  ];
  return (
    <div className="status">
      <span className="seq">▸ {view.toUpperCase()}</span>
      <span className="ticker-wrap">
        <span className="ticker">
          {tickerItems.concat(tickerItems).map((t, i) => (
            <span key={i} style={{ marginRight: 36 }}>// {t}</span>
          ))}
        </span>
      </span>
      <span>$CODEX_HOME = ~/.codex</span>
      <span><span className="live">●</span> LINK OK</span>
      <span className="num">{fmtTime(clock)}</span>
    </div>
  );
}

function Watermark() {
  return (
    <div style={{
      position: "fixed",
      left: "50%",
      bottom: 30,
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "4px 14px",
      background: "rgba(5, 4, 3, 0.9)",
      border: "1px solid var(--rule-soft)",
      fontFamily: "var(--display)",
      fontSize: 10,
      letterSpacing: "0.3em",
      color: "var(--ink-faint)",
      pointerEvents: "none",
      zIndex: 50,
      textTransform: "uppercase",
    }}>
      <span className="blink" style={{ color: "var(--warn)" }}>● REC</span>
      <span>FOR INTERNAL DIAGNOSTIC USE</span>
      <span>·</span>
      <span>UNAUTHORIZED ACCESS PROHIBITED</span>
      <span className="jp" style={{ letterSpacing: "0.18em", textTransform: "none" }}>関係者以外立入禁止</span>
    </div>
  );
}

/* ============================================================
   01 — SESSIONS OVERVIEW
   ============================================================ */
function SessionsView({ selected, setSelected, setView }) {
  const [q, setQ] = useState("");
  const [filterSource, setFilterSource] = useState("all");
  const [filterRepo, setFilterRepo] = useState("all");
  const [filterFlag, setFilterFlag] = useState("all");

  const repos = useMemo(() => Array.from(new Set(SESSIONS.map((s) => s.cwd))), []);

  const filtered = SESSIONS.filter((s) => {
    if (q && !(`${s.title} ${s.first_user_message} ${s.id}`.toLowerCase().includes(q.toLowerCase()))) return false;
    if (filterSource !== "all" && s.thread_source !== filterSource) return false;
    if (filterRepo !== "all" && s.cwd !== filterRepo) return false;
    if (filterFlag === "warnings" && s.warnings === 0) return false;
    if (filterFlag === "failed" && s.failed_tools === 0) return false;
    if (filterFlag === "open-child" && s.children_open === 0) return false;
    return !s.archived || filterFlag === "archived";
  }).sort((a, b) => b.updated_at - a.updated_at);

  const tokensByHour = useMemo(() => {
    // approx token usage in the last 12 hours
    const buckets = new Array(12).fill(0);
    SESSIONS.forEach((s) => {
      const hoursAgo = Math.min(11, Math.floor((NOW - s.updated_at) / (1000 * 60 * 60)));
      buckets[11 - hoursAgo] += s.tokens_used;
    });
    return buckets;
  }, []);

  return (
    <div className="overview">
      {/* SIDE: filters & stats */}
      <aside className="ov-side">
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--rule)" }}>
          <div className="kicker" style={{ color: "var(--primary)" }}>▸ Catalog</div>
          <div className="display" style={{ fontSize: 24, color: "var(--ink-strong)", marginTop: 4 }}>SESSION INDEX</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>state_5.sqlite · threads · {SESSIONS.length} of 673 visible</div>
        </div>

        <div className="side-stat">
          <Stat label="Active" value={SESSIONS.filter((s) => !s.archived).length} sub="not archived" />
          <Stat label="Sub-agents" value={SESSIONS.filter((s) => s.thread_source === "subagent").length} sub="subagent threads" />
          <Stat label="Open child" value={SESSIONS.reduce((a, s) => a + s.children_open, 0)} tone="warn" sub="awaiting" />
          <Stat label="Σ Tokens" value={(SESSIONS.reduce((a, s) => a + s.tokens_used, 0) / 1000).toFixed(0) + "K"} sub="all sessions" />
        </div>

        <div className="filter-grp">
          <div className="lbl">Token usage · last 12h</div>
          <VBars data={tokensByHour} h={42} />
          <div className="flex between mt-1" style={{ fontSize: 10, color: "var(--ink-dim)", letterSpacing: "0.18em" }}>
            <span>-12H</span><span>NOW</span>
          </div>
        </div>

        <div className="filter-grp" style={{ flex: 1, overflowY: "auto" }}>
          <div className="lbl">Thread source</div>
          <div className="row mb-2">
            {[["all", "All"], ["user", "User"], ["subagent", "Sub-agent"]].map(([v, l]) => (
              <button key={v} className="opt" data-on={filterSource === v} onClick={() => setFilterSource(v)}>{l}</button>
            ))}
          </div>
          <div className="lbl">Repo · cwd</div>
          <div className="row mb-2">
            <button className="opt" data-on={filterRepo === "all"} onClick={() => setFilterRepo("all")}>All</button>
            {repos.map((r) => (
              <button key={r} className="opt" data-on={filterRepo === r} onClick={() => setFilterRepo(r)}>{r.split("/").pop()}</button>
            ))}
          </div>
          <div className="lbl">Flag</div>
          <div className="row">
            {[["all", "Any"], ["warnings", "Has warn"], ["failed", "Failed tool"], ["open-child", "Open child"], ["archived", "Archived"]].map(([v, l]) => (
              <button key={v} className="opt" data-on={filterFlag === v} onClick={() => setFilterFlag(v)}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--ink-dim)", letterSpacing: "0.18em" }}>
          <span>RESULTS · {filtered.length}</span>
          <span className="warn-c blink">▸ LIVE INDEX</span>
        </div>
      </aside>

      {/* MAIN TABLE */}
      <div className="ov-main">
        <div className="ov-toolbar">
          <div className="ov-search">
            <span className="sigil">QUERY:</span>
            <input
              placeholder='title · first user message · uuid'
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="muted" style={{ fontSize: 10, letterSpacing: "0.2em" }}>↵ exec</span>
          </div>
          <div className="chip dim">SORT · updated_at ↓</div>
          <div className="chip dim">JOIN · thread_spawn_edges</div>
          <div className="chip">PROFILE · adam@local</div>
        </div>

        <div className="ov-table">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 18 }}></th>
                <th style={{ width: 88 }}>Updated</th>
                <th>Title / Brief</th>
                <th style={{ width: 168 }}>Repo · branch</th>
                <th style={{ width: 130 }}>Model</th>
                <th style={{ width: 110 }}>Tokens</th>
                <th style={{ width: 84 }}>Source</th>
                <th style={{ width: 90 }}>Child</th>
                <th style={{ width: 84 }}>Warn</th>
                <th style={{ width: 18 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, idx) => {
                const ago = Math.round((NOW - s.updated_at) / 60000);
                const active = s.id === selected;
                return (
                  <tr key={s.id} data-active={active} onClick={() => { setSelected(s.id); setView("timeline"); }}>
                    <td className="muted num">{pad(idx + 1, 3)}</td>
                    <td className="num">
                      <div>{ago < 60 ? `${ago}m ago` : `${Math.round(ago/60)}h ago`}</div>
                      <div className="muted" style={{ fontSize: 10 }}>{fmtTime(s.updated_at)}</div>
                    </td>
                    <td>
                      <div className="strong" style={{ fontWeight: 600, marginBottom: 2 }}>{s.title}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        <span className="arr">{s.first_user_message.slice(0, 92)}{s.first_user_message.length > 92 ? "…" : ""}</span>
                      </div>
                    </td>
                    <td>
                      <div>{s.cwd}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        <span className="num">{s.git_sha || "—"}</span> · {s.git_branch}
                      </div>
                    </td>
                    <td>
                      <div>{s.model}</div>
                      <div className="muted" style={{ fontSize: 11 }}>effort · {s.reasoning_effort}</div>
                    </td>
                    <td>
                      <div className="num">{s.tokens_used.toLocaleString()}</div>
                      <SegBar count={12} value={Math.min(100, (s.tokens_used / 200000) * 100)} hi={s.tokens_used > 100000} />
                    </td>
                    <td>
                      {s.thread_source === "user" ? (
                        <span className="chip">USER</span>
                      ) : (
                        <span className="chip amber">SUB · {s.agent_role?.[0]?.toUpperCase() || "W"}</span>
                      )}
                      {s.agent_nickname && <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>{s.agent_nickname}</div>}
                    </td>
                    <td>
                      {s.children > 0 ? (
                        <div>
                          <span className="num strong">{s.children}</span>
                          {s.children_open > 0 && <span className="warn-c"> · {s.children_open} open</span>}
                        </div>
                      ) : <span className="faint">—</span>}
                    </td>
                    <td>
                      {s.warnings > 0 ? (
                        <span className="chip warn">▲ {s.warnings}</span>
                      ) : <span className="faint">·</span>}
                      {s.failed_tools > 0 && <div className="warn-c" style={{ fontSize: 10, marginTop: 4 }}>✕ {s.failed_tools} fail</div>}
                    </td>
                    <td className="muted">›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   02 — TIMELINE
   ============================================================ */
function TimelineView({ session, setSelected, setView }) {
  const allEvents = TIMELINES[session.id] || TIMELINES[SESSIONS[0].id];
  const [filter, setFilter] = useState("all");
  const [windowMs, setWindowMs] = useState(0); // 0 === "all"
  const [expanded, setExpanded] = useState(new Set());

  // Reference time = last event in the full session. Windowing trims earlier events;
  // the scrubber rail, tab counts and stream all reflect the same windowed slice.
  const refNow = allEvents[allEvents.length - 1].ts;
  const events = useMemo(
    () => (windowMs ? allEvents.filter((e) => refNow - e.ts <= windowMs) : allEvents),
    [allEvents, windowMs, refNow]
  );

  // Guard against an empty window (shouldn't happen since refNow is in-range, but safe)
  const t0 = (events[0] || allEvents[0]).ts;
  const tEnd = (events[events.length - 1] || allEvents[allEvents.length - 1]).ts;
  const span = Math.max(1, tEnd - t0);

  const filtered = events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "msg") return e.kind === "user" || e.kind === "assistant" || e.kind === "agent_report";
    if (filter === "tool") return e.kind === "tool_call" || e.kind === "tool_output";
    if (filter === "agent") return e.kind === "tool_call" && (e.name === "spawn_agent" || e.name === "wait_agent");
    if (filter === "warn") return e.kind === "warning" || (e.kind === "tool_output" && e.fail);
    if (filter === "token") return e.kind === "token_count";
    return true;
  });

  // join tool_call ↔ tool_output by call_id
  const outByCall = {};
  events.forEach((e) => { if (e.kind === "tool_output") outByCall[e.call_id] = e; });

  const toggle = (key) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  // build scrubber dots
  const scrubDots = events.map((e, i) => ({
    pct: ((e.ts - t0) / span) * 100,
    kind: e.kind,
    i,
  }));

  return (
    <div className="timeline">
      {/* LEFT — session meta + nav */}
      <aside className="tl-side">
        <div className="tl-meta">
          <HazardTag tone={session.thread_source === "subagent" ? "amber" : "primary"} style={{ marginBottom: 12 }}>
            {session.thread_source === "subagent" ? `SUB · ${session.agent_nickname}` : "USER · ROOT"}
          </HazardTag>
          <div className="title">{session.title}</div>
          <div className="sub">{session.preview}</div>

          <div className="row">
            <span className="k">Session</span>
            <span className="v num"><ShortId id={session.id} /></span>
            <span className="k">Rollout</span>
            <span className="v" style={{ fontSize: 10 }}>{session.rollout_path.split("/").slice(-2).join("/")}</span>
            <span className="k">Repo</span>
            <span className="v">{session.cwd}</span>
            <span className="k">Branch</span>
            <span className="v">{session.git_branch} · {session.git_sha}</span>
            <span className="k">Model</span>
            <span className="v">{session.model} <span className="muted">· effort {session.reasoning_effort}</span></span>
            <span className="k">Sandbox</span>
            <span className="v">{session.sandbox} <span className="muted">· approval {session.approval}</span></span>
            <span className="k">Started</span>
            <span className="v num">{fmtTime(session.created_at)}</span>
            <span className="k">Updated</span>
            <span className="v num">{fmtTime(session.updated_at)}</span>
          </div>
        </div>

        <div style={{ overflow: "auto" }}>
          <div className="panel-tit"><span className="dot"></span><span>Other Sessions</span></div>
          {SESSIONS.slice(0, 14).map((s) => (
            <div
              key={s.id}
              onClick={() => setSelected(s.id)}
              style={{
                padding: "8px 14px",
                borderBottom: "1px dashed var(--rule-soft)",
                cursor: "pointer",
                background: s.id === session.id ? "rgba(255,107,26,0.12)" : "transparent",
              }}
            >
              <div className="flex between" style={{ alignItems: "baseline" }}>
                <div className="strong" style={{ fontSize: 11 }}>{s.title.slice(0, 38)}{s.title.length > 38 ? "…" : ""}</div>
                <div className="muted num" style={{ fontSize: 10 }}>{fmtTime(s.updated_at)}</div>
              </div>
              <div className="muted" style={{ fontSize: 10 }}>{s.thread_source === "subagent" ? `SUB · ${s.agent_nickname}` : "USER"} · {(s.tokens_used / 1000).toFixed(1)}K tok</div>
            </div>
          ))}
        </div>
      </aside>

      {/* CENTER */}
      <section className="tl-main">
        <div className="tl-tabs">
          {[
            ["all", "All Events", events.length],
            ["msg", "Messages", events.filter((e) => e.kind === "user" || e.kind === "assistant" || e.kind === "agent_report").length],
            ["tool", "Tools", events.filter((e) => e.kind === "tool_call").length],
            ["agent", "Agent Ops", events.filter((e) => e.kind === "tool_call" && (e.name === "spawn_agent" || e.name === "wait_agent")).length],
            ["token", "Tokens", events.filter((e) => e.kind === "token_count").length],
            ["warn", "Warnings", events.filter((e) => e.kind === "warning" || (e.kind === "tool_output" && e.fail)).length],
          ].map(([k, l, n]) => (
            <button key={k} data-on={filter === k} onClick={() => setFilter(k)}>
              {l} <span className="muted">·{n}</span>
            </button>
          ))}
          <div className="tl-range" role="group" aria-label="Time window">
            <span className="tl-range-lbl">▸ WINDOW</span>
            {[
              [60 * 60 * 1000, "1H"],
              [4 * 60 * 60 * 1000, "4H"],
              [12 * 60 * 60 * 1000, "12H"],
              [0, "ALL"],
            ].map(([ms, l]) => (
              <button
                key={l}
                data-on={windowMs === ms}
                onClick={() => setWindowMs(ms)}
                title={ms ? `Show events from last ${l}` : "Show entire session"}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="tl-scrubber">
          <div className="hdr">
            <span><Reticle /> TURN 01 · {windowMs ? `LAST ${windowMs/3600000|0}H` : "TASK_STARTED → TASK_COMPLETE"} · DUR {Math.round((tEnd - t0)/1000)}s</span>
            <span>TTFT {session.ttft_ms}ms</span>
          </div>
          <div className="track">
            {scrubDots.map((d) => (
              <span key={d.i} style={{
                position: "absolute",
                left: `${d.pct}%`,
                top: "50%",
                width: d.kind === "token_count" ? 2 : 4,
                height: d.kind === "token_count" ? 28 : (d.kind === "warning" ? 22 : 14),
                transform: "translate(-50%, -50%)",
                background:
                  d.kind === "warning" ? "var(--warn)"
                  : d.kind === "tool_call" ? "var(--amber)"
                  : d.kind === "user" ? "var(--cyan)"
                  : d.kind === "agent_report" ? "var(--good)"
                  : d.kind === "task_complete" ? "var(--ink-strong)"
                  : "var(--primary)",
                boxShadow: "0 0 6px currentColor",
                color: "var(--primary)",
              }}></span>
            ))}
            {/* axis ticks */}
            {[0, 25, 50, 75, 100].map((p) => (
              <span key={p} style={{
                position: "absolute", left: `${p}%`, bottom: 0, width: 1, height: 6, background: "var(--rule-strong)",
              }}></span>
            ))}
          </div>
        </div>

        <div className="tl-stream">
          {filtered.map((e, i) => {
            const key = `${e.ts.getTime()}-${i}`;
            const isOpen = expanded.has(key);
            return <EventRow key={key} e={e} outByCall={outByCall} isOpen={isOpen} toggle={() => toggle(key)} onJump={(id) => { setSelected(id); }} />;
          })}
        </div>
      </section>

      {/* RIGHT — summary panels */}
      <aside className="tl-side-r">
        <div className="panel-tit"><span className="dot"></span><span>Turn 01 · Vitals</span><span className="spacer"></span><span className="meta">live</span></div>
        <div style={{ padding: 14, overflow: "auto" }}>
          <div className="display" style={{ fontSize: 28, color: "var(--ink-strong)" }}>
            {(session.tokens_used / 1000).toFixed(1)}K
          </div>
          <div className="kicker" style={{ marginTop: -2 }}>Σ tokens · used</div>

          <div style={{ marginTop: 16 }}>
            <div className="flex between mb-1" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--ink-dim)", textTransform: "uppercase" }}>
              <span>Context window</span><span className="num strong">{Math.min(99, Math.round((session.tokens_used / 200000) * 100))}%</span>
            </div>
            <SegBar count={24} value={Math.min(100, (session.tokens_used / 200000) * 100)} hi={session.tokens_used > 100000} />
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="flex between mb-1" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--ink-dim)", textTransform: "uppercase" }}>
              <span>Primary rate-limit</span><span className="num strong">54%</span>
            </div>
            <SegBar count={24} value={54} />
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="flex between mb-1" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--ink-dim)", textTransform: "uppercase" }}>
              <span>Secondary</span><span className="num strong">18%</span>
            </div>
            <SegBar count={24} value={18} />
          </div>

          <div style={{ marginTop: 20, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <div className="kicker mb-2">▸ Tool Usage · this turn</div>
            {Object.entries(events.filter((e) => e.kind === "tool_call").reduce((acc, e) => { acc[e.name] = (acc[e.name]||0)+1; return acc; }, {})).map(([n, c]) => (
              <div key={n} className="flex between" style={{ fontSize: 11, padding: "3px 0" }}>
                <span>{n}</span>
                <span className="num strong">{c}</span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <div className="kicker mb-2">▸ Spawned Agents</div>
            {SESSIONS.filter((s) => s.parent_id === session.id).map((c) => (
              <div key={c.id} onClick={() => setSelected(c.id)} style={{ padding: "8px 0", borderBottom: "1px dashed var(--rule-soft)", cursor: "pointer" }}>
                <div className="flex between"><span className="strong" style={{ fontFamily: "var(--display)", fontWeight: 700, letterSpacing: "0.1em" }}>{c.agent_nickname}</span>
                  <span className={EDGES.find((e) => e.child === c.id)?.status === "open" ? "chip warn" : "chip good"}>
                    {EDGES.find((e) => e.child === c.id)?.status?.toUpperCase()}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{c.agent_role} · {(c.tokens_used/1000).toFixed(1)}K tok</div>
              </div>
            ))}
            {SESSIONS.filter((s) => s.parent_id === session.id).length === 0 && <div className="faint" style={{ fontSize: 11 }}>—— no sub-agents ——</div>}
          </div>

          <button
            onClick={() => setView("graph")}
            style={{ marginTop: 16, width: "100%", padding: "10px 12px", border: "1px solid var(--primary)", color: "var(--primary)", fontFamily: "var(--display)", letterSpacing: "0.18em", textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}
          >
            ▸ Open Agent Graph
          </button>
        </div>
      </aside>
    </div>
  );
}

function EventRow({ e, outByCall, isOpen, toggle, onJump }) {
  if (e.kind === "task_started") {
    return (
      <div className="ev" style={{ borderLeft: "1px solid var(--rule-strong)" }}>
        <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
        <div className="body" style={{ borderColor: "var(--primary)" }}>
          <div className="head">
            <span className="who" style={{ color: "var(--primary)" }}>TURN 01 · TASK_STARTED</span>
            <span className="right">model {e.model} · effort {e.effort} · sandbox {e.sandbox}</span>
          </div>
        </div>
      </div>
    );
  }
  if (e.kind === "task_complete") {
    return (
      <div className="ev">
        <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
        <div className="body" style={{ borderColor: "var(--good)" }}>
          <div className="head">
            <span className="who" style={{ color: "var(--good)" }}>▸ TASK_COMPLETE</span>
            <span className="right">dur {Math.round(e.duration_ms/1000)}s · ttft {e.ttft_ms}ms</span>
          </div>
          <pre>{e.last_agent_message}</pre>
        </div>
      </div>
    );
  }
  if (e.kind === "user") {
    return (
      <div className="ev user">
        <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
        <div className="body">
          <div className="head"><span className="who user">USER</span><span>message</span></div>
          <pre>{e.text}</pre>
        </div>
      </div>
    );
  }
  if (e.kind === "assistant") {
    return (
      <div className="ev assistant">
        <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
        <div className="body">
          <div className="head"><span className="who">ASSISTANT</span><span>{e.phase}</span></div>
          <pre>{e.text}</pre>
        </div>
      </div>
    );
  }
  if (e.kind === "agent_report") {
    return (
      <div className="ev spawn">
        <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
        <div className="body" style={{ borderColor: "var(--good)" }}>
          <div className="head"><span className="who spawn">{e.from} · AGENT REPORT</span></div>
          <pre>{e.text}</pre>
        </div>
      </div>
    );
  }
  if (e.kind === "warning") {
    return (
      <div className="ev warn">
        <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
        <div className="body" style={{ borderColor: "var(--warn)" }}>
          <div className="head"><span className="who warn">▲ WARNING</span></div>
          <pre style={{ color: "var(--warn)" }}>{e.text}</pre>
        </div>
      </div>
    );
  }
  if (e.kind === "token_count") {
    return (
      <div className="ev token">
        <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
        <div className="body" style={{ borderColor: "var(--rule-soft)" }}>
          <div className="head"><span className="who">TOKEN_COUNT</span><span>snapshot</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, fontSize: 11 }}>
            <KV k="Σ" v={e.total.toLocaleString()} />
            <KV k="IN" v={e.input.toLocaleString()} />
            <KV k="OUT" v={e.output.toLocaleString()} />
            <KV k="CACHED" v={e.cached.toLocaleString()} />
            <KV k="CTX %" v={`${e.ctx_pct.toFixed(1)}`} tone="primary" />
            <KV k="RATE %" v={`${e.rate_pct}`} tone={e.rate_pct > 60 ? "warn" : "primary"} />
          </div>
        </div>
      </div>
    );
  }
  if (e.kind === "tool_call") {
    const out = outByCall[e.call_id];
    const isSpawn = e.name === "spawn_agent";
    const isWait = e.name === "wait_agent";
    const argSummary = e.args.cmd ? e.args.cmd.join(" ")
      : (e.args.path ? e.args.path
      : (e.args.nickname ? `${e.args.nickname} (${e.args.role}) // ${e.args.task}`
      : (e.args.thread_id ? `await ${e.args.thread_id.slice(0,12)}…` : JSON.stringify(e.args))));
    return (
      <div className={`ev tool${isSpawn ? " spawn" : ""}`}>
        <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
        <div className="body" style={{ borderColor: isSpawn ? "var(--good)" : "var(--amber)" }}>
          <div className="head">
            <span className={`who ${isSpawn ? "spawn" : "tool"}`}>
              {isSpawn ? "⊕ SPAWN_AGENT" : isWait ? "◌ WAIT_AGENT" : `▸ ${e.name.toUpperCase()}`}
            </span>
            <span>call_id {e.call_id}</span>
            {out && <span className={"chip " + (out.fail ? "warn" : "good")}>exit {out.exit} · {Math.round((out.ts - e.ts))}ms</span>}
            {isSpawn && <button onClick={() => onJump(e.spawn_thread_id)} className="chip cyan" style={{ marginLeft: "auto", cursor: "pointer" }}>↗ open child</button>}
          </div>
          <div className="args">$ {argSummary}</div>
          {out && (
            <div className={"out" + (out.fail ? " fail" : "")}>
              <div className="muted" style={{ fontSize: 10, marginBottom: 4, letterSpacing: "0.18em" }}>
                STDOUT · {(out.output || "").length} bytes {out.fail && "· FAILED"}
              </div>
              <pre style={{ fontSize: 11 }}>{out.output}</pre>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (e.kind === "tool_output") return null; // handled inline with tool_call
  return null;
}

function KV({ k, v, tone }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase" }}>{k}</div>
      <div className="num strong" style={tone ? { color: `var(--${tone})` } : null}>{v}</div>
    </div>
  );
}

/* ============================================================
   03 — AGENT GRAPH
   ============================================================ */
function GraphView({ selected, setSelected, setView }) {
  // build layout: root + children + grandchildren columns
  const layout = useMemo(() => {
    const root = SESSIONS.find((s) => !s.parent_id && SESSIONS.some((x) => x.parent_id === s.id)) || SESSIONS[0];
    const children = SESSIONS.filter((s) => s.parent_id === root.id);
    const grand = SESSIONS.filter((s) => children.some((c) => c.id === s.parent_id));
    const positions = {};
    // root at left
    positions[root.id] = { x: 60, y: 280 };
    // children spread vertically
    const cSpace = Math.max(120, 540 / Math.max(1, children.length));
    children.forEach((c, i) => {
      positions[c.id] = { x: 380, y: 60 + i * 180 };
    });
    // grandchildren grouped by parent
    grand.forEach((g) => {
      const siblings = grand.filter((x) => x.parent_id === g.parent_id);
      const idx = siblings.indexOf(g);
      const parent = positions[g.parent_id];
      positions[g.id] = { x: 700, y: parent.y - 50 + idx * 90 };
    });
    return { root, children, grand, positions };
  }, []);

  const selectedNode = SESSIONS.find((s) => s.id === selected);
  const isInGraph = layout.root.id === selected || layout.children.some((c) => c.id === selected) || layout.grand.some((g) => g.id === selected);
  const focusNode = isInGraph ? selectedNode : layout.root;

  return (
    <div className="graph">
      <div className="graph-canvas">
        {/* hairline header */}
        <div style={{ position: "absolute", top: 14, left: 14, right: 14, display: "flex", justifyContent: "space-between", color: "var(--ink-dim)", letterSpacing: "0.2em", fontSize: 11, textTransform: "uppercase" }}>
          <span><Reticle /> AGENT TREE · thread_spawn_edges</span>
          <span>DEPTH 2 · {1 + layout.children.length + layout.grand.length} NODES · {EDGES.length} EDGES</span>
        </div>
        {/* axis grid */}
        <div style={{ position: "absolute", inset: 36, pointerEvents: "none" }}>
          {[0, 25, 50, 75, 100].map((p) => (
            <span key={p} style={{ position: "absolute", left: `${p}%`, top: 0, bottom: 0, width: 1, background: "var(--ink-ghost)" }}></span>
          ))}
          <div style={{ position: "absolute", top: 4, left: "50%", color: "var(--ink-dim)", fontSize: 10, letterSpacing: "0.2em" }}>DEPTH·1</div>
          <div style={{ position: "absolute", top: 4, left: "85%", color: "var(--ink-dim)", fontSize: 10, letterSpacing: "0.2em" }}>DEPTH·2</div>
        </div>

        {/* SVG edges */}
        <svg style={{ position: "absolute", inset: 0, pointerEvents: "none", width: "100%", height: "100%" }}>
          <defs>
            <marker id="arr" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="var(--primary)" />
            </marker>
            <marker id="arr-warn" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" fill="var(--warn)" />
            </marker>
          </defs>
          {EDGES.map((e, i) => {
            const p = layout.positions[e.parent];
            const c = layout.positions[e.child];
            if (!p || !c) return null;
            const x1 = p.x + 220, y1 = p.y + 50;
            const x2 = c.x, y2 = c.y + 50;
            const mx = (x1 + x2) / 2;
            const d = `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
            const color = e.status === "open" ? "var(--warn)" : "var(--primary)";
            return (
              <g key={i}>
                <path d={d} stroke={color} strokeWidth="1" fill="none" strokeDasharray={e.status === "open" ? "4 4" : "0"} opacity="0.85" markerEnd={e.status === "open" ? "url(#arr-warn)" : "url(#arr)"} />
                <text x={mx} y={(y1 + y2) / 2 - 6} fontSize="9" fill={color} fontFamily="var(--display)" letterSpacing="0.18em" textAnchor="middle" style={{ textTransform: "uppercase" }}>
                  {e.status}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Nodes */}
        {[layout.root, ...layout.children, ...layout.grand].map((s) => {
          const pos = layout.positions[s.id];
          const isRoot = s.id === layout.root.id;
          const status = EDGES.find((e) => e.child === s.id)?.status;
          const open = focusNode.id === s.id;
          return (
            <div
              key={s.id}
              className={`node ${status === "open" ? "status-open" : ""}`}
              data-open={open}
              style={{ left: pos.x, top: pos.y }}
              onClick={() => setSelected(s.id)}
              onDoubleClick={() => { setSelected(s.id); setView("timeline"); }}
            >
              <span className="corner-tl"></span>
              <span className="corner-br"></span>
              <div className="role">{isRoot ? "ROOT · USER" : `${s.agent_role?.toUpperCase()} · DEPTH ${s.parent_id === layout.root.id ? "1" : "2"}`}</div>
              <div className="nick">{isRoot ? "ADAM" : s.agent_nickname}</div>
              <div className="id"><ShortId id={s.id} /></div>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <span className="chip dim">{(s.tokens_used/1000).toFixed(1)}K tok</span>
                {s.warnings > 0 && <span className="chip warn">▲{s.warnings}</span>}
                {status && <span className={status === "open" ? "chip warn" : "chip good"}>{status}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* INFO PANEL */}
      <aside className="graph-info">
        <div className="panel-tit"><span className="dot"></span><span>Node · Inspector</span></div>
        <div style={{ padding: 14, overflow: "auto" }}>
          <HazardTag tone={focusNode.thread_source === "subagent" ? "amber" : "primary"} style={{ marginBottom: 12 }}>
            {focusNode.thread_source === "subagent" ? `SUB · ${focusNode.agent_nickname}` : "USER · ROOT"}
          </HazardTag>
          <div className="display" style={{ fontSize: 22, color: "var(--ink-strong)", lineHeight: 1.1, marginBottom: 6 }}>{focusNode.title}</div>
          <div className="muted" style={{ fontSize: 11 }}><ShortId id={focusNode.id} /></div>

          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Stat label="Tokens" value={(focusNode.tokens_used/1000).toFixed(1) + "K"} />
            <Stat label="Duration" value={`${Math.round(focusNode.duration_ms / 1000)}s`} />
            <Stat label="TTFT" value={`${focusNode.ttft_ms}ms`} />
            <Stat label="Children" value={focusNode.children} tone={focusNode.children_open > 0 ? "warn" : null} sub={focusNode.children_open > 0 ? `${focusNode.children_open} open` : ""} />
          </div>

          <div style={{ marginTop: 16, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <div className="kicker mb-2">▸ Final agent message</div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {(TIMELINES[focusNode.id] || []).filter((e) => e.kind === "task_complete")[0]?.last_agent_message || "—— in progress ——"}
            </div>
          </div>

          <div style={{ marginTop: 16, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <div className="kicker mb-2">▸ Parent chain</div>
            <ParentChain id={focusNode.id} onJump={(id) => setSelected(id)} />
          </div>

          <button
            onClick={() => setView("timeline")}
            style={{ marginTop: 16, width: "100%", padding: "10px 12px", border: "1px solid var(--primary)", color: "var(--primary)", fontFamily: "var(--display)", letterSpacing: "0.18em", textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}
          >
            ▸ Open Timeline
          </button>

          <div style={{ marginTop: 20 }}>
            <div className="kicker mb-2">▸ Legend</div>
            <div className="flex gap-2" style={{ flexDirection: "column", fontSize: 11 }}>
              <div className="flex gap-2"><span style={{ width: 16, height: 1, background: "var(--primary)", marginTop: 6 }}></span><span>closed edge · child reported back</span></div>
              <div className="flex gap-2"><span style={{ width: 16, height: 1, background: "var(--warn)", marginTop: 6, borderTop: "1px dashed var(--warn)" }}></span><span>open edge · still awaiting</span></div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ParentChain({ id, onJump }) {
  const chain = [];
  let cursor = SESSIONS.find((s) => s.id === id);
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parent_id ? SESSIONS.find((s) => s.id === cursor.parent_id) : null;
  }
  return (
    <div>
      {chain.map((s, i) => (
        <div key={s.id} onClick={() => onJump(s.id)} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 0", cursor: "pointer", fontSize: 11 }}>
          <span className="muted">{"› ".repeat(i)}</span>
          <span className="strong">{s.thread_source === "subagent" ? s.agent_nickname : "ADAM"}</span>
          <span className="muted"><ShortId id={s.id} /></span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   04 — TOKENS
   ============================================================ */
function TokensView({ session, setSelected, setView }) {
  const tokens = TIMELINES[session.id]?.filter((e) => e.kind === "token_count") || [];
  const lastSnap = tokens[tokens.length - 1] || { total: session.tokens_used, input: 0, output: 0, cached: 0, ctx_pct: (session.tokens_used / 200000) * 100, rate_pct: 30 };

  // build aggregate series across all sessions for the top chart
  const allBuckets = useMemo(() => {
    const n = 36;
    const arr = new Array(n).fill(0);
    SESSIONS.forEach((s) => {
      const span = NOW - s.created_at;
      const idx = Math.min(n - 1, Math.max(0, Math.floor((n - 1) * (1 - (NOW - s.updated_at) / (span + 1)))));
      arr[idx] += s.tokens_used;
    });
    return arr;
  }, []);

  // build a smooth cumulative curve from tokens snapshots for this session
  const curvePoints = useMemo(() => {
    if (!tokens.length) return [];
    const t0 = tokens[0].ts;
    const tN = tokens[tokens.length - 1].ts;
    const span = Math.max(1, tN - t0);
    return tokens.map((p) => ({ x: ((p.ts - t0) / span) * 100, y: 100 - Math.min(100, (p.total / 100000) * 100), v: p }));
  }, [tokens]);

  return (
    <div className="tokens">
      <section>
        <div className="panel-tit" style={{ border: 0, padding: 0, height: "auto", marginBottom: 12 }}>
          <span className="dot"></span><span>Aggregate token flow · all sessions · 36-bucket</span>
          <span className="spacer"></span>
          <span className="meta num">Σ {(SESSIONS.reduce((a, s) => a + s.tokens_used, 0)/1000).toFixed(0)}K</span>
        </div>
        <BigBars data={allBuckets} />
      </section>

      <div className="row2">
        <section>
          <div className="panel-tit" style={{ border: 0, padding: 0, height: "auto", marginBottom: 10 }}>
            <span className="dot"></span><span>Session · {session.title.slice(0, 38)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <Readout label="Σ TOTAL" value={lastSnap.total.toLocaleString()} sub={`${tokens.length} snapshots`} />
            <Readout label="CONTEXT %" value={`${lastSnap.ctx_pct.toFixed(1)}%`} sub="of 200K window" tone={lastSnap.ctx_pct > 60 ? "warn" : "ink-strong"} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            <MiniReadout label="INPUT" value={lastSnap.input.toLocaleString()} />
            <MiniReadout label="OUTPUT" value={lastSnap.output.toLocaleString()} />
            <MiniReadout label="CACHED" value={lastSnap.cached.toLocaleString()} tone="cyan" />
            <MiniReadout label="REASONING" value={Math.round(lastSnap.output * 0.3).toLocaleString()} tone="amber" />
          </div>
        </section>

        <section style={{ gridColumn: "span 2" }}>
          <div className="panel-tit" style={{ border: 0, padding: 0, height: "auto", marginBottom: 10 }}>
            <span className="dot"></span><span>Token curve · token_count snapshots</span>
            <span className="spacer"></span>
            <span className="meta">SCALE 0–100K</span>
          </div>
          <TokenCurve points={curvePoints} />
        </section>
      </div>

      <div className="row2">
        <section>
          <div className="panel-tit" style={{ border: 0, padding: 0, height: "auto", marginBottom: 10 }}>
            <span className="dot"></span><span>Rate limits</span>
          </div>
          <RateLimitMeter label="Primary" pct={54} resetIn="2h 12m" />
          <RateLimitMeter label="Secondary" pct={18} resetIn="6h 02m" />
          <RateLimitMeter label="Output cap · 5h" pct={72} resetIn="0h 48m" tone="warn" />
          <div className="muted" style={{ fontSize: 10, marginTop: 8, letterSpacing: "0.18em", textTransform: "uppercase" }}>plan · max-200 · reset at 19:48 UTC</div>
        </section>

        <section>
          <div className="panel-tit" style={{ border: 0, padding: 0, height: "auto", marginBottom: 10 }}>
            <span className="dot"></span><span>Top sessions · tokens used</span>
          </div>
          <div>
            {[...SESSIONS].sort((a, b) => b.tokens_used - a.tokens_used).slice(0, 6).map((s, i) => (
              <div key={s.id} onClick={() => setSelected(s.id)} style={{ display: "grid", gridTemplateColumns: "20px 1fr 90px", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px dashed var(--rule-soft)", cursor: "pointer", fontSize: 11 }}>
                <span className="muted num">{pad(i + 1, 2)}</span>
                <div>
                  <div className="strong" style={{ fontSize: 11 }}>{s.title.slice(0, 56)}{s.title.length > 56 ? "…" : ""}</div>
                  <SegBar count={20} value={(s.tokens_used / 200000) * 100} hi={s.tokens_used > 100000} />
                </div>
                <div className="num strong" style={{ textAlign: "right" }}>{(s.tokens_used/1000).toFixed(1)}K</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="panel-tit" style={{ border: 0, padding: 0, height: "auto", marginBottom: 10 }}>
            <span className="dot"></span><span>Cached input ratio · last 12 snapshots</span>
          </div>
          <CachedRatio session={session} />
          <div className="muted" style={{ fontSize: 10, marginTop: 10, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            higher · better. cache hits reduce billed input.
          </div>
        </section>
      </div>
    </div>
  );
}

function BigBars({ data }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: "100%", minHeight: 0 }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", minHeight: 0 }}>
          <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
            <div style={{
              width: "100%",
              height: `${(v / max) * 100}%`,
              background: v / max > 0.8 ? "var(--warn)" : "var(--primary)",
              boxShadow: `0 0 8px ${v / max > 0.8 ? "var(--warn)" : "var(--primary)"}`,
              backgroundImage: "linear-gradient(to bottom, rgba(255,255,255,0.15), rgba(255,255,255,0))",
            }}></div>
          </div>
          <div className="num" style={{ fontSize: 8, color: "var(--ink-dim)" }}>{i % 6 === 0 ? `${-36+i}m` : ""}</div>
        </div>
      ))}
    </div>
  );
}

function MiniReadout({ label, value, tone }) {
  return (
    <Bracket style={{ padding: "8px 10px", border: "1px solid var(--rule)" }}>
      <div className="kicker" style={{ fontSize: 10 }}>{label}</div>
      <div className="display num" style={{ fontSize: 18, color: tone ? `var(--${tone})` : "var(--ink-strong)" }}>{value}</div>
    </Bracket>
  );
}

function RateLimitMeter({ label, pct, resetIn, tone }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="flex between mb-1" style={{ fontSize: 11 }}>
        <span className="kicker" style={{ color: tone === "warn" ? "var(--warn)" : "var(--ink-dim)" }}>{label}</span>
        <span className="num strong" style={{ color: tone === "warn" ? "var(--warn)" : "var(--ink-strong)" }}>{pct}%</span>
      </div>
      <SegBar count={28} value={pct} hi={tone === "warn"} />
      <div className="muted" style={{ fontSize: 10, marginTop: 4, letterSpacing: "0.18em", textTransform: "uppercase" }}>resets in {resetIn}</div>
    </div>
  );
}

function CachedRatio({ session }) {
  // synthesize 12 snapshots
  const vals = useMemo(() => {
    const arr = [];
    let base = 0.05;
    for (let i = 0; i < 12; i++) {
      base = Math.min(0.78, base + Math.random() * 0.12);
      arr.push(base);
    }
    return arr;
  }, [session.id]);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }}>
      {vals.map((v, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div className="num" style={{ fontSize: 9, color: "var(--ink-dim)" }}>{Math.round(v * 100)}%</div>
          <div style={{ width: "100%", height: `${v * 100}%`, background: "var(--cyan)", boxShadow: "0 0 6px var(--cyan)" }}></div>
        </div>
      ))}
    </div>
  );
}

function TokenCurve({ points }) {
  if (!points.length) return <div className="muted">no snapshots</div>;
  const W = 1000, H = 200;
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(p.x / 100) * W} ${(p.y / 100) * H}`).join(" ");
  const fillD = pathD + ` L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* grid */}
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line x1={0} x2={W} y1={(p / 100) * H} y2={(p / 100) * H} stroke="var(--ink-ghost)" strokeWidth="1" />
          <text x={6} y={(p / 100) * H - 4} fontSize="10" fill="var(--ink-dim)" fontFamily="var(--mono)">{100 - p}K</text>
        </g>
      ))}
      <path d={fillD} fill="url(#tg)" />
      <path d={pathD} stroke="var(--primary)" strokeWidth="1.5" fill="none" style={{ filter: "drop-shadow(0 0 4px var(--primary))" }} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={(p.x / 100) * W} cy={(p.y / 100) * H} r="4" fill="var(--bg-0)" stroke="var(--primary)" strokeWidth="1.5" />
          <text x={(p.x / 100) * W + 8} y={(p.y / 100) * H - 8} fontSize="10" fill="var(--ink-strong)" fontFamily="var(--mono)">{(p.v.total/1000).toFixed(1)}K</text>
        </g>
      ))}
    </svg>
  );
}

/* ============================================================
   05 — DIAGNOSTICS
   ============================================================ */
function DiagnosticsView({ session, setSelected, setView }) {
  const [level, setLevel] = useState("WARN");
  const [target, setTarget] = useState("all");
  const [scope, setScope] = useState("this");
  const [tail, setTail] = useState(true);

  // simulate live tail with a "now" ticker
  useEffect(() => {
    if (!tail) return;
    const id = setInterval(() => {}, 1500);
    return () => clearInterval(id);
  }, [tail]);

  const filtered = LOGS.filter((l) => {
    if (level !== "all" && l.level !== level) return false;
    if (target !== "all" && l.target !== target) return false;
    if (scope === "this" && l.thread_id !== session.id) return false;
    return true;
  }).slice(0, 200);

  // target stats
  const targetCounts = useMemo(() => {
    const c = {};
    LOGS.forEach((l) => { c[l.target] = (c[l.target] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, []);

  // warning counts by thread
  const warnByThread = useMemo(() => {
    const c = {};
    LOGS.filter((l) => l.level === "WARN").forEach((l) => { c[l.thread_id] = (c[l.thread_id] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, []);

  return (
    <div className="diag">
      <aside>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--rule)" }}>
          <div className="kicker" style={{ color: "var(--primary)" }}>▸ Filter</div>
          <div className="display" style={{ fontSize: 18, color: "var(--ink-strong)", marginTop: 4 }}>LOG STREAM</div>
          <div className="muted" style={{ fontSize: 11 }}>logs_2.sqlite · 406,883 rows</div>
        </div>

        <div className="filter-grp">
          <div className="lbl">Level</div>
          <div className="row">
            {["all", "WARN", "INFO", "DEBUG", "TRACE"].map((v) => (
              <button key={v} className="opt" data-on={level === v} onClick={() => setLevel(v)}>{v}</button>
            ))}
          </div>
        </div>
        <div className="filter-grp">
          <div className="lbl">Scope</div>
          <div className="row">
            <button className="opt" data-on={scope === "this"} onClick={() => setScope("this")}>This session</button>
            <button className="opt" data-on={scope === "all"} onClick={() => setScope("all")}>All threads</button>
          </div>
        </div>

        <div className="filter-grp" style={{ flex: 1, overflow: "auto" }}>
          <div className="lbl">Target · top 10</div>
          <button className="opt" data-on={target === "all"} onClick={() => setTarget("all")} style={{ marginBottom: 6, width: "100%", textAlign: "left" }}>all targets</button>
          {targetCounts.slice(0, 10).map(([t, n]) => (
            <button key={t} className="opt" data-on={target === t} onClick={() => setTarget(t)} style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: 4, textAlign: "left" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{t}</span>
              <span className="num">{n}</span>
            </button>
          ))}
        </div>

        <div className="filter-grp" style={{ borderTop: "1px solid var(--rule)" }}>
          <div className="lbl">Mode</div>
          <button className="opt" data-on={tail} onClick={() => setTail(!tail)} style={{ display: "flex", gap: 6 }}>
            <span className={tail ? "warn-c blink" : "faint"}>●</span> {tail ? "Tail · live" : "Paused"}
          </button>
        </div>
      </aside>

      <main>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "center", gap: 12, background: "var(--bg-1)" }}>
          <span className="kicker">{scope === "this" ? "▸ This session" : "▸ All threads"} · {level} · {target}</span>
          <span className="spacer" style={{ flex: 1 }}></span>
          <span className="muted num">{filtered.length} rows</span>
          <span className="warn-c blink">{tail ? "● LIVE" : ""}</span>
        </div>
        <div style={{ overflow: "auto" }}>
          {filtered.length === 0 && <div className="muted" style={{ padding: 30, textAlign: "center", letterSpacing: "0.2em" }}>—— no rows match filter ——</div>}
          {filtered.map((l, i) => (
            <div key={l.id + "-" + i} className={`log-row ${l.level}`}>
              <span className="ts num">{fmtTimeMs(l.ts).slice(0, 12)}</span>
              <span><span className={"lvl " + l.level}></span>{l.level}</span>
              <span className="tgt">{l.target}</span>
              <span className="msg">{l.msg} {l.thread_id !== session.id && <span className="muted" style={{ fontSize: 10 }}>· {l.thread_id.slice(0, 8)}…</span>}</span>
            </div>
          ))}
        </div>
      </main>

      <aside className="right">
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--rule)" }}>
          <div className="kicker" style={{ color: "var(--primary)" }}>▸ Health</div>
          <div className="display" style={{ fontSize: 18, color: "var(--ink-strong)", marginTop: 4 }}>RUNTIME</div>
        </div>

        <div style={{ padding: 14, borderBottom: "1px solid var(--rule)" }}>
          <div className="kicker mb-2">▸ Warn count · 5 min</div>
          <VBars data={[1, 0, 2, 4, 0, 1, 8, 3, 1, 2, 0, 0]} color="var(--warn)" h={48} />
          <div className="flex between" style={{ fontSize: 10, color: "var(--ink-dim)", letterSpacing: "0.18em", marginTop: 4 }}>
            <span>5m AGO</span><span>NOW</span>
          </div>
        </div>

        <div style={{ padding: 14, borderBottom: "1px solid var(--rule)" }}>
          <div className="kicker mb-2">▸ Loudest threads</div>
          {warnByThread.slice(0, 5).map(([id, n]) => {
            const s = SESSIONS.find((x) => x.id === id);
            return (
              <div key={id} onClick={() => s && setSelected(s.id)} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px dashed var(--rule-soft)", cursor: "pointer", fontSize: 11 }}>
                <span className="strong">{s ? (s.agent_nickname || "USER") : id.slice(0, 8)}</span>
                <span className="warn-c num">▲ {n}</span>
              </div>
            );
          })}
        </div>

        <div style={{ padding: 14, borderBottom: "1px solid var(--rule)" }}>
          <div className="kicker mb-2">▸ Plugin loader</div>
          <div style={{ fontSize: 11, lineHeight: 1.6 }}>
            <div className="warn-c">▲ skill 'read_pdf' manifest missing 'description'</div>
            <div className="warn-c">▲ duplicate id 'pdf-extract' shadowed</div>
            <div className="good-c">✓ 18 skills loaded · 42ms</div>
          </div>
        </div>

        <div style={{ padding: 14, flex: 1, overflow: "auto" }}>
          <div className="kicker mb-2">▸ Raw fallback</div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
            <code>~/.codex/log/codex-tui.log</code> · 24.6 MB
            <div style={{ marginTop: 6 }}>not parsed — open via raw tail view (advanced).</div>
          </div>
          <button style={{ marginTop: 12, padding: "8px 12px", border: "1px solid var(--rule)", color: "var(--ink-dim)", fontFamily: "var(--display)", letterSpacing: "0.18em", textTransform: "uppercase", fontSize: 10, fontWeight: 700 }}>
            ▸ Open raw tail
          </button>
        </div>
      </aside>
    </div>
  );
}

/* mount */
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
