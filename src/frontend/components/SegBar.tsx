import type { ObservatoryView } from "../App";

interface SegBarProps {
  activeView: ObservatoryView;
  onChange: (view: ObservatoryView) => void;
  views: readonly ObservatoryView[];
}

export function SegBar({ activeView, onChange, views }: SegBarProps) {
  return (
    <nav className="nav" aria-label="Primary views">
      {views.map((view, index) => (
        <button
          aria-current={view === activeView ? "page" : undefined}
          data-active={view === activeView ? "true" : "false"}
          key={view}
          onClick={() => onChange(view)}
          type="button"
        >
          <span className="idx" aria-hidden="true">{String(index).padStart(2, "0")}</span>
          {view}
        </button>
      ))}
    </nav>
  );
}
