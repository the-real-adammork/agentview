import type { TimelineEvent, TimelineEventKind } from "../../shared/contracts";
import { ToolOutputPreview } from "./ToolOutputPreview";

const numberFormatter = new Intl.NumberFormat("en-US");
const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-US");

const durationLabel = (durationMs: number) =>
  durationMs >= 1000 ? `${(durationMs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}s` : `${durationMs}ms`;

type WhoTone = "primary" | "good" | "amber" | "warn" | "cyan" | "ink";

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

const presentationFor = (event: TimelineEvent): KindPresentation => {
  switch (event.kind) {
    case "task_started":
      return { evClass: "", who: "▸ TASK_STARTED", whoTone: "primary", border: "var(--primary)" };
    case "task_complete":
      return { evClass: "", who: "▸ TASK_COMPLETE", whoTone: "good", border: "var(--good)" };
    case "user_message":
      return { evClass: "user", who: "USER", whoTone: "cyan", border: "var(--rule)" };
    case "assistant_message":
      return { evClass: "assistant", who: "ASSISTANT", whoTone: "ink", border: "var(--rule)" };
    case "agent_message":
      return { evClass: "spawn", who: "AGENT REPORT", whoTone: "good", border: "var(--good)" };
    case "reasoning":
      return { evClass: "assistant", who: "REASONING", whoTone: "ink", border: "var(--rule)" };
    case "tool_call":
      return {
        evClass: "tool",
        who: `▸ ${(event.toolName ?? "tool").toUpperCase()}`,
        whoTone: "amber",
        border: "var(--amber)",
      };
    case "tool_result":
      return { evClass: "tool", who: "TOOL RESULT", whoTone: "amber", border: "var(--amber)" };
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
}

export function TimelineEventRow({ event, meta, delta, isNew, source, onOpenThread }: TimelineEventRowProps) {
  const present = presentationFor(event);
  const durationMs = event.joinedDurationMs ?? event.durationMs;
  const exitCode = event.joinedExitCode ?? event.exitCode;
  const outputPreview = event.kind === "tool_call" ? event.joinedOutputPreview ?? event.outputPreview : event.outputPreview;
  const failed = exitCode !== undefined && exitCode !== 0;
  const isTool = event.kind === "tool_call" || event.kind === "tool_result";
  const showChildAction = event.kind === "agent_launch" && Boolean(event.childThreadId);

  const args =
    // Shell-style tool calls show the clean command line, not the raw args JSON.
    (event.commandPreview || undefined) ??
    event.argumentsPreview ??
    (event.kind === "agent_launch" && event.agentNickname
      ? `${event.agentNickname}${event.agentRole ? ` (${event.agentRole})` : ""}${event.agentTaskPreview ? ` // ${event.agentTaskPreview}` : ""}`
      : undefined);

  return (
    <li
      className={`ev ${present.evClass}${isNew ? " ev-enter" : ""}${source ? " with-src" : ""}`.trim()}
      data-kind={event.kind}
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
      <div className="body" style={{ borderColor: present.border }}>
        <div className="head">
          <span className={`who tone-${present.whoTone}`}>{present.who}</span>
          {event.kind === "token_snapshot" ? <span>snapshot</span> : null}
          {event.phase ? <span>{event.phase}</span> : null}
          {event.callId ? <span>call_id {event.callId}</span> : null}
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
              onClick={() => onOpenThread?.(event.childThreadId as string)}
            >
              ↗ open child
            </button>
          ) : null}
        </div>

        {args ? <div className="args">$ {args}</div> : null}

        {event.kind === "token_snapshot" && event.tokenSnapshot ? (
          <TokenComposition snapshot={event.tokenSnapshot} />
        ) : isTool ? null : (
          <pre className={present.whoTone === "warn" ? "tone-warn" : undefined}>{event.previewText}</pre>
        )}

        {outputPreview ? (
          <div className={`out${failed ? " fail" : ""}`}>
            <div className="out__label">
              STDOUT · {numberFormatter.format(event.outputBytes ?? outputPreview.length)} bytes{failed ? " · FAILED" : ""}
            </div>
            <ToolOutputPreview preview={outputPreview} outputBytes={event.outputBytes} collapsed={event.isCollapsedByDefault} />
          </div>
        ) : null}
      </div>
    </li>
  );
}
