import type { TimelineEvent } from "../../shared/contracts";
import { ToolOutputPreview } from "./ToolOutputPreview";

const eventLabel = (kind: TimelineEvent["kind"]) => kind.replaceAll("_", " ");
const numberFormatter = new Intl.NumberFormat("en-US");

const durationLabel = (durationMs: number) =>
  durationMs >= 1000 ? `${(durationMs / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}s` : `${durationMs}ms`;

interface TimelineEventRowProps {
  event: TimelineEvent;
  onOpenThread?(threadId: string): void;
}

export function TimelineEventRow({ event, onOpenThread }: TimelineEventRowProps) {
  const durationMs = event.joinedDurationMs ?? event.durationMs;
  const outputPreview = event.kind === "tool_call" ? event.outputPreview : event.joinedOutputPreview ?? event.outputPreview;
  const exitCode = event.joinedExitCode ?? event.exitCode;
  const tokenSnapshot = event.tokenSnapshot;
  const showChildAction = event.kind === "agent_launch" && event.childThreadId;

  return (
    <li className="timeline-event" data-kind={event.kind} data-severity={event.severity}>
      <div className="timeline-event__meta">
        <span className="timeline-event__kind">{eventLabel(event.kind)}</span>
        <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString()}</time>
        <span>line {event.sourceLine}</span>
        {exitCode !== undefined ? <span>exit {exitCode}</span> : null}
        {durationMs !== undefined ? <span>{durationLabel(durationMs)}</span> : null}
      </div>
      <div className="timeline-event__body">
        <p>{event.previewText}</p>
        {tokenSnapshot ? (
          <div className="timeline-event__strip" aria-label="Timeline token strip">
            {tokenSnapshot.lastInput !== undefined ? <span>last input {numberFormatter.format(tokenSnapshot.lastInput)}</span> : null}
            {tokenSnapshot.lastOutput !== undefined ? <span>last output {numberFormatter.format(tokenSnapshot.lastOutput)}</span> : null}
            {tokenSnapshot.modelContextWindow !== undefined ? (
              <span>{numberFormatter.format(tokenSnapshot.modelContextWindow)} context</span>
            ) : null}
            {tokenSnapshot.planType ? <span>plan {tokenSnapshot.planType}</span> : null}
          </div>
        ) : null}
        {showChildAction ? (
          <div className="timeline-event__strip" aria-label="Timeline child action">
            <span>{event.childThreadId}</span>
            {event.agentNickname ? <span>{event.agentNickname}</span> : null}
            {event.agentRole ? <span>{event.agentRole}</span> : null}
            {onOpenThread ? (
              <button type="button" onClick={() => onOpenThread(event.childThreadId as string)}>
                Open {event.childThreadId} in Timeline
              </button>
            ) : null}
          </div>
        ) : null}
        {event.argumentsPreview ? <code>{event.argumentsPreview}</code> : null}
        <ToolOutputPreview
          preview={outputPreview}
          outputBytes={event.outputBytes}
          collapsed={event.isCollapsedByDefault}
        />
      </div>
    </li>
  );
}
