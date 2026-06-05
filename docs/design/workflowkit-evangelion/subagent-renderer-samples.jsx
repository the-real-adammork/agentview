/* subagent_notification renderer — sample data + showcase.
   Loads the REAL renderer from subagent-renderer.jsx (shared with the dashboard). */

const { useState: snUseState } = React;

/* ── Sample A — COMPLETED · market research (the real notification) ───────── */
const stenoBody = `**Market And Competition Findings**

- Steno sits in the **tech-enabled court reporting, remote deposition, and litigation support** category. Official positioning combines certified stenographic court reporting, video, realtime transcripts, interpreters, remote proceedings, conference rooms, concierge support, and legal technology. **Confidence: High.** Sources: Steno court reporting page, accessed June 5, 2026; Steno remote depositions page, accessed June 5, 2026. ([steno.com](https://steno.com/services/court-reporting)) ([steno.com](https://steno.com/services/remote-depositions))

- Steno's differentiation is not just transcript production; it bundles **payment innovation + workflow software + AI transcript analysis**. DelayPay defers payment until case conclusion with no interest, while Transcript Genius supports transcript search, summaries, Q&A, contradiction finding, and source-linked verification. **Confidence: High.** Sources: Steno DelayPay, accessed June 5, 2026; Transcript Genius, accessed June 5, 2026. ([steno.com](https://steno.com/services/delaypay)) ([steno.com](https://steno.com/technology/transcript-genius))

- Core U.S. market-size proxy: P&S Intelligence estimates the **U.S. court reporting services market at $533.6M in 2024**, $552.9M in 2025, and $789.1M by 2032, a 5.2% CAGR. Treat this as a **narrow SAM proxy**, not full TAM, because Steno also sells videography, remote deposition tooling, transcript AI, integrations, and litigation support services. **Confidence: Medium** due to commercial report methodology limits. ([psmarketresearch.com](https://www.psmarketresearch.com/market-analysis/us-court-reporting-services-market))

- Broader market-size proxies are inconsistent. One global report estimates court reporting services at **$2.76B in 2026** growing to $3.21B by 2035 at 1.69% CAGR, while other snippets use different scopes and higher growth rates. This supports a **fragmented, modest-growth core market with larger adjacent-market upside**, not a clean single TAM. **Confidence: Low-Medium.** ([marketresearchguru.com](https://www.marketresearchguru.com/market-reports/court-reporting-services-market-901563)) ([worldwidemarketreports.com](https://www.worldwidemarketreports.com/market-insights/court-reporting-deposition-services-market-1017552))

- Growth drivers: sustained litigation pressure, remote/hybrid depositions, law-firm tech investment, and AI-assisted review. Thomson Reuters' 2026 legal market report cites "unprecedented demand growth" and nearly 10% higher tech investment, while Norton Rose Fulbright's 2026 survey of 400+ U.S. in-house litigation leaders points to sustained litigation pressure and rising costs. **Confidence: High for trend direction; Medium for direct Steno impact.** ([thomsonreuters.com](https://www.thomsonreuters.com/en/press-releases/2026)) ([nortonrosefulbright.com](https://www.nortonrosefulbright.com/en/knowledge/publications/2026-annual-litigation-trends-survey))

- Supply constraints are a structural driver and constraint. BLS reports 17,700 U.S. court reporters/captioners in 2024, flat 2024-2034 outlook, and ~1,700 annual openings mostly from replacement needs. NCRA membership data shows court reporter members average age 56, indicating retirement pressure. **Confidence: High for labor-market constraint; Medium for private deposition availability impact.** ([bls.gov](https://www.bls.gov/ooh/legal/court-reporters.htm)) ([ncra.org](https://www.ncra.org/home/about-ncra/NCRA-Statistics))

- Main competitors are national deposition/litigation support platforms plus local agencies and freelance reporters. Direct nationals include **Veritext**, **Esquire** (300,000+ annual depositions, 98% AmLaw 100 penetration), **U.S. Legal Support**, and **Lexitas** (court reporting, record retrieval, ADR, AI deposition summaries). **Confidence: High.** ([veritext.com](https://www.veritext.com/remotereporter/)) ([esquiresolutions.com](https://www.esquiresolutions.com/court-reporting-and-record-capture/)) ([uslegalsupport.com](https://www.uslegalsupport.com/)) ([lexitaslegal.com](https://www.lexitaslegal.com/solutions/court-reporting))

- Substitutes include digital reporters, voice writers, direct-booked freelance stenographers, in-house court staff, and generic recording plus ASR transcription. Substitution is constrained by certification, jurisdiction rules, admissibility expectations, and attorney trust. **Confidence: High for substitutes; Medium for adoption pace.** ([help.steno.com](https://help.steno.com/what-kind-of-court-reporters-does-steno-use)) ([aaert.org](https://aaert.org/become-certified/certification-program/))

**Contradictions / Uncertainty To Resolve**

- Market sizing varies sharply by definition: narrow U.S. court reporting services vs global court reporting vs broader deposition/litigation support and transcript AI.

- Steno's SOM is not publicly clear. Official sources say "thousands of firms" use Steno monthly and the Series C supports AmLaw 200 penetration, but no official deposition volume, revenue, or share is disclosed. ([brief.steno.com](https://brief.steno.com/steno-raises-49m-series-c))

- Digital reporting is both a substitute and a contested solution: AAERT legitimizes certification, competitors offer digital where permissible, while Steno and NCRA emphasize stenographic/CSR reliability and legal validity.

- Court reporter shortage evidence is strongest in public courts and California; private deposition availability may differ by region, rates, and remote-work preferences.

**Source List**

Official/company/government first: Steno court reporting; Steno DelayPay; Steno remote depositions; Steno Transcript Genius; Steno Series C announcement, Mar. 26, 2026; BLS Occupational Outlook Handbook; California Courts shortage fact sheet, June 2024; NCRA AI campaign, Dec. 2, 2024; AAERT certification page; Veritext; Esquire; U.S. Legal Support; Lexitas.

Secondary/market: P&S Intelligence U.S. court reporting market; MarketResearchGuru global court reporting report; Norton Rose Fulbright 2026 Annual Litigation Trends Survey; Thomson Reuters 2026 State of the U.S. Legal Market.`;

