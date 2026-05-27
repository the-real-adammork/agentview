import type { ReactNode } from "react";

import type { HealthStatus } from "../../shared/contracts";

interface ChromeProps {
  children: ReactNode;
  health: HealthStatus;
  sessionCount: number;
}

export function Chrome({ children, health, sessionCount }: ChromeProps) {
  const source = health.mode === "real" ? "state-db" : "fixture";

  return (
    <div className="app-shell">
      <header className="hazard-strip" aria-label="Observatory status">
        <div className="hazard-strip__identity">
          <span className="hazard-strip__kicker">Hazard</span>
          <span className="hazard-strip__title">AgentView Observatory</span>
        </div>
        <div className="hazard-strip__meta" aria-label="Transport health">
          <span>{health.mode} mode</span>
          <span>{health.status === "ok" ? "healthy" : "unavailable"}</span>
          <time dateTime={health.checkedAt}>{new Date(health.checkedAt).toLocaleTimeString("en-US")}</time>
        </div>
      </header>

      {children}

      <footer className="status-bar" role="status" aria-label="Transport status">
        <span>source: {source}</span>
        <span>{sessionCount} sessions</span>
        <span>state db: {health.stateDb?.supported ? "supported" : health.mode === "real" ? "unavailable" : "not connected"}</span>
      </footer>
    </div>
  );
}
