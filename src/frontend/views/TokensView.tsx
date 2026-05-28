import { useEffect, useMemo, useState } from "react";

import { RateLimitMeter } from "../components/RateLimitMeter";
import { ShortId } from "../components/ShortId";
import type { ApiError, SessionSummary, TokenSeries, TokenSnapshot } from "../../shared/contracts";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, style: "percent" });
const resetFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "UTC",
  timeZoneName: "short",
});
const clampPercent = (value?: number) => Math.max(0, Math.min(100, value ?? 0));

interface TokensViewProps {
  activeSession?: SessionSummary;
  series?: TokenSeries;
  topSessions: SessionSummary[];
  isLoading: boolean;
  error: ApiError | null;
  onRefresh(): void;
  onSelectSession(sessionId: string, view: "Timeline"): void;
}

function panelTitle(label: string, meta?: string) {
  return (
    <div className="panel-tit token-panel-tit">
      <span className="dot" />
      <span>{label}</span>
      {meta ? (
        <>
          <span className="spacer" />
          <span className="meta">{meta}</span>
        </>
      ) : null}
    </div>
  );
}

function buildAggregateBuckets(topSessions: SessionSummary[], series?: TokenSeries) {
  const buckets = Array.from({ length: 36 }, () => 0);
  const source = topSessions.length > 0 ? topSessions : [];

  source.forEach((session, index) => {
    const tokenTotal = session.tokensUsed ?? session.tokenTotal;
    const bucketIndex = Math.min(35, Math.max(0, Math.round((index / Math.max(1, source.length - 1)) * 35)));
    buckets[bucketIndex] += tokenTotal;
  });

  if (source.length === 0 && series) {
    buckets[35] = series.totals.total;
  }

  return buckets;
}

function BigBars({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);

  return (
    <div className="token-bars" aria-label="Aggregate token flow bars">
      {data.map((value, index) => {
        const ratio = value / max;
        return (
          <span className={ratio > 0.8 ? "hi" : ""} key={`${index}-${value}`}>
            <i style={{ blockSize: `${Math.max(3, ratio * 100)}%` }} />
            <b>{index % 6 === 0 ? `${index - 36}m` : ""}</b>
          </span>
        );
      })}
    </div>
  );
}

function Readout({
  label,
  sub,
  tone,
  value,
}: {
  label: string;
  sub?: string;
  tone?: "warn" | "cyan" | "amber";
  value: string;
}) {
  return (
    <div className="token-readout">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
      {sub ? <em>{sub}</em> : null}
    </div>
  );
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

function ResetCountdown({ resetAt }: { resetAt?: string }) {
  const target = resetAt ? new Date(resetAt).getTime() : Number.NaN;
  const hasTarget = !Number.isNaN(target);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasTarget) {
      return undefined;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasTarget, target]);

  if (!hasTarget) {
    return <div className="rate-reset rate-reset--idle">Reset · n/a</div>;
  }

  const remaining = target - now;

  return (
    <div className="rate-reset" role="timer" aria-live="off">
      <span>Resets in</span>
      <strong className="num">{remaining <= 0 ? "now" : formatCountdown(remaining)}</strong>
    </div>
  );
}