const notifCompleted = {
  agent_path: "019e9825-04ae-74e3-b315-388c93a24fad",
  agent_nickname: "ARCHIMEDES",
  agent_role: "researcher",
  tokens: 84120,
  status: { completed: stenoBody },
};

/* ── Sample B — IN PROGRESS · interim findings, lower confidence ───────────── */
const scoutBody = `**WAL Locking Investigation — Interim**

- The "database is locked" failures correlate with the realtime token-count writer holding a write transaction while the SSE handler attempts a concurrent insert. Repro is intermittent under load. **Confidence: Medium.** Sources: codex_core::db::query, logs_2.sqlite tail. ([db.rs:44](https://repo.internal/src/db.rs#L44))

- busy_timeout is set to 5000ms but journal_mode is being toggled to WAL **after** the connection opens, so the first writer in a fresh process can still race the pragma. **Confidence: Medium.** ([db.rs:40](https://repo.internal/src/db.rs#L40))

- A read-only flag on the index reader would remove it from the writer-contention set entirely; needs verification that no code path writes through that handle. **Confidence: Low — not yet reproduced.** ([issue-412](https://repo.internal/issues/412))

**Open Questions**

- Is the toggle-to-WAL-after-open actually in the hot path, or only on cold start? Need a flame graph under sustained ingest.

- Whether SQLITE_OPEN_NO_MUTEX is safe given the connection is shared across the tail thread — currently unverified.`;

const notifInProgress = {
  agent_path: "01c4f7a2-91bb-4d20-ae31-77c0e9d51a08",
  agent_nickname: "SOCRATES",
  agent_role: "worker",
  tokens: 19400,
  status: { in_progress: scoutBody },
};

/* ── Sample C — FAILED · short error status ────────────────────────────────── */
const notifFailed = {
  agent_path: "02ab10ff-7c44-4e9a-8a02-1de3b9aa55e1",
  agent_nickname: "BORGES",
  agent_role: "worker",
  tokens: 3100,
  status: { failed: `**Task Aborted**

- Could not reach the upstream pricing API after 4 retries; received 503 each time. No findings produced. **Confidence: High** that the endpoint is down, not a query error. ([api.internal](https://api.internal/v2/pricing))

- Recommend re-spawn once the collector reports healthy, or fall back to the cached 2026-Q1 snapshot.` },
};

