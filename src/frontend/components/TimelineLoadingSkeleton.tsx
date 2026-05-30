/**
 * Stream skeleton shown while a session's rollout is fetched + parsed. Seven
 * shimmer rows mirror the real event-row grid (80px timestamp gutter + bordered
 * body) so the swap to real content causes no layout shift, with a staggered
 * top-down cascade. See docs/design/workflowkit-evangelion/docs/Timeline
 * Loading State.md.
 */
const ROWS = 7;

export function TimelineLoadingSkeleton() {
  return (
    <div className="tl-skel" aria-busy="true" aria-label="Loading rollout">
      {Array.from({ length: ROWS }, (_, i) => (
        <div className="tl-skel-row" key={i} style={{ animationDelay: `${i * 70}ms` }}>
          <span className="sk-ts shimmer" />
          <span className="sk-body">
            <span className="sk-head">
              <span className="sk-tag shimmer" style={{ width: 90 + (i % 3) * 34 }} />
              <span className="sk-meta shimmer" style={{ width: 54 }} />
            </span>
            <span className="sk-line shimmer" style={{ width: `${68 - (i % 4) * 12}%` }} />
            {i % 3 === 0 ? <span className="sk-line shimmer" style={{ width: `${44 - (i % 2) * 10}%` }} /> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
