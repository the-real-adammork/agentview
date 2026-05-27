import type { ReactNode } from "react";

import type { HealthStatus } from "../../shared/contracts";
import type { ObservatoryView } from "../App";

interface ChromeProps {
  children: ReactNode;
  activeView: ObservatoryView;
  health: HealthStatus;
  navigation: ReactNode;
  sessionCount: number;
  tokenTotal: number;
  warningSessionCount: number;
}

function formatClock(checkedAt: string) {
  return new Date(checkedAt).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

export function Chrome({
  activeView,
  children,
  health,
  navigation,
  sessionCount,
  tokenTotal,
  warningSessionCount,
}: ChromeProps) {
  const source = health.mode === "real" ? "state-db" : "fixture";
  const clock = formatClock(health.checkedAt);
  const tickerItems = [
    "PATTERN: CODEX OPS - NORMAL",
    `SOURCE: ${source}`,
    `SESSIONS: ${sessionCount}`,
    `WARN: ${warningSessionCount}`,
    "logs_2 ingest queue - 0 / capacity 1024",
    "rate_limit - primary 31% - secondary 18%",
    "MEMORY MODE - enabled",
  ];

  return (
    <div className="app-shell shell" data-palette="orange" data-screen-label={`Observatory · ${activeView}`}>
      <div className="plate" aria-hidden="true" />
      <div className="grid-bg" aria-hidden="true" />

      <header className="top-hazard" aria-label="Observatory status">
        <div className="hazard" aria-hidden="true" />
        <div className="center">
          <span className="hazard-strip__sys">SYS:</span>
          <span>OBSERVATORY · 観測装置</span>
          <span className="jp">機密 / レベル 7</span>
          <span className="blink">● LIVE</span>
        </div>
        <div className="hazard" aria-hidden="true" />
        <span className="sr-only">
          <span>{health.mode} mode</span>
          <span>{health.status === "ok" ? "healthy" : "unavailable"}</span>
        </span>
      </header>

      <div className="header">
        <div className="brand">
          <div className="mark" aria-hidden="true" />
          <div>
            <h1 className="name">WORKFLOWKIT</h1>
            <div className="sub">// Observatory · 観測</div>
          </div>
        </div>

        {navigation}

        <div className="right" aria-label="Observatory summary">
          <div className="stat">
            <div className="v num">{sessionCount}</div>
            <div className="l">Sessions</div>
          </div>
          <div className="stat">
            <div className="v num warn-c">{warningSessionCount}</div>
            <div className="l">w/ Warn</div>
          </div>
          <div className="stat">
            <div className="v num">{formatCompactNumber(tokenTotal)}</div>
            <div className="l">Tokens</div>
          </div>
          <div className="stat">
            <time className="v num cyan-c" dateTime={health.checkedAt}>{clock}</time>
            <div className="l">LOCAL</div>
          </div>
        </div>
      </div>

      {children}

      <footer className="status" role="status" aria-label="Transport status">
        <span className="seq">▸ {activeView.toUpperCase()}</span>
        <span className="ticker-wrap" aria-hidden="true">
          <span className="ticker">
            {tickerItems.concat(tickerItems).map((item, index) => (
              <span key={`${item}-${index}`}>// {item} </span>
            ))}
          </span>
        </span>
        <span className="status-bar__source">
          // PATTERN: CODEX OPS - NORMAL · source: {source} · {sessionCount} sessions
        </span>
        <span>$CODEX_HOME = ~/.codex</span>
        <span><span className="live">●</span> LINK {health.status === "ok" ? "OK" : "DOWN"}</span>
        <time className="num" dateTime={health.checkedAt}>{clock}</time>
      </footer>
      <div className="scanlines" aria-hidden="true" />
      <div className="crt-vignette" aria-hidden="true" />
    </div>
  );
}
