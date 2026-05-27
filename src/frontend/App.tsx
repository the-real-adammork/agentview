import { useEffect, useMemo, useState } from "react";

import { createFixtureSnapshot, realApiClient } from "./api/client";
import { Chrome } from "./components/Chrome";
import { SegBar } from "./components/SegBar";
import { AgentGraphView } from "./views/AgentGraphView";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { SessionsView } from "./views/SessionsView";
import { TimelineView } from "./views/TimelineView";
import { TokensView } from "./views/TokensView";
import type { ApiError, HealthStatus, SessionFilter, SessionSummary } from "../shared/contracts";

const stylesheetHref = new URL("./styles/app.css", import.meta.url).href;

const views = ["Sessions", "Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

export type ObservatoryView = (typeof views)[number];

export function App() {
  const fixture = useMemo(() => createFixtureSnapshot(), []);
  const [activeView, setActiveView] = useState<ObservatoryView>("Sessions");
  const [health, setHealth] = useState<HealthStatus>(fixture.health);
  const [sessions, setSessions] = useState<SessionSummary[]>(fixture.sessions);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>({ archived: "include" });
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<ApiError | null>(null);
  const [activeSessionId, setActiveSessionId] = useState(fixture.sessions[0]?.id ?? "");

  useEffect(() => {
    let cancelled = false;

    realApiClient.getHealth().then((result) => {
      if (!cancelled && result.ok) {
        setHealth(result.data);
      }
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setSessionsLoading(true);
    setSessionsError(null);
    realApiClient
      .listSessions(sessionFilter, { limit: 100, offset: 0 })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (result.ok) {
          setSessions(result.data);
          setActiveSessionId((current) => result.data.find((session) => session.id === current)?.id ?? result.data[0]?.id ?? "");
        } else {
          setSessionsError(result.error);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSessionsError({
            code: "NETWORK_ERROR",
            message: error instanceof Error ? error.message : "Unable to load sessions.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSessionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionFilter]);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? fixture.sessions[0];

  return (
    <>
      <link rel="stylesheet" href={stylesheetHref} />
      <Chrome health={health} sessionCount={sessions.length}>
        <SegBar views={views} activeView={activeView} onChange={setActiveView} />
        <main className="app-shell__main" aria-label="Observatory workspace">
          {activeView === "Sessions" ? (
            <SessionsView
              sessions={sessions}
              filter={sessionFilter}
              isLoading={sessionsLoading}
              error={sessionsError}
              activeSessionId={activeSessionId}
              onFilterChange={setSessionFilter}
              onSelectSession={setActiveSessionId}
            />
          ) : null}
          {activeView === "Timeline" ? (
            <TimelineView events={fixture.timelineEvents} activeSession={activeSession} />
          ) : null}
          {activeView === "Agent Graph" ? <AgentGraphView graph={fixture.agentGraph} /> : null}
          {activeView === "Tokens" ? <TokensView series={fixture.tokenSeries} /> : null}
          {activeView === "Diagnostics" ? <DiagnosticsView logs={fixture.diagnosticsLogs} /> : null}
        </main>
      </Chrome>
    </>
  );
}
