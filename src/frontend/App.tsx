import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createFixtureSnapshot, realApiClient } from "./api/client";
import { openLiveStream } from "./api/liveStream";
import { isDemoEnabled, useDemoInserts } from "./live/demoInserts";
import { createLiveTokenStore } from "./live/liveTokenStore";
import { LiveTokenStoreContext } from "./live/LiveTokens";
import { Chrome } from "./components/Chrome";
import { SegBar } from "./components/SegBar";
import { usePalette } from "./usePalette";
import { AgentGraphView } from "./views/AgentGraphView";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { ReposView } from "./views/ReposView";
import { SessionsView } from "./views/SessionsView";
import { TimelineView } from "./views/TimelineView";
import { TokensView } from "./views/TokensView";
import { indexSessions, isDescendantOf, rootOf, sessionRepoName } from "./views/sessionTree";
import { buildPath, parseLocation } from "./routing";
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

// Primary tab set (renumbered 00–03). "Sessions" merged into the header session
// square; "Repos" is reachable from the header REPOS button. Neither is a tab.
const navViews = ["Timeline", "Agent Graph", "Tokens", "Diagnostics"] as const;

export type ObservatoryView = (typeof navViews)[number] | "Repos" | "Sessions";

export function App() {
  const fixture = useMemo(() => createFixtureSnapshot(), []);
  const liveTokenStore = useMemo(() => createLiveTokenStore(), []);
  const [palette, setPalette] = usePalette();
  const [activeView, setActiveView] = useState<ObservatoryView>(() => parseLocation(window.location).view);
  const [health, setHealth] = useState<HealthStatus>(fixture.health);
  const [sessions, setSessions] = useState<SessionSummary[]>(fixture.sessions);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>(() => {
    const route = parseLocation(window.location);
    return { archived: route.archived ?? "exclude", search: route.search || undefined };
  });
  const [repoFilter, setRepoFilter] = useState<string | null>(() => parseLocation(window.location).repo);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<ApiError | null>(null);
  const [activeSessionId, setActiveSessionId] = useState(() => parseLocation(window.location).sessionId ?? fixture.sessions[0]?.id ?? "");
  // A deep-linked session may not be in the (filtered/paginated) list; fetch it on
  // its own so the header/metadata resolve even when it's absent from `sessions`.
  const [overrideSession, setOverrideSession] = useState<SessionSummary | undefined>();
  const [timelinePayload, setTimelinePayload] = useState<TimelinePayload | undefined>();
  // Byte offset the initial timeline load reached; the live stream tails from here
  // so no events are missed in the fetch→connect window. The seq bumps only on an
  // initial load (not on appends), so the stream reconnects exactly once per load.
  const liveBaselineRef = useRef<{ threadId: string; nextByteOffset: number } | null>(null);
  const [liveBaselineSeq, setLiveBaselineSeq] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<ApiError | null>(null);
  const [timelineKind, setTimelineKind] = useState(() => parseLocation(window.location).kind);
  // Timeline event scope: "this" (active thread only) or "all" (+SUBS — merge the
  // descendant agents' events). subEvents holds the fetched descendant streams.
  const [timelineScope, setTimelineScope] = useState<"this" | "all">(() => parseLocation(window.location).scope);
  const [subtreeLoading, setSubtreeLoading] = useState(false);
  const [agentGraph, setAgentGraph] = useState<AgentGraph | undefined>(fixture.agentGraph);
  const [agentGraphLoading, setAgentGraphLoading] = useState(false);
  const [agentGraphError, setAgentGraphError] = useState<ApiError | null>(null);
  const [graphMaxDepth, setGraphMaxDepth] = useState(2);
  const [tokenSeries, setTokenSeries] = useState<TokenSeries | undefined>(fixture.tokenSeries);
  const [tokenSeriesLoading, setTokenSeriesLoading] = useState(false);
  const [tokenSeriesError, setTokenSeriesError] = useState<ApiError | null>(null);
  const [sessionDiagnostics, setSessionDiagnostics] = useState<Record<string, DiagnosticsSummary["sessionsWarningBadges"][number]>>({});

  // Stable key over the session *set* so this badge fetch doesn't re-fire on every
  // SSE token tick (which mutates `sessions` constantly) — only when ids change.
  const sessionIdsKey = useMemo(
    () => sessions.map((session) => session.id).sort().join(","),
    [sessions],
  );

  useEffect(() => {
    let cancelled = false;

    if (!realApiClient.getDiagnosticsSummary || sessionIdsKey === "") {
      setSessionDiagnostics({});
      return () => undefined;
    }

    const timeout = setTimeout(() => {
      void realApiClient
        // List badges only need cheap logs_2 warning counts — skip the per-thread
        // rollout parse (that detail lives in the Diagnostics view, on demand).
        .getDiagnosticsSummary?.({ threadIds: sessionIdsKey.split(","), targetLimit: 1, includeFailedCommands: false })
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
  }, [sessionIdsKey]);

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
          liveTokenStore.setSessions(result.data);
          setActiveSessionId((current) => {
          if (result.data.find((session) => session.id === current)) return current;
          // Keep a deep-linked session even when it's not in the freshly filtered
          // list (archived / different page); the override fetch supplies its
          // metadata. Otherwise (a stale default or a filtered-out row) fall back
          // to the first visible row.
          if (current && current === parseLocation(window.location).sessionId) return current;
          return result.data[0]?.id ?? "";
        });
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
  }, [sessionFilter, liveTokenStore]);


  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? overrideSession ?? sessions[0] ?? fixture.sessions[0];
  const warningSessionCount = sessions.filter(
    (session) => (session.warningCount ?? 0) > 0 || (session.failedToolCount ?? 0) > 0 || session.openChildCount > 0,
  ).length;
  const tokenTotal = sessions.reduce((total, session) => total + (session.tokensUsed ?? session.tokenTotal), 0);
  const topTokenSessions = useMemo(
    () => [...sessions].sort((left, right) => (right.tokensUsed ?? right.tokenTotal) - (left.tokensUsed ?? left.tokenTotal)),
    [sessions],
  );

  // Repo shown in the header button: the explicitly-selected repo if set,
  // otherwise the repo of whatever session is selected (sub-agents inherit the
  // root's repo). Always informative — only the Repos browser shows plain REPOS.
  const headerRepo = useMemo(() => {
    if (repoFilter) {
      return repoFilter;
    }
    if (!activeSession) {
      return null;
    }
    return sessionRepoName(rootOf(activeSession, indexSessions(sessions)));
  }, [repoFilter, activeSession, sessions]);

  const selectSession = useCallback((sessionId: string, view?: ObservatoryView) => {
    setActiveSessionId(sessionId);
    if (view) {
      setActiveView(view);
    }
  }, []);

  // Header REPOS button + dossier "all repos" back link land on the full index.
  const openReposIndex = useCallback(() => {
    setRepoFilter(null);
    setActiveView("Repos");
  }, []);

  // Opening a repo card scopes the Sessions catalog to that repo (dossier mode).
  const openRepo = useCallback((repoName: string) => {
    setRepoFilter(repoName);
    setActiveView("Sessions");
  }, []);

  // Header session square opens the Sessions list (in whatever repo context is active).
  const openSessions = useCallback(() => {
    setActiveView("Sessions");
  }, []);

  // Whether the active thread has descendants — a stable boolean so loadTimeline's
  // identity doesn't change on every SSE session tick (which would re-fire the load
  // effect in a loop and leave the stream stuck "Streaming timeline…").
  const activeHasDescendants = useMemo(() => {
    if (!activeSession?.id) return false;
    const index = indexSessions(sessions);
    return sessions.some((session) => isDescendantOf(session, activeSession.id, index));
  }, [sessions, activeSession?.id]);

  const loadTimeline = useCallback((fromByte?: number) => {
    if (!activeSessionId) return;

    setTimelineLoading(true);
    setTimelineError(null);
    // First paint is the active thread alone — one small rollout, fast even for a
    // huge live orchestrator. +SUBS lazily pulls the server-merged subtree (still
    // ONE server call — the merge is server-side, not a client fan-out).
    realApiClient
      .getTimeline(activeSessionId, fromByte === undefined ? undefined : { fromByte })
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
          if (fromByte === undefined) {
            // Record the byte offset the initial load reached and signal the live
            // stream to (re)connect tailing from exactly here — so events appended
            // between this fetch and the SSE connecting aren't missed.
            liveBaselineRef.current = { threadId: result.data.threadId, nextByteOffset: result.data.nextByteOffset };
            setLiveBaselineSeq((seq) => seq + 1);
          }
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
  }, [activeSessionId]);

  useEffect(() => {
    if (activeView !== "Timeline") return;
    loadTimeline();
  }, [activeView, activeSessionId, loadTimeline]);

  // ── URL ⇄ state: deep-linkable repo / session / view / filters ──────────────
  // State → URL: push on navigations (path changes) so Back works; replace on
  // filter edits (only the query changes) so typing doesn't flood history.
  useEffect(() => {
    const url = buildPath({
      view: activeView,
      repo: repoFilter,
      sessionId: activeSessionId || null,
      search: sessionFilter.search ?? "",
      archived: sessionFilter.archived,
      scope: timelineScope,
      kind: timelineKind,
    });
    const current = window.location.pathname + window.location.search;
    if (url === current) return;
    const pathnameChanged = url.split("?")[0] !== window.location.pathname;
    window.history[pathnameChanged ? "pushState" : "replaceState"](null, "", url);
  }, [activeView, repoFilter, activeSessionId, sessionFilter.search, sessionFilter.archived, timelineScope, timelineKind]);

  // URL → state on Back/Forward (popstate). The push effect above no-ops because
  // buildPath(state) now equals the already-current URL, so there's no loop.
  useEffect(() => {
    const onPopState = () => {
      const route = parseLocation(window.location);
      setActiveView(route.view);
      setRepoFilter(route.repo);
      if (route.sessionId) setActiveSessionId(route.sessionId);
      setTimelineScope(route.scope);
      setTimelineKind(route.kind);
      setSessionFilter((current) => ({ ...current, search: route.search || undefined, archived: route.archived ?? "exclude" }));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Resolve a deep-linked session that isn't in the current list so its metadata
  // (repo/title/header) is available; cleared once it appears in `sessions`.
  useEffect(() => {
    if (!activeSessionId || sessions.some((session) => session.id === activeSessionId)) {
      setOverrideSession(undefined);
      return;
    }
    if (overrideSession?.id === activeSessionId || !realApiClient.getThread) return;
    let cancelled = false;
    realApiClient
      .getThread(activeSessionId)
      .then((result) => {
        if (!cancelled && result.ok) setOverrideSession(result.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, sessionIdsKey]);

  // +SUBS pulls the server-merged spawn subtree once per session (one server call;
  // the merge is server-side). It swaps into the payload so rows expand in place;
  // "this" then filters that stream back down to the active thread.
  const subtreeSessionRef = useRef<string | null>(null);
  const loadSubtree = useCallback(() => {
    if (!activeSession?.id || !activeHasDescendants || subtreeSessionRef.current === activeSession.id) return;
    const sessionId = activeSession.id;
    setSubtreeLoading(true);
    realApiClient
      .getTimeline(sessionId, { subtree: true })
      .then((result) => {
        if (result.ok) {
          subtreeSessionRef.current = sessionId;
          setTimelinePayload((current) =>
            current && current.threadId === sessionId ? { ...current, events: result.data.events } : result.data,
          );
        }
      })
      .catch(() => {
        /* +SUBS is best-effort; the single-thread stream stays visible. */
      })
      .finally(() => setSubtreeLoading(false));
  }, [activeSession?.id, activeHasDescendants]);

  const handleScopeChange = useCallback(
    (next: "this" | "all") => {
      setTimelineScope(next);
      if (next === "all") loadSubtree();
    },
    [loadSubtree],
  );

  // Scope resets to single-thread when the session changes; the subtree re-merges
  // lazily the next time +SUBS is opened for that session.
  useEffect(() => {
    setTimelineScope("this");
    subtreeSessionRef.current = null;
  }, [activeSession?.id]);

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

  // Dev-only demo mode (?demo): synthesises live inserts so the feed-enter
  // animation is visible against otherwise-static local data. It owns the state
  // while on, so the real SSE stream stands down to avoid clobbering injected rows.
  const demoEnabled = useMemo(() => isDemoEnabled(), []);
  useDemoInserts({ enabled: demoEnabled, setSessions, setTimelinePayload });

  // Live updates: initial paint stays the fetch path above; the SSE stream applies deltas
  // through the same state setters. Never load-bearing — VITE_AGENTVIEW_LIVE=0 disables it.
  const liveEnabled = !demoEnabled && (import.meta.env.VITE_AGENTVIEW_LIVE ?? "1") !== "0";
  const liveThreadId = activeSession?.id ?? null;

  useEffect(() => {
    if (!liveEnabled) return undefined;

    const handle = openLiveStream({
      threadId: liveThreadId,
      // Tail from exactly where the initial load stopped (closes the fetch→connect
      // gap). Falls back to null (current EOF) until that load has happened.
      fromByte:
        liveBaselineRef.current && liveBaselineRef.current.threadId === liveThreadId
          ? liveBaselineRef.current.nextByteOffset
          : null,
      logCursorId: null,
      callbacks: {
        onSessions: ({ sessions: nextSessions }) => {
          setSessions(nextSessions);
          // Live token leaves read from the external store; SSE is the single
          // live source, so feed it here (the standalone poll is gone).
          liveTokenStore.setSessions(nextSessions);
          setActiveSessionId(
            (current) => nextSessions.find((session) => session.id === current)?.id ?? nextSessions[0]?.id ?? "",
          );
        },
        onTimeline: (payload) => {
          if (payload.threadId !== liveThreadId) return;
          setTimelinePayload((current) => {
            if (!current) return current; // initial fetch owns first paint
            return payload.reset
              ? { ...current, events: payload.events, nextByteOffset: payload.nextByteOffset }
              : { ...current, nextByteOffset: payload.nextByteOffset, events: [...current.events, ...payload.events] };
          });
        },
        onTokens: (payload) => {
          if (payload.threadId === liveThreadId) setTokenSeries(payload.series);
        },
        onDiagnostics: ({ summary }) => {
          setSessionDiagnostics(
            Object.fromEntries(summary.sessionsWarningBadges.map((badge) => [badge.threadId, badge])),
          );
        },
        onReady: () => undefined,
        onError: () => undefined,
      },
    });

    return () => handle.close();
    // Reopen when the followed session changes OR once its initial load sets the
    // tail baseline (liveBaselineSeq) — appends don't bump the seq, so no reconnect storm.
  }, [liveThreadId, liveEnabled, liveTokenStore, liveBaselineSeq]);

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
    <LiveTokenStoreContext.Provider value={liveTokenStore}>
      <link rel="stylesheet" href={stylesheetHref} />
      <Chrome
        activeView={activeView}
        health={health}
        navigation={<SegBar views={navViews} activeView={activeView} onChange={setActiveView} />}
        palette={palette}
        onPaletteChange={setPalette}
        onOpenRepos={openReposIndex}
        onOpenSessions={openSessions}
        reposActive={activeView === "Repos"}
        sessionsActive={activeView === "Sessions"}
        headerRepo={headerRepo}
        activeSession={activeSession}
        sessions={sessions}
        sessionCount={sessions.length}
        tokenTotal={tokenTotal}
        warningSessionCount={warningSessionCount}
      >
        <main className="app-shell__main" aria-label="Observatory workspace">
          {activeView === "Repos" ? (
            <ReposView
              sessions={sessions}
              isLoading={sessionsLoading}
              onOpenRepo={openRepo}
              onSelectSession={(sessionId) => selectSession(sessionId, "Timeline")}
            />
          ) : null}
          {activeView === "Sessions" ? (
            <SessionsView
              sessions={sessions}
              filter={sessionFilter}
              repoFilter={repoFilter}
              isLoading={sessionsLoading}
              error={sessionsError}
              activeSessionId={activeSessionId}
              diagnosticsByThreadId={sessionDiagnostics}
              onFilterChange={setSessionFilter}
              onClearRepoFilter={openReposIndex}
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
              scope={timelineScope}
              subtreeLoading={subtreeLoading}
              onScopeChange={handleScopeChange}
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
    </LiveTokenStoreContext.Provider>
  );
}
