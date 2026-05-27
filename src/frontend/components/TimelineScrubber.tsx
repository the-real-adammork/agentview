import type { TimelineEvent } from "../../shared/contracts";

export function TimelineScrubber({ events, activeKind }: { events: TimelineEvent[]; activeKind: string }) {
  const ticks = events.slice(0, 80);

  return (
    <div className="timeline-scrubber" aria-label="Timeline scrubber">
      {ticks.map((event) => (
        <a
          aria-label={`${event.kind} line ${event.sourceLine}`}
          className="timeline-scrubber__tick"
          data-active={activeKind === "all" || activeKind === event.kind}
          data-severity={event.severity}
          href={`#${event.id}`}
          key={event.id}
        />
      ))}
    </div>
  );
}
