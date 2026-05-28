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

function TokenGrid({ snapshot }: { snapshot: NonNullable<TimelineEvent["tokenSnapshot"]> }) {
  const cells: Array<{ k: string; v: string; tone?: "primary" | "warn" }> = [
    { k: "Σ", v: numberFormatter.format(snapshot.total) },
    { k: "IN", v: numberFormatter.format(snapshot.input) },
    { k: "OUT", v: numberFormatter.format(snapshot.output) },
    { k: "CACHED", v: numberFormatter.format(snapshot.cachedInput) },
  ];
  if (snapshot.contextUtilization !== undefined) {
    cells.push({ k: "CTX %", v: snapshot.contextUtilization.toFixed(1), tone: "primary" });
  }
  if (snapshot.rateLimitPrimaryPercent !== undefined) {
    cells.push({
      k: "RATE %",
      v: `${Math.round(snapshot.rateLimitPrimaryPercent)}`,
      tone: snapshot.rateLimitPrimaryPercent > 60 ? "warn" : "primary",
    });
  }

  return (
    <div className="ev-token-grid">
      {cells.map((cell) => (
        <div className="ev-token-grid__cell" key={cell.k}>
          <span className="k">{cell.k}</span>
          <span className="v num" data-tone={cell.tone}>{cell.v}</span>
        </div>
      ))}
    </div>
  );
}

interface TimelineEventRowProps {
  event: TimelineEvent;
  meta?: string;
  onOpenThread?(threadId: string): void;
}

export function TimelineEventRow({ event, meta, onOpenThread }: TimelineEventRowProps) {
  const present = presentationFor(event);
  const durationMs = event.joinedDurationMs ?? event.durationMs;
  const exitCode = event.joinedExitCode ?? event.exitCode;
  const outputPreview = event.kind === "tool_call" ? event.joinedOutputPreview ?? event.outputPreview : event.outputPreview;
  const failed = exitCode !== undefined && exitCode !== 0;
  const isTool = event.kind === "tool_call" || event.kind === "tool_result";
  const showChildAction = event.kind === "agent_launch" && Boolean(event.childThreadId);

  const args =
    event.argumentsPreview ??
    (event.kind === "agent_launch" && event.agentNickname
      ? `${event.agentNickname}${event.agentRole ? ` (${event.agentRole})` : ""}${event.agentTaskPreview ? ` // ${event.agentTaskPreview}` : ""}`
      : undefined);

  return (
    <li className={`ev ${present.evClass}`.trim()} data-kind={event.kind} data-severity={event.severity}>
      <div className="ts num">{formatTime(event.timestamp)}</div>
      <div className="body" style={{ borderColor: present.border }}>
        <div className="head">
          <span className={`who tone-${present.whoTone}`}>{present.who}</span>
          {event.phase ? <span>{event.phase}</span> : null}
          {event.callId ? <span>call_id {event.callId}</span> : null}
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
          <TokenGrid snapshot={event.tokenSnapshot} />
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
