import { useMemo, useState } from "react";

import { createFixtureSnapshot } from "./api/client";
import { Chrome } from "./components/Chrome";
import { SegBar } from "./components/SegBar";
import { AgentGraphView } from "./views/AgentGraphView";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { SessionsView } from "./views/SessionsView";
import { TimelineView } from "./views/TimelineView";
import { TokensView } from "./views/TokensView";

const stylesheetHref = new URL("./styles/app.css", import.meta.url).href;

const views = ["Sessions", "Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

export type ObservatoryView = (typeof views)[number];

export function App() {
  const fixture = useMemo(() => createFixtureSnapshot(), []);
  const [activeView, setActiveView] = useState<ObservatoryView>("Sessions");
  const [activeSessionId, setActiveSessionId] = useState(fixture.sessions[0]?.id ?? "");

  const activeSession = fixture.sessions.find((session) => session.id === activeSessionId) ?? fixture.sessions[0];

  return (
    <>
      <link rel="stylesheet" href={stylesheetHref} />
      <Chrome health={fixture.health} sessionCount={fixture.sessions.length}>
        <SegBar views={views} activeView={activeView} onChange={setActiveView} />
        <main className="app-shell__main" aria-label="Observatory workspace">
          {activeView === "Sessions" ? (
            <SessionsView
              sessions={fixture.sessions}
              activeSessionId={activeSessionId}
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
