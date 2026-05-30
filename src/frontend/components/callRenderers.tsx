import type {
  AgentCallRender,
  CallRender,
  FetchCallRender,
  ReadCallRender,
  SearchCallRender,
  ToolSearchCallRender,
} from "../../shared/contracts";

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
    case "agent":
      return render.op === "spawn"
        ? { label: "SPAWN AGENT", tone: "good", border: "var(--good)" }
        : render.op === "send"
          ? { label: "SEND INPUT", tone: "amber", border: "var(--amber)" }
          : { label: "WAIT AGENT", tone: "cyan", border: "var(--cyan)" };
    case "tool_search":
      return { label: "TOOL SEARCH", tone: "cyan", border: "var(--cyan)" };
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

function AgentView({ r }: { r: AgentCallRender }) {
  const icon = r.op === "spawn" ? "⊕" : r.op === "send" ? "→" : "◌";
  const opCls = r.op === "spawn" ? "spawn" : r.op === "send" ? "send" : "wait";
  const resTone = r.status === "open" || r.status === "ok" ? "ok" : r.status === "failed" || r.status === "timed_out" ? "warn" : "";
  const waitTargets = r.targets ? r.targets.join(", ") : "";
  return (
    <div className="xr xr-call-line agent">
      <span className={`cl-op ${opCls}`}>{icon}</span>
      {r.op === "spawn" ? (
        <>
          <span className="cl-nick">{r.nickname ?? "agent"}</span>
          {r.role ? <span className="cl-role">{r.role}</span> : null}
          <span className="cl-task">// {r.task}</span>
        </>
      ) : r.op === "send" ? (
        <>
          <span className="cl-nick">{r.nickname ?? r.target}</span>
          <span className="cl-task">// {r.message}</span>
        </>
      ) : (
        <span className="cl-q">
          await {waitTargets}
          {r.targets && r.targets.length > 1 ? ` (${r.targets.length})` : ""}…
        </span>
      )}
      {r.status ? <span className={`cl-res ${resTone}`}>{r.status === "timed_out" ? "timed out" : r.status}</span> : null}
    </div>
  );
}

// tool_search — tool-catalog discovery. Collapsed = a search-call line (⌕ query ·
// N tools); the namespace → function tree (with summaries + param chips) renders
// inline, capped at CAP functions, with a "+N more tools" hint for the rest.
function ToolSearchView({ r, full }: { r: ToolSearchCallRender; full?: boolean }) {
  const CAP = 4;
  let shown = 0;
  const total = r.namespaces.reduce((sum, ns) => sum + ns.functions.length, 0);
  const overflow = !full && total > CAP ? total - CAP : 0;
  return (
    <div className="xr xr-toolsearch">
      <div className="xr-ts-line">
        <span className="cl-icon">⌕</span>
        <span className="cl-q">&quot;{r.query}&quot;</span>
        <span className="cl-res num">
          {r.resultCount} tool{r.resultCount === 1 ? "" : "s"}
        </span>
      </div>
      {r.namespaces.map((ns, ni) => {
        if (!full && shown >= CAP) return null;
        const fns = full ? ns.functions : ns.functions.slice(0, Math.max(0, CAP - shown));
        shown += fns.length;
        return (
          <div className="xr-ts-ns" key={ni}>
            <div className="xr-ts-ns-hd">
              <span className="ns-name">{ns.name}</span>
              {ns.description ? <span className="ns-desc">{ns.description}</span> : null}
            </div>
            {fns.map((fn, fi) => (
              <div className="xr-ts-fn" key={fi}>
                <span className="br">{fi === ns.functions.length - 1 ? "└" : "├"}</span>
                <span className="fn-name">{fn.name}</span>
                {fn.summary ? <span className="fn-sum">{fn.summary}</span> : null}
                {fn.params && fn.params.length > 0 ? (
                  <span className="fn-params">
                    {fn.params.slice(0, 4).map((param, pi) => (
                      <span className="pchip" key={pi}>
                        {param}
                      </span>
                    ))}
                    {fn.params.length > 4 ? <span className="pmore">+{fn.params.length - 4}</span> : null}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        );
      })}
      {overflow > 0 ? <div className="xr-ts-more">+{overflow} more tools</div> : null}
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
    case "agent":
      return <AgentView r={render} />;
    case "tool_search":
      return <ToolSearchView r={render} />;
    default:
      return null;
  }
}
