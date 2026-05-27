import { Panel } from "../components/Panel";
import type { TokenSeries } from "../../shared/contracts";

const numberFormatter = new Intl.NumberFormat("en-US");

interface TokensViewProps {
  series: TokenSeries;
}

export function TokensView({ series }: TokensViewProps) {
  return (
    <Panel eyebrow="Fixture token series" title="Tokens">
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
      </div>
      <ol className="snapshot-list" aria-label="Token snapshots">
        {series.snapshots.map((snapshot) => (
          <li className="snapshot-list__item" key={snapshot.timestamp}>
            <time dateTime={snapshot.timestamp}>{new Date(snapshot.timestamp).toLocaleTimeString("en-US")}</time>
            <span>{numberFormatter.format(snapshot.total)} total</span>
            <span>{snapshot.contextUtilization}% context</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
