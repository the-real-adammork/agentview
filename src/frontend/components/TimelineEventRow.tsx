import type { TimelineEvent } from "../../shared/contracts";
import { ToolOutputPreview } from "./ToolOutputPreview";

const eventLabel = (kind: TimelineEvent["kind"]) => kind.replaceAll("_", " ");

export function TimelineEventRow({ event }: { event: TimelineEvent }) {
  return (
    <li className="timeline-event" data-kind={event.kind} data-severity={event.severity}>
      <div className="timeline-event__meta">
        <span className="timeline-event__kind">{eventLabel(event.kind)}</span>
        <time dateTime={event.timestamp}>{new Date(event.timestamp).toLocaleTimeString()}</time>
        <span>line {event.sourceLine}</span>
      </div>
      <div className="timeline-event__body">
        <p>{event.previewText}</p>
        {event.argumentsPreview ? <code>{event.argumentsPreview}</code> : null}
        <ToolOutputPreview
          preview={event.outputPreview}
          outputBytes={event.outputBytes}
          collapsed={event.isCollapsedByDefault}
        />
      </div>
    </li>
  );
}
