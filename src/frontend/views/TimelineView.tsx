import { Panel } from "../components/Panel";
import { TimelineEventRow } from "../components/TimelineEventRow";
import { TimelineScrubber } from "../components/TimelineScrubber";
import type { ApiError, SessionSummary, TimelinePayload } from "../../shared/contracts";

interface TimelineViewProps {
  activeSession?: SessionSummary;
  payload?: TimelinePayload;
  isLoading?: boolean;
  error?: ApiError | null;
  activeKind: string;
  onKindChange(kind: string): void;
  onRefresh(): void;
  onTail(): void;
  onSelectSession(sessionId: string, view: "Timeline"): void;
}

const filters = ["all", "user_message", "assistant_message", "tool_call", "tool_result", "token_snapshot", "warning"] as const;

export function TimelineView({
  activeSession,
  payload,
  isLoading = false,
  error = null,
  activeKind,
  onKindChange,
  onRefresh,
  onSelectSession,
  onTail,
}: TimelineViewProps) {
  const events = payload?.events ?? [];
  const visibleEvents = activeKind === "all" ? events : events.filter((event) => event.kind === activeKind);

  return (
    <Panel eyebrow={activeSession?.title ?? "Fixture timeline"} title="Timeline">
      <div className="timeline-toolbar">
        <div className="timeline-tabs" aria-label="Timeline event filters">
          {filters.map((filter) => (
            <button
              aria-pressed={activeKind === filter}
              className="timeline-tabs__button"
              key={filter}
              type="button"
              onClick={() => onKindChange(filter)}
            >
              {filter.replaceAll("_", " ")}
            </button>
          ))}
        </div>
        <div className="timeline-actions">
          <button type="button" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" onClick={onTail}>
            Tail
          </button>
        </div>
      </div>

      {error ? <div role="alert" className="inline-alert">{error.message}</div> : null}
      {isLoading ? <div role="status">Loading timeline</div> : null}

      <div className="timeline-summary" aria-label="Timeline summary">
        <span>{events.length} events</span>
        <span>cache: {payload?.cacheStatus ?? "pending"}</span>
        <span>next byte: {payload?.nextByteOffset ?? 0}</span>
      </div>

      <TimelineScrubber events={events} activeKind={activeKind} />

      <ol className="timeline-list" aria-label="Timeline events">
        {visibleEvents.map((event) => (
          <TimelineEventRow event={event} key={event.id} onOpenThread={(threadId) => onSelectSession(threadId, "Timeline")} />
        ))}
      </ol>
    </Panel>
  );
}
