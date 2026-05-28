import type { ObservatoryView } from "../App";

interface SegBarProps {
  activeView: ObservatoryView;
  onChange: (view: ObservatoryView) => void;
  views: readonly ObservatoryView[];
}

export function SegBar({ activeView, onChange, views }: SegBarProps) {
  // The continuous selection rail runs from the header through to the active
  // tab. When the active view isn't a primary tab (Repos / Sessions) no tab is
  // railed, so the rail stops at the session square.
  const activeIndex = views.indexOf(activeView);

  return (
    <nav className="nav" aria-label="Primary views">
      {views.map((view, index) => (
        <button
          aria-current={view === activeView ? "page" : undefined}
          data-active={view === activeView ? "true" : "false"}
          data-rail={activeIndex >= 0 && index <= activeIndex ? "on" : undefined}
          key={view}
          onClick={() => onChange(view)}
          type="button"
        >
          <span className="idx" aria-hidden="true">{String(index).padStart(2, "0")}</span>
          <span className="label">{view}</span>
        </button>
      ))}
    </nav>
  );
}