/* ── showcase ─────────────────────────────────────────────────────────────── */
function SnCard({ title, notif, tone, note, onOpen }) {
  return (
    <div className="spec">
      <div className="stitle">
        <span className="dot"></span>
        <span className="nm">{title}</span>
        <span className="st" data-tone={tone}>{tone === "fail" ? "FAILURE" : tone === "ok" ? "COMPLETE" : "IN PROGRESS"}</span>
      </div>
      <div className="stage">
        <div className="ev-faux sn-faux">
          <div className="head">
            <span className="who">▸ SUBAGENT_NOTIFICATION</span>
            <span className="cmd">{notif.agent_nickname} · {notif.agent_path.slice(0, 8)}…</span>
          </div>
          <SubagentOutput notif={notif} onExpand={() => onOpen(notif)} />
        </div>
      </div>
      <div className="notes">
        <span><b>{note}</b></span>
        <span className="pill" onClick={() => onOpen(notif)}>Open modal ⤢</span>
      </div>
    </div>
  );
}

function SnShowcase() {
  const [modal, setModal] = snUseState(null);
  return (
    <div className="lib">
      <header className="lib-head">
        <div className="mark"></div>
        <div>
          <h1>SUBAGENT NOTIFICATION</h1>
          <div className="sub">// child-agent status report renderer</div>
        </div>
        <div className="meta">
          <div><b>SOURCE</b> subagent-renderer.jsx</div>
          <div><b>STATES</b> completed · in_progress · failed</div>
          <div><b>USED BY</b> <a href="Observatory.html">Observatory ↗</a></div>
        </div>
      </header>

      <div className="intro">
        <b>When a child agent reports, the host injects a <code>&lt;subagent_notification&gt;</code> block into the parent's context.</b>
        Its <code>status</code> body is a structured findings report — bold section headers, bulleted findings each carrying a
        <code> **Confidence:**</code> marker and inline <code>([domain](url))</code> citations, a Contradictions section, and a Source List.
        This renderer parses that once and renders a <b>capped inline preview</b> (summary band + first two findings) with an
        <b> Expand</b> bar that opens the <b>modal</b> — every section, citation chips, and a <code>RAW</code> escape hatch.
        <div className="flow">
          <span className="box">host injects notif</span>
          <span className="arr">→</span>
          <span className="box">parse report</span>
          <span className="arr">→</span>
          <span className="box accent">findings · confidence · citations</span>
          <span className="arr">→</span>
          <span className="box">preview → modal</span>
        </div>
      </div>

      <section className="cat">
        <header>
          <div className="n">01</div>
          <div><h2>Completed</h2><div className="d">A finished research thread. Eight findings with mixed confidence, a Contradictions section, and a two-paragraph Source List. Inline caps at two findings; the rest open in the modal.</div></div>
          <div className="tag">status · completed</div>
        </header>
        <div className="grid cols-2">
          <SnCard title="Market research · ARCHIMEDES" notif={notifCompleted} tone="ok" note="8 findings · confidence mix · 15 sources — capped → Expand opens the full report" onOpen={setModal} />
          <SnCard title="WAL bug scout · SOCRATES" notif={notifInProgress} tone="progress" note="Interim update — amber status, lower confidence, open questions instead of a source list" onOpen={setModal} />
        </div>
      </section>

      <section className="cat">
        <header>
          <div className="n">02</div>
          <div><h2>Other states</h2><div className="d">The status key drives the tone: <code>completed</code> reads green and quiet, <code>in_progress</code> amber, <code>failed</code> red. A failure carries no findings — just the abort note and a recommendation.</div></div>
          <div className="tag">status · failed</div>
        </header>
        <div className="grid cols-2">
          <SnCard title="Aborted · BORGES" notif={notifFailed} tone="fail" note="Red status, no findings — the renderer falls back to the status note" onOpen={setModal} />
        </div>
      </section>

      <div className="lib-footer">
        <div>// WORKFLOWKIT · OBSERVATORY</div>
        <div className="center">SUBAGENT NOTIFICATION · 子エージェント報告</div>
        <div style={{ textAlign: "right" }}>v0.1 · 2026.06.05</div>
      </div>

      {modal && <SubagentModal notif={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<SnShowcase />);
