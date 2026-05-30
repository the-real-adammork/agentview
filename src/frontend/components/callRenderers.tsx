import type { CallRender, FetchCallRender, ReadCallRender, SearchCallRender } from "../../shared/contracts";

/*
 * Call-side renderers — a one-line summary of a tool *invocation* (read / search
 * / fetch), driven by the server-classified `callRender`. Complementary to the
 * exec output renderers, which render the result. Ported from the design's
 * call-renderers.jsx (agent/skill keep their own first-class event rows).
 */

type WhoTone = "primary" | "good" | "amber" | "warn" | "cyan" | "ink";
export interface CallCategory {
  label: string;
  tone: WhoTone;
  border: string;
}

/** Row WHO label + accent for a call-rendered tool invocation. */
export function callCategory(render: CallRender): CallCategory {
  switch (render.kind) {
    case "read":
      return { label: "READ", tone: "ink", border: "var(--rule-strong)" };
    case "search_call":
      return { label: "SEARCH", tone: "good", border: "var(--good)" };
    case "fetch":
      return render.mode === "fetch"
        ? { label: "FETCH", tone: "cyan", border: "var(--cyan)" }
        : { label: "WEB SEARCH", tone: "cyan", border: "var(--cyan)" };
  }
}

function ReadView({ r }: { r: ReadCallRender }) {
  return (
    <div className="xr xr-call-line">
      <span className="cl-icon">≡</span>
      <span className="cl-path">{r.path}</span>
      {r.startLine != null ? (
        <span className="cl-meta num">
          L{r.startLine}
          {r.endLine ? `–${r.endLine}` : ""}
        </span>
      ) : null}
      {r.totalLines != null ? <span className="cl-res num">{r.totalLines} lines</span> : null}
    </div>
  );
}

function SearchCallView({ r }: { r: SearchCallRender }) {
  return (
    <div className="xr xr-call-line">
      <span className="cl-icon">⌕</span>
      <span className="cl-pat">
        /{r.pattern}/{r.flags ?? ""}
      </span>
      {r.path ? <span className="cl-scope">{r.path}</span> : null}
      {r.hits != null ? (
        <span className={`cl-res num${r.hits === 0 ? " zero" : ""}`}>
          {r.hits} hit{r.hits === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

function FetchView({ r }: { r: FetchCallRender }) {
  const isFetch = r.mode === "fetch";
  return (
    <div className="xr xr-call-line">
      <span className={`cl-mode ${isFetch ? "get" : "srch"}`}>{isFetch ? "GET" : "WEB"}</span>
      <span className="cl-q">{r.query ?? r.url}</span>
      {r.results != null ? (
        <span className="cl-res num">
          {r.results} result{r.results === 1 ? "" : "s"}
        </span>
      ) : null}
      {r.status != null ? <span className="cl-res num">{r.status}</span> : null}
    </div>
  );
}

/** Dispatch the call body on `callRender.kind`. */
export function CallLine({ render }: { render: CallRender }) {
  switch (render.kind) {
    case "read":
      return <ReadView r={render} />;
    case "search_call":
      return <SearchCallView r={render} />;
    case "fetch":
      return <FetchView r={render} />;
    default:
      return null;
  }
}
