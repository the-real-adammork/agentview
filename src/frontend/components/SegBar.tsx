import type { ObservatoryView } from "../App";

interface SegBarProps {
  activeView: ObservatoryView;
  onChange: (view: ObservatoryView) => void;
  views: readonly ObservatoryView[];
}

export function SegBar({ activeView, onChange, views }: SegBarProps) {
  return (
    <nav className="segbar" aria-label="Primary views">
      {views.map((view) => (
        <button
          aria-current={view === activeView ? "page" : undefined}
          className="segbar__button"
          key={view}
          onClick={() => onChange(view)}
          type="button"
        >
          {view}
        </button>
      ))}
    </nav>
  );
}
