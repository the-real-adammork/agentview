import { useCallback, useEffect, useMemo, useState } from "react";

import { createFixtureSnapshot, realApiClient } from "./api/client";
import { Chrome } from "./components/Chrome";
import { SegBar } from "./components/SegBar";
import { AgentGraphView } from "./views/AgentGraphView";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { SessionsView } from "./views/SessionsView";
import { TimelineView } from "./views/TimelineView";
import { TokensView } from "./views/TokensView";
import type {
  AgentGraph,
  ApiError,
  DiagnosticsSummary,
  HealthStatus,
  SessionFilter,
  SessionSummary,
  TimelinePayload,
  TokenSeries,
} from "../shared/contracts";

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
  const [timelinePayload, setTimelinePayload] = useState<TimelinePayload | undefined>();
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<ApiError | null>(null);
  const [timelineKind, setTimelineKind] = useState("all");
  const [agentGraph, setAgentGraph] = useState<AgentGraph | undefined>(fixture.agentGraph);
  const [agentGraphLoading, setAgentGraphLoading] = useState(false);
  const [agentGraphError, setAgentGraphError] = useState<ApiError | null>(null);
  const [graphMaxDepth, setGraphMaxDepth] = useState(1);
  const [tokenSeries, setTokenSeries] = useState<TokenSeries | undefined>(fixture.tokenSeries);
  const [tokenSeriesLoading, setTokenSeriesLoading] = useState(false);
  const [tokenSeriesError, setTokenSeriesError] = useState<ApiError | null>(null);
  const [sessionDiagnostics, setSessionDiagnostics] = useState<Record<string, DiagnosticsSummary["sessionsWarningBadges"][number]>>({});

  useEffect(() => {
    let cancelled = false;

    if (!realApiClient.getDiagnosticsSummary || sessions.length === 0) {
      setSessionDiagnostics({});
      return () => undefined;
    }

    const timeout = setTimeout(() => {
      void realApiClient
        .getDiagnosticsSummary?.({ threadIds: sessions.map((session) => session.id), targetLimit: 1 })
        .then((result) => {
          if (cancelled || !result?.ok) {
            return;
          }

          setSessionDiagnostics(
            Object.fromEntries(result.data.sessionsWarningBadges.map((badge) => [badge.threadId, badge])),
          );
        })
        .catch(() => undefined);
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [sessions]);

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
      .listSessions(sessionFilter, { limit: 500, offset: 0 })
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
  const warningSessionCount = sessions.filter(
    (session) => (session.warningCount ?? 0) > 0 || (session.failedToolCount ?? 0) > 0 || session.openChildCount > 0,
  ).length;
  const tokenTotal = sessions.reduce((total, session) => total + (session.tokensUsed ?? session.tokenTotal), 0);
  const topTokenSessions = useMemo(
    () => [...sessions].sort((left, right) => (right.tokensUsed ?? right.tokenTotal) - (left.tokensUsed ?? left.tokenTotal)),
    [sessions],
  );

  const selectSession = useCallback((sessionId: string, view?: ObservatoryView) => {
    setActiveSessionId(sessionId);
    if (view) {
      setActiveView(view);
    }
  }, []);

  const loadTimeline = useCallback((fromByte?: number) => {
    if (!activeSession?.id) return;

    setTimelineLoading(true);
    setTimelineError(null);
    realApiClient
      .getTimeline(activeSession.id, fromByte === undefined ? undefined : { fromByte })
      .then((result) => {
        if (result.ok) {
          setTimelinePayload((current) =>
            fromByte === undefined
              ? result.data
              : {
                  ...result.data,
                  events: [...(current?.events ?? []), ...result.data.events],
                },
          );
        } else {
          setTimelineError(result.error);
        }
      })
      .catch((error: unknown) => {
        setTimelineError({
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Unable to load timeline.",
        });
      })
      .finally(() => setTimelineLoading(false));
  }, [activeSession?.id]);

  useEffect(() => {
    if (activeView !== "Timeline") return;
    loadTimeline();
  }, [activeView, activeSession?.id, loadTimeline]);

  const loadAgentGraph = useCallback(() => {
    if (!activeSession?.id) return;

    setAgentGraphLoading(true);
    setAgentGraphError(null);
    realApiClient
      .getAgentGraph(activeSession.id, { maxDepth: graphMaxDepth })
      .then((result) => {
        if (result.ok) {
          setAgentGraph(result.data);
        } else {
          setAgentGraphError(result.error);
        }
      })
      .catch((error: unknown) => {
        setAgentGraphError({
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Unable to load agent graph.",
        });
      })
      .finally(() => setAgentGraphLoading(false));
  }, [activeSession?.id, graphMaxDepth]);

  useEffect(() => {
    if (activeView !== "Agent Graph") return;
    loadAgentGraph();
  }, [activeView, activeSession?.id, graphMaxDepth, loadAgentGraph]);

  const loadTokenSeries = useCallback(() => {
    if (!activeSession?.id) return;

    setTokenSeriesLoading(true);
    setTokenSeriesError(null);
    realApiClient
      .getTokenSeries(activeSession.id)
      .then((result) => {
        if (result.ok) {
          setTokenSeries(result.data);
        } else {
          setTokenSeriesError(result.error);
        }
      })
      .catch((error: unknown) => {
        setTokenSeriesError({
          code: "NETWORK_ERROR",
          message: error instanceof Error ? error.message : "Unable to load token series.",
        });
      })
      .finally(() => setTokenSeriesLoading(false));
  }, [activeSession?.id]);

  useEffect(() => {
    if (activeView !== "Tokens") return;
    loadTokenSeries();
  }, [activeView, activeSession?.id, loadTokenSeries]);

  const fallbackTimeline: TimelinePayload = {
    threadId: activeSession?.id ?? "",
    events: fixture.timelineEvents.filter((event) => event.threadId === activeSession?.id),
    facts: {
      threadId: activeSession?.id ?? "",
      rolloutPath: "fixture://timeline",
      parserVersion: 1,
      sourceMtimeMs: 0,
      sourceSizeBytes: 0,
      parsedThroughByte: 0,
      events: fixture.timelineEvents.filter((event) => event.threadId === activeSession?.id),
      toolCalls: [],
      tokenSnapshots: [],
      turns: [],
      agentLaunches: [],
      agentWaits: [],
      summary: {
        eventCount: fixture.timelineEvents.filter((event) => event.threadId === activeSession?.id).length,
        turnCount: new Set(
          fixture.timelineEvents
            .filter((event) => event.threadId === activeSession?.id)
            .map((event) => event.turnId)
            .filter(Boolean),
        ).size,
        toolCallCount: 0,
        failedToolCallCount: 0,
        tokenSnapshotCount: 0,
        agentLaunchCount: fixture.timelineEvents.filter(
          (event) => event.threadId === activeSession?.id && event.kind === "agent_launch",
        ).length,
        agentWaitCount: fixture.timelineEvents.filter(
          (event) => event.threadId === activeSession?.id && event.kind === "agent_wait",
        ).length,
        warningCount: fixture.timelineEvents.filter(
          (event) => event.threadId === activeSession?.id && event.severity !== "info",
        ).length,
        parsedThroughByte: 0,
      },
      warnings: [],
    },
    nextByteOffset: 0,
    cacheStatus: "cold",
  };

  return (
    <>
      <link rel="stylesheet" href={stylesheetHref} />
      <Chrome
        activeView={activeView}
        health={health}
        navigation={<SegBar views={views} activeView={activeView} onChange={setActiveView} />}
        sessionCount={sessions.length}
        tokenTotal={tokenTotal}
        warningSessionCount={warningSessionCount}
      >
        <main className="app-shell__main" aria-label="Observatory workspace">
          {activeView === "Sessions" ? (
            <SessionsView
              sessions={sessions}
              filter={sessionFilter}
              isLoading={sessionsLoading}
              error={sessionsError}
              activeSessionId={activeSessionId}
              diagnosticsByThreadId={sessionDiagnostics}
              onFilterChange={setSessionFilter}
              onSelectSession={selectSession}
            />
          ) : null}
          {activeView === "Timeline" ? (
            <TimelineView
              payload={timelinePayload ?? fallbackTimeline}
              activeSession={activeSession}
              sessions={sessions}
              isLoading={timelineLoading}
              error={timelineError}
              activeKind={timelineKind}
              onKindChange={setTimelineKind}
              onRefresh={() => loadTimeline()}
              onSelectSession={selectSession}
              onOpenGraph={() => activeSession && selectSession(activeSession.id, "Agent Graph")}
              onTail={() => loadTimeline(timelinePayload?.nextByteOffset ?? 0)}
            />
          ) : null}
          {activeView === "Agent Graph" ? (
            <AgentGraphView
              activeSession={activeSession}
              error={agentGraphError}
              graph={agentGraph}
              isLoading={agentGraphLoading}
              maxDepth={graphMaxDepth}
              onMaxDepthChange={setGraphMaxDepth}
              onRefresh={loadAgentGraph}
              onSelectSession={selectSession}
            />
          ) : null}
          {activeView === "Tokens" ? (
            <TokensView
              activeSession={activeSession}
              error={tokenSeriesError}
              isLoading={tokenSeriesLoading}
              onRefresh={loadTokenSeries}
              onSelectSession={selectSession}
              series={tokenSeries}
              topSessions={topTokenSessions}
            />
          ) : null}
          {activeView === "Diagnostics" ? <DiagnosticsView logs={fixture.diagnosticsLogs} sessions={sessions} /> : null}
        </main>
      </Chrome>
    </>
  );
}