function MiniReadout({ label, value }: { label: string; value: string }) {
  return (
    <div className="token-mini">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TokenCurve({ snapshots }: { snapshots: TokenSnapshot[] }) {
  if (snapshots.length === 0) {
    return <div className="empty-state">No snapshots</div>;
  }

  const width = 1000;
  const height = 220;
  const maxTotal = Math.max(1, ...snapshots.map((snapshot) => snapshot.total));
  const points = snapshots.map((snapshot, index) => {
    const x = snapshots.length === 1 ? 0 : (index / (snapshots.length - 1)) * width;
    const y = height - (snapshot.total / maxTotal) * (height - 16) - 8;
    return { snapshot, x, y };
  });
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const fill = `${path} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg className="token-curve" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} aria-label="Token curve">
      <defs>
        <linearGradient id="token-curve-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 25, 50, 75, 100].map((line) => (
        <g key={line}>
          <line x1={0} x2={width} y1={(line / 100) * height} y2={(line / 100) * height} />
          <text x={6} y={(line / 100) * height - 4}>
            {100 - line}%
          </text>
        </g>
      ))}
      <path className="fill" d={fill} />
      <path className="line" d={path} />
      {points.map((point) => (
        <g key={point.snapshot.timestamp}>
          <circle cx={point.x} cy={point.y} r="4" />
          <text x={point.x + 8} y={point.y - 8}>
            {compactFormatter.format(point.snapshot.total)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function CachedRatioBars({ snapshots, ratio }: { snapshots: TokenSnapshot[]; ratio?: number }) {
  const measurable = snapshots.filter((snapshot) => snapshot.input > 0);

  if (measurable.length === 0 && ratio === undefined) {
    return <div className="empty-state">No cache data</div>;
  }

  const values =
    measurable.length > 0
      ? measurable.slice(-12).map((snapshot) => snapshot.cachedInput / snapshot.input)
      : [ratio ?? 0];

  return (
    <div className="token-cache-bars">
      {values.map((value, index) => (
        <span key={`${index}-${value}`}>
          <b>{Math.round(clampPercent(value * 100))}%</b>
          <i style={{ blockSize: `${clampPercent(value * 100)}%` }} />
        </span>
      ))}
    </div>
  );
}

export function TokensView({
  activeSession,
  error,
  isLoading,
  onRefresh,
  onSelectSession,
  series,
  topSessions,
}: TokensViewProps) {
  const emptyReasons = series?.emptyStateReasons ?? [];
  const latestSnapshot = series?.snapshots.at(-1);
  const primaryRate = series?.rateLimitPrimaryPercent ?? latestSnapshot?.rateLimitPrimaryPercent;
  const secondaryRate = series?.rateLimitSecondaryPercent ?? latestSnapshot?.rateLimitSecondaryPercent;
  const contextUtilization = series?.latestContextUtilization ?? latestSnapshot?.contextUtilization;
  const resetAt = series?.resetAt ?? latestSnapshot?.resetAt;
  const lastInputLabel = latestSnapshot?.lastInput === undefined ? "n/a" : numberFormatter.format(latestSnapshot.lastInput);
  const lastOutputLabel = latestSnapshot?.lastOutput === undefined ? "n/a" : numberFormatter.format(latestSnapshot.lastOutput);
  const contextWindowLabel =
    latestSnapshot?.modelContextWindow === undefined ? "n/a" : numberFormatter.format(latestSnapshot.modelContextWindow);
  const planTypeLabel = latestSnapshot?.planType ?? "n/a";
  const resetLabel = resetAt ? resetFormatter.format(new Date(resetAt)) : "n/a";
  const aggregateBuckets = useMemo(() => buildAggregateBuckets(topSessions, series), [series, topSessions]);
  const currentTitle = activeSession?.title ?? "Selected session";

  return (
    <section className="tokens-view" aria-labelledby="tokens-title">
      <div className="tokens-head">
        <div>
          <p className="kicker">Token telemetry</p>
          <h1 id="tokens-title">Tokens</h1>
        </div>
        <button type="button" onClick={onRefresh}>
          Refresh tokens
        </button>
      </div>

      {error ? <div className="inline-alert" role="alert">{error.message}</div> : null}
      {isLoading ? <div role="status">Loading tokens</div> : null}
      {!series ? <div className="empty-state">No token series loaded.</div> : null}
      {series ? (
        <div className="tokens">
          <section className="tokens-flow">
            {panelTitle(
              "Aggregate token flow · all sessions · 36-bucket",
              `Σ ${compactFormatter.format(topSessions.reduce((total, session) => total + (session.tokensUsed ?? session.tokenTotal), 0))}`,
            )}
            <BigBars data={aggregateBuckets} />
          </section>

          <div className="row2 tokens-mid">
            <section>
              {panelTitle(`Session · ${currentTitle.slice(0, 42)}`)}
              <div className="token-readout-grid">
                <Readout
                  label="Σ Total"
                  value={numberFormatter.format(series.totals.total)}
                  sub={`${series.snapshots.length} snapshots`}
                />
                <Readout
                  label="Context %"
                  value={contextUtilization === undefined ? "n/a" : `${Math.round(clampPercent(contextUtilization))}%`}
                  sub={`window ${contextWindowLabel}`}
                  tone={clampPercent(contextUtilization) > 60 ? "warn" : undefined}
                />
              </div>
              <div className="token-mini-grid">
                <MiniReadout label={`Last input ${lastInputLabel}`} value={lastInputLabel} />
                <MiniReadout label={`Last output ${lastOutputLabel}`} value={lastOutputLabel} />
                <MiniReadout
                  label={`Cached input ${numberFormatter.format(series.totals.cachedInput)}`}
                  value={numberFormatter.format(series.totals.cachedInput)}
                />
                <MiniReadout label="Output" value={numberFormatter.format(series.totals.output)} />
              </div>
              <div className="token-mini-grid token-mini-grid--meta">
                <MiniReadout label={`Context window ${contextWindowLabel}`} value={contextWindowLabel} />
                <MiniReadout label={`Plan type ${planTypeLabel}`} value={planTypeLabel} />
                <MiniReadout label={`Reset ${resetLabel}`} value={resetLabel} />
                <MiniReadout
                  label="Cached ratio"
                  value={series.cachedInputRatio === undefined ? "n/a" : percentFormatter.format(series.cachedInputRatio)}
                />
              </div>
            </section>

            <section className="tokens-curve-panel">
              {panelTitle("Token curve · token_count snapshots", "scale 0-100%")}
              <TokenCurve snapshots={series.snapshots} />
            </section>
          </div>

          <div className="row2 tokens-low">
            <section>
              {panelTitle("Rate limits")}
              <div className="rate-meter-stack">
                <RateLimitMeter label="Primary rate limit" value={primaryRate} />
                <RateLimitMeter label="Secondary rate limit" value={secondaryRate} />
                <RateLimitMeter
                  label="Context utilization"
                  value={
                    contextUtilization === undefined
                      ? undefined
                      : contextUtilization <= 1
                        ? contextUtilization * 100
                        : contextUtilization
                  }
                />
              </div>
              <ResetCountdown resetAt={resetAt} />
              <div className="token-plan">Plan · {planTypeLabel} · next {resetLabel}</div>
            </section>

            <section className="tokens-top-panel">
              {panelTitle("Top sessions · tokens used")}
              <table aria-label="Top token sessions" className="token-session-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Session</th>
                    <th scope="col">Tokens</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {topSessions.slice(0, 6).map((session, index) => (
                    <tr key={session.id}>
                      <td className="numeric">{String(index + 1).padStart(2, "0")}</td>
                      <th scope="row">
                        <span className="session-title">{session.title}</span>
                        <ShortId value={session.id} />
                        <span className="segbar" aria-hidden="true">
                          {Array.from({ length: 20 }, (_, segmentIndex) => (
                            <i
                              className={(segmentIndex + 1) * 5 <= clampPercent(((session.tokensUsed ?? session.tokenTotal) / 200_000) * 100) ? "on" : ""}
                              key={segmentIndex}
                            />
                          ))}
                        </span>
                      </th>
                      <td className="numeric">{numberFormatter.format(session.tokensUsed ?? session.tokenTotal)}</td>
                      <td>
                        <button type="button" onClick={() => onSelectSession(session.id, "Timeline")}>
                          Open {session.title}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
              {panelTitle("Cache hit ratio · last snapshots")}
              <div className="token-ratio-readout" aria-label="Cached input ratio">
                {series.cachedInputRatio === undefined ? "n/a" : percentFormatter.format(series.cachedInputRatio)}
              </div>
              <CachedRatioBars snapshots={series.snapshots} ratio={series.cachedInputRatio} />
              {emptyReasons.length > 0 ? (
                <ul className="empty-reasons" aria-label="Token empty-state reasons">
                  {emptyReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
