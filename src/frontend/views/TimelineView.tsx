import { Panel } from "../components/Panel";
import type { SessionSummary, TimelineEvent } from "../../shared/contracts";

interface TimelineViewProps {
  activeSession?: SessionSummary;
  events: TimelineEvent[];
}

export function TimelineView({ activeSession, events }: TimelineViewProps) {
  return (
    <Panel eyebrow={activeSession?.title ?? "Fixture timeline"} title="Timeline">
      <ol className="timeline-list" aria-label="Timeline events">
        {events.map((event) => (
          <li className="timeline-list__item" key={event.id}>
            <span className="timeline-list__kind">{event.kind}</span>
            <span className="timeline-list__preview">{event.previewText}</span>
            <span className="timeline-list__line">line {event.sourceLine}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
