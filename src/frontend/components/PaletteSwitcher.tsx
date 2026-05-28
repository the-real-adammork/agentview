export const PALETTES = ["orange", "amber", "red", "cyan"] as const;

export type Palette = (typeof PALETTES)[number];

const LABELS: Record<Palette, string> = {
  orange: "ORG",
  amber: "AMB",
  red: "RED",
  cyan: "CYN",
};

interface PaletteSwitcherProps {
  palette: Palette;
  onChange: (palette: Palette) => void;
}

export function PaletteSwitcher({ palette, onChange }: PaletteSwitcherProps) {
  return (
    <div className="palette-switch" role="group" aria-label="Color palette">
      {PALETTES.map((option) => (
        <button
          aria-pressed={option === palette}
          className={`palette-switch__opt palette-switch__opt--${option}`}
          key={option}
          onClick={() => onChange(option)}
          title={`${option} palette`}
          type="button"
        >
          <span aria-hidden="true">{LABELS[option]}</span>
          <span className="sr-only">{option} palette</span>
        </button>
      ))}
    </div>
  );
}
