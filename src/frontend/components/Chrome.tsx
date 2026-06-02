import type { ReactNode } from "react";

import type { HealthStatus, SessionSummary } from "../../shared/contracts";
import type { ObservatoryView } from "../App";
import { LiveTokenTotal } from "../live/LiveTokens";
import type { UiKit } from "../useUiKit";
import { PaletteSwitcher, type Palette } from "./PaletteSwitcher";
import { SessionSquare } from "./SessionSquare";

interface ChromeProps {
  children: ReactNode;
  activeView: ObservatoryView;
  health: HealthStatus;
  navigation: ReactNode;
  palette: Palette;
  uiKit?: UiKit;
  onPaletteChange: (palette: Palette) => void;
  onOpenRepos: () => void;
  onOpenSessions: () => void;
  reposActive: boolean;
  sessionsActive: boolean;
  /** Repo name shown in the REPOS button (selected repo, or the active session's repo). */
  headerRepo: string | null;
  activeSession: SessionSummary | undefined;
  sessions: SessionSummary[];
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

export function Chrome({
  activeView,
  children,
  health,
  navigation,
  palette,
  uiKit = "agentview",
  onPaletteChange,
  onOpenRepos,
  onOpenSessions,
  reposActive,
  sessionsActive,
  headerRepo,
  activeSession,
  sessions,
  sessionCount,
  tokenTotal,
  warningSessionCount,
}: ChromeProps) {
  const source = health.mode === "real" ? "state-db" : "fixture";
  // The REPOS button shows the current repo's name unless the Repos browser
  // itself is open (then it's the plain "REPOS" label). The selection rail runs
  // under REPOS + the session square whenever we're not in the Repos browser.
  const showRepoName = !reposActive && Boolean(headerRepo);
  const railStart = !reposActive;
  const repoLeaf = headerRepo ? headerRepo.split("/").pop() ?? headerRepo : null;
  const clock = formatClock(health.checkedAt);
  const tickerItems = [
    `PATTERN: CODEX OPS - NORMAL · SOURCE: ${source} · SESSIONS: ${sessionCount} · WARN: ${warningSessionCount}`,
    "logs_2 ingest queue - 0 / capacity 1024",
    "rate_limit - primary 31% - secondary 18%",
    "MEMORY MODE - enabled",
  ];

  return (
    <div
      className="app-shell shell"
      data-palette={palette}
      data-screen-label={`Observatory · ${activeView}`}
      data-ui-kit={uiKit}
    >
      <div className="plate" aria-hidden="true" />
      <div className="grid-bg" aria-hidden="true" />

      <header className="top-hazard" aria-label="Observatory status">
        <div className="hazard" aria-hidden="true" />
        <div className="center">
          <span className="hazard-strip__sys">SYS:</span>
          <span>OBSERVATORY · 観測装置</span>
          <span className="jp">機密 / レベル 7</span>
          <span className="blink">● LIVE</span>
          <PaletteSwitcher palette={palette} onChange={onPaletteChange} />
        </div>
        <div className="hazard" aria-hidden="true" />
        <span className="sr-only">
          <span>{health.mode} mode</span>
          <span>{health.status === "ok" ? "healthy" : "unavailable"}</span>
        </span>
      </header>

      <div className="header">
        <button
          className="repos-btn"
          type="button"
          data-active={reposActive ? "true" : "false"}
          data-has-repo={showRepoName ? "true" : "false"}
          data-rail={railStart ? "on" : undefined}
          aria-pressed={reposActive}
          aria-label={showRepoName && repoLeaf ? `Repos browser — current repo ${repoLeaf}` : "Repos browser"}
          onClick={onOpenRepos}
          title={headerRepo ? `Repo: ${headerRepo} — click to browse all repos` : "Browse all repos"}
        >
          <span className="mark" aria-hidden="true" />
          {showRepoName && repoLeaf ? (
            <span className="repos-id">
              <span className="repos-kicker">▸ REPO</span>
              <span className="repos-name">{repoLeaf}</span>
            </span>
          ) : (
            <span className="lbl">REPOS</span>
          )}
          <span className="caret" aria-hidden="true">▸</span>
        </button>

        <SessionSquare
          session={activeSession}
          sessions={sessions}
          active={sessionsActive}
          railStart={railStart}
          onClick={onOpenSessions}
        />

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
            <div className="v num"><LiveTokenTotal fallback={tokenTotal} /></div>
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
        <span className="ticker-wrap">
          <span className="ticker">
            {tickerItems.concat(tickerItems).map((item, index) => (
              <span key={`${item}-${index}`}>// {item} </span>
            ))}
          </span>
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
