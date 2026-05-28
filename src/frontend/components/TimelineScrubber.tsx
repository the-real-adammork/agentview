import type { TimelineEvent } from "../../shared/contracts";
import { filterTimelineEvents } from "../views/timelineFilters";
import { AXIS_TICKS, scrubberDots } from "./scrubberGeometry";

export function TimelineScrubber({ events, activeKind }: { events: TimelineEvent[]; activeKind: string }) {
  const dots = scrubberDots(events);
  const activeIds = new Set(filterTimelineEvents(events, activeKind).map((event) => event.id));

  return (
    <div className="timeline-scrubber" aria-label="Timeline scrubber">
      <div className="timeline-scrubber__track">
        {dots.map((dot) => (
          <span
            aria-hidden="true"
            className="timeline-scrubber__dot"
            data-active={activeKind === "all" || activeIds.has(dot.id)}
            data-kind={dot.kind}
            key={dot.id}
            style={{
              left: `${dot.leftPct}%`,
              width: dot.widthPx,
              height: dot.height,
              background: dot.colorVar,
              color: dot.colorVar,
            }}
          />
        ))}
        {AXIS_TICKS.map((pct) => (
          <span aria-hidden="true" className="timeline-scrubber__axis" key={`axis-${pct}`} style={{ left: `${pct}%` }} />
        ))}
      </div>
    </div>
  );
}
