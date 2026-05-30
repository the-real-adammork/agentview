import type { TimelineEvent, TimelineEventKind } from "../../shared/contracts";
import { ExecOutput, isExpandable } from "./execRenderers";

const numberFormatter = new Intl.NumberFormat("en-US");
const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-US");

const durationLabel = (durationMs: number) =>
  durationMs >= 1000 ? `${(durationMs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}s` : `${durationMs}ms`;

type WhoTone = "primary" | "good" | "amber" | "warn" | "cyan" | "ink" | "skill" | "dim";

interface KindPresentation {
  evClass: string;
  who: string;
  whoTone: WhoTone;
  border: string;
}

const fallbackPresentation = (kind: TimelineEventKind): KindPresentation => ({
  evClass: "",
  who: kind.replaceAll("_", " ").toUpperCase(),
  whoTone: "ink",
  border: "var(--rule)",
});

interface ExecCategory {
  label: string;
  tone: WhoTone;
  border: string;
}

/**
 * exec_command is by far the most common tool, so a row that just says
 * "EXEC_COMMAND" tells you nothing. Type it by what it actually did — the
 * structured output kind when we classified one, else the command verb — so the
 * card label + border match the body (diff/search/git/file/…) and the stream is
 * scannable by category instead of a wall of identical "EXEC_COMMAND" rows.
 */
const EXEC_KIND_CATEGORY: Record<string, ExecCategory> = {
  diff: { label: "DIFF", tone: "cyan", border: "var(--cyan)" },
  tests: { label: "TEST RESULTS", tone: "good", border: "var(--good)" },
  status: { label: "GIT STATUS", tone: "amber", border: "var(--amber)" },
  table: { label: "TABLE", tone: "primary", border: "var(--primary)" },
  file: { label: "FILE", tone: "ink", border: "var(--rule-strong)" },
  matches: { label: "SEARCH", tone: "good", border: "var(--good)" },
  http: { label: "HTTP", tone: "cyan", border: "var(--cyan)" },
  json: { label: "JSON", tone: "cyan", border: "var(--cyan)" },
  log: { label: "GIT LOG", tone: "amber", border: "var(--amber)" },
  build: { label: "BUILD", tone: "primary", border: "var(--primary)" },
  lint: { label: "LINT", tone: "amber", border: "var(--amber)" },
  trace: { label: "TRACE", tone: "warn", border: "var(--warn)" },
};

const execCategoryFromCommand = (command: string): ExecCategory => {
  const stripped = command.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, "").trim();
  const tokens = stripped.split(/\s+/);
  const head = (tokens[0] ?? "").toLowerCase().replace(/.*\//, "");
  if (head === "git") {
    // Skip git global options (`-C <path>`, `-c <cfg>`, `--git-dir <p>`, `--no-pager`, …)
    // so the label reads the real subcommand, not `-C`.
    let i = 1;
    while (i < tokens.length) {
      const token = tokens[i];
      if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") i += 2;
      else if (token.startsWith("-")) i += 1;
      else break;
    }
    const gitSub = (tokens[i] ?? "").toLowerCase().replace(/[^a-z0-9-].*$/, "");
    return { label: `GIT ${gitSub.toUpperCase()}`.trim(), tone: "amber", border: "var(--amber)" };
  }
  if (/^(?:rg|grep|ag|ack)$/.test(head)) return { label: "SEARCH", tone: "good", border: "var(--good)" };
  if (/^(?:find|fd)$/.test(head)) return { label: "FIND", tone: "cyan", border: "var(--cyan)" };
  if (/^(?:ls|tree|exa|eza)$/.test(head)) return { label: "LIST", tone: "ink", border: "var(--rule-strong)" };
  if (/^(?:sed|nl|cat|head|tail|wc|bat|less|more)$/.test(head)) return { label: "READ", tone: "ink", border: "var(--rule-strong)" };
  if (head === "sqlite3") return { label: "SQL", tone: "primary", border: "var(--primary)" };
  if (/^(?:curl|wget)$/.test(head)) return { label: "HTTP", tone: "cyan", border: "var(--cyan)" };
  if (/^(?:npm|pnpm|yarn|bun|node|deno|docker|make|cargo|go|tsc|vite|webpack|turbo|nx|gradle|mvn)$/.test(head)) {
    return { label: "BUILD", tone: "primary", border: "var(--primary)" };
  }
  if (/^(?:pytest|vitest|jest|mocha|ava)$/.test(head)) return { label: "TEST RESULTS", tone: "good", border: "var(--good)" };
  const verb = head.replace(/[^a-z0-9_.+-].*$/i, "");
  return { label: verb ? verb.toUpperCase() : "EXEC", tone: "amber", border: "var(--amber)" };
};

