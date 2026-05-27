import { Panel } from "../components/Panel";
import { RateLimitMeter } from "../components/RateLimitMeter";
import { ShortId } from "../components/ShortId";
import { TokenChart } from "../components/TokenChart";
import type { ApiError, SessionSummary, TokenSeries } from "../../shared/contracts";

const numberFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, style: "percent" });

interface TokensViewProps {
  activeSession?: SessionSummary;
  series?: TokenSeries;
  topSessions: SessionSummary[];
  isLoading: boolean;
  error: ApiError | null;
  onRefresh(): void;
  onSelectSession(sessionId: string, view: "Timeline"): void;
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

  return (
    <Panel eyebrow={activeSession?.title ?? "Selected session"} title="Tokens">
      <div className="timeline-actions">
        <button type="button" onClick={onRefresh}>
          Refresh tokens
        </button>
      </div>
      {error ? <div className="inline-alert" role="alert">{error.message}</div> : null}
      {isLoading ? <div role="status">Loading tokens</div> : null}
      {!series ? <div className="empty-state">No token series loaded.</div> : null}
      {series ? (
        <>
      <div className="metric-row">
        <div className="metric">
          <span>Total</span>
          <strong>{numberFormatter.format(series.totals.total)}</strong>
        </div>
        <div className="metric">
          <span>Cached input {numberFormatter.format(series.totals.cachedInput)}</span>
          <strong>{numberFormatter.format(series.totals.cachedInput)}</strong>
        </div>
        <div className="metric">
          <span>Output</span>
          <strong>{numberFormatter.format(series.totals.output)}</strong>
        </div>
        <div className="metric" aria-label="Cached input ratio">
          <span>Cached ratio</span>
          <strong>{series.cachedInputRatio === undefined ? "n/a" : percentFormatter.format(series.cachedInputRatio)}</strong>
        </div>
      </div>
      <div className="token-grid">
        <TokenChart snapshots={series.snapshots} />
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
      </div>
      {emptyReasons.length > 0 ? (
        <ul className="empty-reasons" aria-label="Token empty-state reasons">
          {emptyReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <ol className="snapshot-list" aria-label="Token snapshots">
        {series.snapshots.map((snapshot) => (
          <li className="snapshot-list__item" key={snapshot.timestamp}>
            <time dateTime={snapshot.timestamp}>{new Date(snapshot.timestamp).toLocaleTimeString("en-US")}</time>
            <span>{numberFormatter.format(snapshot.total)} total</span>
            <span>{snapshot.contextUtilization}% context</span>
          </li>
        ))}
      </ol>
        </>
      ) : null}
      <div className="table-frame">
        <table aria-label="Top token sessions">
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Tokens</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {topSessions.slice(0, 6).map((session) => (
              <tr key={session.id}>
                <th scope="row">
                  <span className="session-title">{session.title}</span>
                  <ShortId value={session.id} />
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
      </div>
    </Panel>
  );
}
