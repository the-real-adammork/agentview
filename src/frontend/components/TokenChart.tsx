import type { TokenSnapshot } from "../../shared/contracts";

interface TokenChartProps {
  snapshots: TokenSnapshot[];
}

export function TokenChart({ snapshots }: TokenChartProps) {
  const maxTotal = Math.max(1, ...snapshots.map((snapshot) => snapshot.total));

  return (
    <div className="token-chart" aria-label="Token curve">
      {snapshots.map((snapshot) => {
        const height = Math.max(4, (snapshot.total / maxTotal) * 100);
        return (
          <div className="token-chart__bar" key={snapshot.timestamp}>
            <span style={{ blockSize: `${height}%` }} />
            <time dateTime={snapshot.timestamp}>{new Date(snapshot.timestamp).toLocaleTimeString("en-US")}</time>
          </div>
        );
      })}
    </div>
  );
}