const execCategory = (event: TimelineEvent): ExecCategory => {
  const render = event.outputRender;
  const kind = render?.kind;
  if (kind && kind !== "plain" && EXEC_KIND_CATEGORY[kind]) {
    // A failing test run reads as a warning, not a clean (green) pass.
    if (render?.kind === "tests" && render.failed > 0) {
      return { label: "TEST RESULTS", tone: "warn", border: "var(--warn)" };
    }
    return EXEC_KIND_CATEGORY[kind];
  }
  return execCategoryFromCommand(event.commandPreview ?? "");
};

const presentationFor = (event: TimelineEvent): KindPresentation => {
  switch (event.kind) {
    case "task_started":
      return { evClass: "", who: "▸ TASK_STARTED", whoTone: "primary", border: "var(--primary)" };
    case "task_complete":
      return { evClass: "", who: "▸ TASK_COMPLETE", whoTone: "good", border: "var(--good)" };
    case "turn_context":
      // High-frequency, low-value: recede with a muted dot, dim label, soft border.
      return { evClass: "context", who: "▸ TURN_CONTEXT", whoTone: "dim", border: "var(--rule-soft)" };
    case "user_message":
      return { evClass: "user", who: "USER", whoTone: "cyan", border: "var(--rule)" };
    case "assistant_message":
      return { evClass: "assistant", who: "ASSISTANT", whoTone: "ink", border: "var(--rule)" };
    case "agent_message":
      return { evClass: "spawn", who: "AGENT REPORT", whoTone: "good", border: "var(--good)" };
    case "reasoning":
      // Usually encrypted/withheld — de-emphasize so it clearly reads as "hidden".
      return { evClass: "context", who: "REASONING", whoTone: "dim", border: "var(--rule-soft)" };
    case "tool_call": {
      const toolName = event.toolName ?? "";
      const renderKind = event.outputRender?.kind;
      const hasTypedRender = Boolean(renderKind && renderKind !== "plain" && EXEC_KIND_CATEGORY[renderKind]);
      const isShell = toolName === "exec_command" || toolName === "shell" || (!toolName && Boolean(event.commandPreview));
      // Type the row by its classified output when there is one — so a tool that
      // isn't a shell but still produced structured output (e.g. write_stdin piping
      // into a vitest watcher → TEST RESULTS) gets the typed label + border too.
      // Else type a shell row by its command verb; otherwise keep the tool name.
      if (hasTypedRender || isShell) {
        const category = execCategory(event);
        // apply_patch renders its edit as a diff, but reads clearer as "PATCH".
        const label = toolName === "apply_patch" ? "PATCH" : category.label;
        return { evClass: "tool", who: `▸ ${label}`, whoTone: category.tone, border: category.border };
      }
      return { evClass: "tool", who: `▸ ${(toolName || "tool").toUpperCase()}`, whoTone: "amber", border: "var(--amber)" };
    }
    case "tool_result":
      return { evClass: "tool", who: "TOOL RESULT", whoTone: "amber", border: "var(--amber)" };
    case "skill_invoke":
      return {
        evClass: "skill",
        who: `✦ SKILL · ${event.skillName ?? "skill"}`,
        whoTone: "skill",
        border: "var(--skill)",
      };
    case "agent_launch":
      return { evClass: "spawn", who: "⊕ SPAWN_AGENT", whoTone: "good", border: "var(--good)" };
    case "agent_wait":
      return { evClass: "spawn", who: "◌ WAIT_AGENT", whoTone: "good", border: "var(--good)" };
    case "token_snapshot":
      return { evClass: "token", who: "TOKEN_COUNT", whoTone: "ink", border: "var(--rule-soft)" };
    case "warning":
      return { evClass: "warn", who: "▲ WARNING", whoTone: "warn", border: "var(--warn)" };
    case "parse_error":
      return { evClass: "warn", who: "▲ PARSE ERROR", whoTone: "warn", border: "var(--warn)" };
    default:
      return fallbackPresentation(event.kind);
  }
};

const compact1 = (value: number) => `${(value / 1000).toFixed(1)}K`;

/** Inline segmented gauge for the token-row meters (handoff SegBar). */
function MeterBar({ count, value, hi }: { count: number; value: number; hi?: boolean }) {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * count);
  return (
    <div className="segbar" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <i className={index < filled ? (hi ? "on hi" : "on") : undefined} key={index} />
      ))}
    </div>
  );
}

