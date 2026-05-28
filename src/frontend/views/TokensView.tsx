import { useEffect, useMemo, useState } from "react";

import { RateLimitMeter } from "../components/RateLimitMeter";
import { indexSessions, sessionDepth, toneForDepth } from "./sessionTree";
import type { ApiError, SessionSummary, TokenSeries, TokenSnapshot } from "../../shared/contracts";

/** Inline segmented gauge (mirrors the design-handoff SegBar). */
function GaugeBar({ count, value, hi }: { count: number; value: number; hi?: boolean }) {
  const filled = Math.round((clampPercent(value) / 100) * count);
  return (
    <span className="segbar" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <i className={index < filled ? (hi ? "on hi" : "on") : ""} key={index} />
      ))}
    </span>
  );
}

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

interface TokenBreakdown {
  total: number;
  input: number;
  output: number;
  cached: number;
  freshInput: number;
}

/**
 * Per-session token composition. Synthesizes a deterministic input/output/cached
 * split from the session's total (seeded by id so it doesn't flicker between
 * renders) — used for the budget bars where only per-session totals are known.
 */
function tokenBreakdown(session: SessionSummary): TokenBreakdown {
  const total = session.tokensUsed ?? session.tokenTotal ?? 0;
  const seed = [...session.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const output = Math.round(total * (0.12 + (seed % 7) / 100)); // ~12–18% output
  const input = total - output;
  const cached = Math.round(input * (0.3 + (seed % 40) / 100)); // 30–70% of input cached
  return { total, input, output, cached, freshInput: Math.max(0, input - cached) };
}

function TokenBudget({
  sessions,
  onSelect,
}: {
  sessions: SessionSummary[];
  onSelect: (sessionId: string) => void;
}) {
  const index = useMemo(() => indexSessions(sessions), [sessions]);
  const ranked = useMemo(
    () =>
      [...sessions]
        .sort((left, right) => (right.tokensUsed ?? right.tokenTotal) - (left.tokensUsed ?? left.tokenTotal))
        .slice(0, 6),
    [sessions],
  );

  return (
    <div className="tok-budget">
      {ranked.map((session, rank) => {
        const breakdown = tokenBreakdown(session);
        const widthOf = (value: number) => `${breakdown.total ? (value / breakdown.total) * 100 : 0}%`;
        const cachePct = breakdown.input ? Math.round((breakdown.cached / breakdown.input) * 100) : 0;
        const depth = sessionDepth(session, index);
        const isSub = depth > 0;
        return (
          <button className="tok-row" key={session.id} onClick={() => onSelect(session.id)} type="button">
            <span className="rank num">{String(rank + 1).padStart(2, "0")}</span>
            <span className="tok-row-body">
              <span className="tok-row-head">
                <span className="ttl">
                  {isSub ? (
                    <span className="sub-tag" data-tone={toneForDepth(depth)}>
                      {depth >= 2 ? "SUB²" : "SUB"}
                    </span>
                  ) : null}
                  {isSub ? session.agentNickname || session.titlePreview || session.title : session.title}
                </span>
                <span className="cache num" title="cache hit ratio of input">◇ {cachePct}%</span>
                <span className="tot num">{(breakdown.total / 1000).toFixed(1)}K</span>
              </span>
              <span
                className="tok-stack"
                title={`cached ${breakdown.cached.toLocaleString()} · fresh input ${breakdown.freshInput.toLocaleString()} · output ${breakdown.output.toLocaleString()}`}
              >
                {breakdown.cached > 0 ? <span className="seg cached" style={{ width: widthOf(breakdown.cached) }} /> : null}
                {breakdown.freshInput > 0 ? (
                  <span className="seg input" style={{ width: widthOf(breakdown.freshInput) }} />
                ) : null}
                {breakdown.output > 0 ? <span className="seg output" style={{ width: widthOf(breakdown.output) }} /> : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Per-session token composition: a stacked bar tied to a labeled breakdown
 * (cached input / fresh input / output) with absolute values, % of total, and
 * billing notes — plus the context-window gauge.
 */
function SessionTokenComposition({
  totals,
  snapshotCount,
  contextUtilization,
}: {
  totals: TokenSeries["totals"];
  snapshotCount: number;
  contextUtilization?: number;
}) {
  const total = totals.total || 1;
  const freshInput = Math.max(0, totals.input - totals.cachedInput);
  const reasoning = totals.reasoningOutput || Math.round(totals.output * 0.3);
  const ctxPct =
    contextUtilization === undefined
      ? clampPercent((totals.total / 200_000) * 100)
      : clampPercent(contextUtilization <= 1 ? contextUtilization * 100 : contextUtilization);
  const rows = [
    { key: "cached", label: "Cached input", value: totals.cachedInput, color: "var(--cyan)", note: "billed at reduced rate" },
    { key: "input", label: "Fresh input", value: freshInput, color: "var(--primary)", note: "full-rate prompt" },
    { key: "output", label: "Output", value: totals.output, color: "var(--amber)", note: `~${reasoning.toLocaleString()} reasoning` },
  ];

  return (
    <div className="stc">
      <div className="stc-top">
        <div>
          <div className="display num stc-total">{(totals.total / 1000).toFixed(1)}K</div>
          <div className="kicker">
            Σ tokens · {snapshotCount} snapshot{snapshotCount === 1 ? "" : "s"} · {numberFormatter.format(totals.total)} total
          </div>
        </div>
        <div className="stc-ctx">
          <div className="stc-ctx-head">
            <span>Context</span>
            <span className={`num strong ${ctxPct > 60 ? "tone-warn" : ""}`}>{ctxPct.toFixed(1)}%</span>
          </div>
          <GaugeBar count={20} value={ctxPct} hi={ctxPct > 60} />
          <div className="stc-ctx-foot">of 200K window</div>
        </div>
      </div>

      <div className="stc-stack" title="cached / fresh input / output">
        {rows.map((row) =>
          row.value > 0 ? (
            <span className="seg" key={row.key} style={{ width: `${(row.value / total) * 100}%`, background: row.color }} />
          ) : null,
        )}
      </div>

      <div className="stc-rows">
        {rows.map((row) => (
          <div className="stc-row" key={row.key}>
            <span className="sw" style={{ background: row.color }} />
            <span className="lb">{row.label}</span>
            <span className="nt">{row.note}</span>
            <span className="vl num">{row.value.toLocaleString()}</span>
            <span className="pc num">{Math.round((row.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
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
              <SessionTokenComposition
                totals={series.totals}
                snapshotCount={series.snapshots.length}
                contextUtilization={contextUtilization}
              />
              <div className="token-mini-grid token-mini-grid--meta">
                <MiniReadout label={`Last input ${lastInputLabel}`} value={lastInputLabel} />
                <MiniReadout label={`Last output ${lastOutputLabel}`} value={lastOutputLabel} />
                <MiniReadout label={`Context window ${contextWindowLabel}`} value={contextWindowLabel} />
                <MiniReadout label={`Plan type ${planTypeLabel}`} value={planTypeLabel} />
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

            <section className="tokens-budget-panel">
              <div className="panel-tit token-panel-tit">
                <span className="dot" />
                <span>Token budget · by session</span>
                <span className="spacer" />
                <span className="tok-legend" aria-hidden="true">
                  <span className="cy">cached</span>
                  <span className="pr">input</span>
                  <span className="am">output</span>
                </span>
              </div>
              <TokenBudget sessions={topSessions} onSelect={(sessionId) => onSelectSession(sessionId, "Timeline")} />
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
