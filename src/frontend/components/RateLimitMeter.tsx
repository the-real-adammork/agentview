interface RateLimitMeterProps {
  label: string;
  value?: number;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export function RateLimitMeter({ label, value }: RateLimitMeterProps) {
  const percent = value === undefined ? 0 : clampPercent(value);
  const valueLabel = value === undefined ? "n/a" : `${Math.round(percent)}%`;

  return (
    <div className="rate-meter">
      <div className="rate-meter__label">
        <span>
          {label} {valueLabel}
        </span>
        <strong>{valueLabel}</strong>
      </div>
      <div
        aria-label={label}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(percent)}
        className="rate-meter__track"
        role="meter"
      >
        <span style={{ inlineSize: `${percent}%` }} />
      </div>
    </div>
  );
}