/**
 * token_count snapshot row: total + cache-hit %, a stacked composition bar
 * (cached / fresh input / output) with a legend, and context/rate meters.
 */
function TokenComposition({
  snapshot,
}: {
  snapshot: NonNullable<TimelineEvent["tokenSnapshot"]>;
}) {
  const total = snapshot.total || 1;
  const fresh = Math.max(0, snapshot.input - snapshot.cachedInput);
  const cachePct = snapshot.input ? Math.round((snapshot.cachedInput / snapshot.input) * 100) : 0;
  const ctxPct =
    snapshot.contextUtilization ??
    (snapshot.modelContextWindow ? (snapshot.total / snapshot.modelContextWindow) * 100 : (snapshot.total / 200_000) * 100);
  const ratePct = snapshot.rateLimitPrimaryPercent;
  const widthOf = (value: number) => `${(value / total) * 100}%`;

  return (
    <div className="tkc">
      <div className="tkc-total">
        <span className="num strong v">{compact1(snapshot.total)}</span>
        <span className="muted">total · {cachePct}% of input cached</span>
      </div>
      <div
        className="tkc-stack"
        title={`cached ${numberFormatter.format(snapshot.cachedInput)} · fresh input ${numberFormatter.format(fresh)} · output ${numberFormatter.format(snapshot.output)}`}
      >
        {snapshot.cachedInput > 0 ? <span className="seg cached" style={{ width: widthOf(snapshot.cachedInput) }} /> : null}
        {fresh > 0 ? <span className="seg input" style={{ width: widthOf(fresh) }} /> : null}
        {snapshot.output > 0 ? <span className="seg output" style={{ width: widthOf(snapshot.output) }} /> : null}
      </div>
      <div className="tkc-legend">
        <span className="cy">cached {compact1(snapshot.cachedInput)}</span>
        <span className="pr">input {compact1(fresh)}</span>
        <span className="am">output {compact1(snapshot.output)}</span>
      </div>
      <div className="tkc-meters">
        <div className="tkc-meter">
          <div className="flex between">
            <span className="k">Context window</span>
            <span className={`num ${ctxPct > 60 ? "tone-warn" : "strong"}`}>{ctxPct.toFixed(1)}%</span>
          </div>
          <MeterBar count={18} value={ctxPct} hi={ctxPct > 60} />
        </div>
        {ratePct !== undefined ? (
          <div className="tkc-meter">
            <div className="flex between">
              <span className="k">Rate limit</span>
              <span className={`num ${ratePct > 60 ? "tone-warn" : "strong"}`}>{Math.round(ratePct)}%</span>
            </div>
            <MeterBar count={18} value={ratePct} hi={ratePct > 60} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Origin of an event when the stream merges sub-agent threads (+SUBS scope). */
export interface EventSource {
  /** Tree depth: 0 root · 1 sub · 2+ sub-sub. */
  depth: number;
  /** Short agent name shown under the depth bars. */
  name: string;
  /** Depth tone: orange root · amber sub · cyan sub-sub. */
  tone: "primary" | "amber" | "cyan";
}

interface TimelineEventRowProps {
  event: TimelineEvent;
  meta?: string;
  /** Token total gained since the previous token_count snapshot (Δ chip). */
  delta?: number;
  /** Whether this row just entered the live stream (feed-enter animation). */
  isNew?: boolean;
  /** When set (+SUBS scope), prepend a depth-toned rail showing the source agent. */
  source?: EventSource;
  onOpenThread?(threadId: string): void;
  /** Open this event's full output in the exec modal (tool rows with rich/overflowing output). */
  onExpand?(event: TimelineEvent): void;
}

export function TimelineEventRow({ event, meta, delta, isNew, source, onOpenThread, onExpand }: TimelineEventRowProps) {
  const present = presentationFor(event);
  const durationMs = event.joinedDurationMs ?? event.durationMs;
  const exitCode = event.joinedExitCode ?? event.exitCode;
  const hasOutput =
    Boolean(event.outputRender) || Boolean(event.joinedOutputPreview) || Boolean(event.outputPreview);
  const failed = exitCode !== undefined && exitCode !== 0;
  const isTool = event.kind === "tool_call" || event.kind === "tool_result";
  // High-frequency, low-signal rows that should recede into a dim one-liner.
  const isQuietContext = event.kind === "turn_context" || event.kind === "reasoning";
  const showChildAction = event.kind === "agent_launch" && Boolean(event.childThreadId);
  // A tool row with structured or overflowing output opens the full-output modal;
  // the whole body becomes the affordance (spawn rows keep their ↗ open child).
  const expandable = isTool && hasOutput && isExpandable(event) && Boolean(onExpand);
  const openModal = expandable ? () => onExpand?.(event) : undefined;

  const args =
    // Shell-style tool calls show the clean command line, not the raw args JSON.
    // Skill rows show their summary as prose instead of a `$ args` line. Bare
    // config JSON (e.g. write_stdin's session_id/yield_time_ms) is suppressed —
    // the WHO label + output carry the meaning, so a `$ {json}` line is just noise.
    event.kind === "skill_invoke"
      ? undefined
      : (event.commandPreview || undefined) ??
        (event.argumentsPreview && !/^\s*[{[]/.test(event.argumentsPreview) ? event.argumentsPreview : undefined) ??
        (event.kind === "agent_launch" && event.agentNickname
          ? `${event.agentNickname}${event.agentRole ? ` (${event.agentRole})` : ""}${event.agentTaskPreview ? ` // ${event.agentTaskPreview}` : ""}`
          : undefined);

  return (
    <li
      className={`ev ${present.evClass}${isNew ? " feed-enter" : ""}${source ? " with-src" : ""}${expandable ? " expandable" : ""}`.trim()}
      data-kind={event.kind}
      data-exec-cat={present.whoTone}
      data-severity={event.severity}
    >
      {source ? (
        <div className="ev-src-rail" data-tone={source.tone} title={source.name}>
          <span className="ev-src-bars" aria-hidden="true">
            {Array.from({ length: source.depth + 1 }, (_, level) => (
              <span className="ev-src-bar" data-lvl={Math.min(level, 2)} key={level} />
            ))}
          </span>
          <span className="ev-src-name">{source.name}</span>
        </div>
      ) : null}
      <div className="ts num">{formatTime(event.timestamp)}</div>
      <div
        className="body"
        style={{ borderColor: present.border }}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-label={expandable ? "Expand full output" : undefined}
        onClick={openModal}
        onKeyDown={
          expandable
            ? (domEvent) => {
                if (domEvent.key === "Enter" || domEvent.key === " ") {
                  domEvent.preventDefault();
                  openModal?.();
                }
              }
            : undefined
        }
      >
        <div className="head">
          <span className={`who tone-${present.whoTone}`}>{present.who}</span>
          {event.kind === "token_snapshot" ? <span>snapshot</span> : null}
          {event.phase ? <span>{event.phase}</span> : null}
          {event.callId ? <span>call_id {event.callId}</span> : null}
          {event.kind === "skill_invoke" && event.skillStatus ? (
            <span className={`chip ${event.skillStatus === "fail" ? "warn" : "good"}`}>{event.skillStatus}</span>
          ) : null}
          {event.kind === "token_snapshot" && delta !== undefined ? (
            <span className="chip cyan ev__right">Δ +{compact1(delta)} since last</span>
          ) : null}
          {isTool && exitCode !== undefined ? (
            <span className={`chip ${failed ? "warn" : "good"}`}>
              exit {exitCode}
              {durationMs !== undefined ? ` · ${durationLabel(durationMs)}` : ""}
            </span>
          ) : null}
          {event.kind === "agent_wait" && event.severity === "error" ? <span className="chip warn">failed</span> : null}
          {meta ? <span className="ev__right">{meta}</span> : null}
          {showChildAction ? (
            <button
              type="button"
              className="chip cyan ev__child"
              aria-label={`Open ${event.childThreadId} in Timeline`}
              onClick={(domEvent) => {
                domEvent.stopPropagation();
                onOpenThread?.(event.childThreadId as string);
              }}
            >
              ↗ open child
            </button>
          ) : null}
        </div>

        {args ? <div className="args">$ {args}</div> : null}

        {/* task_started is a quiet header marker — its config shows in the head meta,
            so the body stays empty (matches the handoff). turn_context / reasoning
            recede as a dim one-liner. Everything else keeps the readable pre. */}
        {event.kind === "task_started" ? null : event.kind === "token_snapshot" && event.tokenSnapshot ? (
          <TokenComposition snapshot={event.tokenSnapshot} />
        ) : isTool ? null : isQuietContext ? (
          <div className="ev-context">{event.previewText}</div>
        ) : (
          <pre className={present.whoTone === "warn" ? "tone-warn" : undefined}>{event.previewText}</pre>
        )}

        {isTool && hasOutput ? <ExecOutput event={event} onExpand={openModal} /> : null}
      </div>
    </li>
  );
}
