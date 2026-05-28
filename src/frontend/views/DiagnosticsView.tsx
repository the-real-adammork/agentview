import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { realApiClient } from "../api/client";
import type {
  ApiError,
  DiagnosticsSummary,
  RawTuiLogTail,
  RuntimeLog,
  RuntimeLogLevel,
  RuntimeLogQuery,
  SessionSummary,
} from "../../shared/contracts";

interface DiagnosticsViewProps {
  logs: RuntimeLog[];
  sessions: SessionSummary[];
}

const levels: Array<RuntimeLogLevel | ""> = ["", "TRACE", "DEBUG", "INFO", "WARN", "ERROR"];

const formatLevelLabel = (level: RuntimeLogLevel | "") => (level ? level : "Any");
const formatLogTime = (timestampMs: number) =>
  new Date(timestampMs).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const shortThreadId = (threadId?: string) => (threadId ? `${threadId.slice(0, 8)}...` : "-");

export function DiagnosticsView({ logs: fallbackLogs, sessions }: DiagnosticsViewProps) {
  const [logs, setLogs] = useState<RuntimeLog[]>(fallbackLogs);
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null);
  const [summaryWarnings, setSummaryWarnings] = useState<string[]>([]);
  const [filterDraft, setFilterDraft] = useState<{ level: RuntimeLogLevel | ""; target: string; scope: string }>({
    level: "",
    target: "",
    scope: "",
  });
  const [activeFilter, setActiveFilter] = useState<RuntimeLogQuery>({ limit: 100 });
  const [logsError, setLogsError] = useState<ApiError | null>(null);
  const [summaryError, setSummaryError] = useState<ApiError | null>(null);
  const [rawError, setRawError] = useState<ApiError | null>(null);
  const [rawTail, setRawTail] = useState<RawTuiLogTail | null>(null);
  const [rawVisible, setRawVisible] = useState(false);
  const summaryRequestId = useRef(0);

  const threadIds = useMemo(() => sessions.map((session) => session.id), [sessions]);

  const loadLogs = useCallback(async (query: RuntimeLogQuery) => {
    setLogsError(null);
    try {
      const result = await realApiClient.queryLogs(query);
      if (result.ok) {
        setLogs(result.data.logs);
      } else {
        setLogs([]);
        setLogsError(result.error);
      }
    } catch (error) {
      setLogs([]);
      setLogsError({
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Unable to load diagnostics logs.",
      });
    }
  }, []);

  const loadSummary = useCallback(async () => {
    const requestId = summaryRequestId.current + 1;
    summaryRequestId.current = requestId;
    setSummaryError(null);
    if (!realApiClient.getDiagnosticsSummary) return;

    try {
      const result = await realApiClient.getDiagnosticsSummary({ threadIds, targetLimit: 5 });
      if (requestId !== summaryRequestId.current) {
        return;
      }
      if (result.ok) {
        setSummary(result.data);
        setSummaryWarnings(result.warnings);
      } else {
        setSummaryError(result.error);
      }
    } catch (error) {
      if (requestId !== summaryRequestId.current) {
        return;
      }
      setSummaryError({
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Unable to load diagnostics summary.",
      });
    }
  }, [threadIds]);

  const targetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const log of logs) {
      counts.set(log.target, (counts.get(log.target) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [logs]);

  const warningCountsByThread = useMemo(() => {
    const counts = new Map<string, number>();
    const source = summary?.warningCounts.byThreadId ?? {};
    for (const [threadId, count] of Object.entries(source)) {
      counts.set(threadId, count);
    }
    if (counts.size === 0) {
      for (const log of logs) {
        if (log.level === "WARN" && log.threadId) {
          counts.set(log.threadId, (counts.get(log.threadId) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [logs, summary]);

  useEffect(() => {
    void loadLogs(activeFilter);
  }, [activeFilter, loadLogs]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setActiveFilter({
      limit: 100,
      level: filterDraft.level || undefined,
      target: filterDraft.target.trim() || undefined,
      scope: filterDraft.scope.trim() || undefined,
    });
  };

  const applyTargetFilter = (target: string) => {
    const nextDraft = { ...filterDraft, target };
    const nextFilter = {
      limit: 100,
      level: nextDraft.level || undefined,
      target,
      scope: nextDraft.scope.trim() || undefined,
    };
    setFilterDraft(nextDraft);
    setActiveFilter(nextFilter);
  };

  const loadRawTail = async (fromByte = rawTail?.nextByteOffset ?? 0) => {
    setRawError(null);
    try {
      const result = await realApiClient.tailRawTuiLog?.({ fromByte, maxBytes: 16 * 1024 });
      if (!result) return;

      if (result.ok) {
        setRawTail((current) =>
          fromByte === 0 || !current
            ? result.data
            : {
                ...result.data,
                textPreview: `${current.textPreview}${result.data.textPreview}`,
                redactionApplied: current.redactionApplied || result.data.redactionApplied,
              },
        );
      } else {
        setRawError(result.error);
      }
    } catch (error) {
      setRawError({
        code: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : "Unable to load raw TUI log.",
      });
    }
  };

  const revealRawTail = () => {
    setRawVisible(true);
    void loadRawTail(0);
  };

  const warnings = [...summaryWarnings, ...(logsError ? [logsError.message] : []), ...(summaryError ? [summaryError.message] : [])];

  return (
    <section className="diag-view" aria-labelledby="diagnostics-title">
      {warnings.length > 0 ? (
        <div className="inline-alert diag-alert" role="alert">
          {warnings.join(" ")}
        </div>
      ) : null}

      <div className="diag">
        <aside className="diag-side">
          <div className="diag-side__head">
            <div className="kicker">Filter</div>
            <h1 id="diagnostics-title" className="display">
              Diagnostics
            </h1>
            <strong>LOG STREAM</strong>
            <span>logs_2.sqlite · {logs.length.toLocaleString("en-US")} rows</span>
          </div>

          <form className="diag-filter" aria-label="Diagnostics filters" onSubmit={applyFilters}>
            <label className="field">
              <span>Level</span>
              <select
                aria-label="Level"
                value={filterDraft.level}
                onChange={(event) =>
                  setFilterDraft((current) => ({ ...current, level: event.target.value as RuntimeLogLevel | "" }))
                }
              >
                {levels.map((level) => (
                  <option key={level || "any"} value={level}>
                    {formatLevelLabel(level)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Target</span>
              <input
                aria-label="Target"
                value={filterDraft.target}
                onChange={(event) => setFilterDraft((current) => ({ ...current, target: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Scope</span>
              <input
                aria-label="Scope"
                value={filterDraft.scope}
                onChange={(event) => setFilterDraft((current) => ({ ...current, scope: event.target.value }))}
              />
            </label>
            <button type="submit">Apply filters</button>
          </form>

          <section className="diag-filter" aria-label="Loudest targets">
            <div className="lbl">Target · top 10</div>
            {summary?.loudestTargets.length ? (
              summary.loudestTargets.map((target) => (
                <a
                  href="#diagnostics-logs"
                  key={target.target}
                  onClick={(event) => {
                    event.preventDefault();
                    applyTargetFilter(target.target);
                  }}
                >
                  <span>{target.target}</span>
                  <b>{target.warningCount} warnings {target.errorCount} errors</b>
                </a>
              ))
            ) : (
              <>
                <button type="button" onClick={() => applyTargetFilter("")}>
                  all targets
                </button>
                {targetCounts.slice(0, 10).map(([target, count]) => (
                  <button key={target} type="button" onClick={() => applyTargetFilter(target)}>
                    <span>{target}</span>
                    <b>{count}</b>
                  </button>
                ))}
              </>
            )}
          </section>

          <section className="diag-filter">
            <div className="lbl">Mode</div>
            <button type="button" className="diag-mode">
              <span className="warn-c blink">●</span> Tail · live
            </button>
          </section>
        </aside>

        <main className="diag-main">
          <div className="diag-stream-head">
            <span className="kicker">
              {activeFilter.level ?? "Any"} · {activeFilter.target ?? "all targets"}
            </span>
            <span className="spacer" />
            <span>{logs.length} rows</span>
            <span className="warn-c blink">● LIVE</span>
          </div>

          <div className="diag-log-frame" id="diagnostics-logs">
            <table aria-label="Diagnostics logs" className="diag-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Level</th>
                  <th scope="col">Target</th>
                  <th scope="col">Thread</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Preview</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr className={`log-row ${log.level}`} key={log.id}>
                    <td className="ts">{formatLogTime(log.timestampMs)}</td>
                    <td>
                      <span className={`lvl ${log.level}`} /> {log.level}
                    </td>
                    <td className="tgt">{log.target}</td>
                    <td>
                      <span>{log.threadId ?? "-"}</span>
                      <span className="diagnostics-source">observed logs</span>
                    </td>
                    <td>{log.scope ?? "-"}</td>
                    <td className="msg">
                      {log.bodyPreview}
                      {log.threadId ? <span className="muted"> · {shortThreadId(log.threadId)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.length === 0 ? <div className="diag-empty">-- no rows match filter --</div> : null}
          </div>
        </main>

        <aside className="diag-side right">
          <div className="diag-side__head">
            <div className="kicker">Health</div>
            <strong className="display">RUNTIME</strong>
          </div>

          <section className="diag-card" aria-label="Runtime summary">
            <div className="kicker">Warn count · current query</div>
            <div className="diag-mini-bars" aria-hidden="true">
              {["WARN", "ERROR", "INFO", "DEBUG", "TRACE"].map((level) => {
                const count = logs.filter((log) => log.level === level).length;
                const max = Math.max(1, logs.length);
                return <i key={level} style={{ blockSize: `${Math.max(6, (count / max) * 100)}%` }} />;
              })}
            </div>
          </section>

          <section className="diag-card" aria-label="Loudest threads">
            <div className="kicker">Loudest threads</div>
            {warningCountsByThread.slice(0, 5).map(([threadId, count]) => (
              <div className="diag-thread" key={threadId}>
                <span>{shortThreadId(threadId)}</span>
                <b>▲ {count}</b>
              </div>
            ))}
          </section>

          <section className="diag-card failed-command-list" aria-label="Failed commands">
            <div className="kicker">Failed commands</div>
            {summary?.failedCommands.length ? (
              summary.failedCommands.map((command) => (
                <article className="failed-command" key={`${command.threadId}-${command.toolName}-${command.command}`}>
                  <div>
                    <strong>{command.command}</strong>
                    <span>
                      {command.toolName} exit {command.exitCode} count {command.count} source{" "}
                      {command.source === "rollout-cache" ? "rollout cache" : "logs db"}
                    </span>
                  </div>
                  <p>{command.lastOutputPreview}</p>
                </article>
              ))
            ) : (
              <p className="empty-state">No failed commands found.</p>
            )}
          </section>

          <section className="diag-card">
            <div className="kicker">Raw fallback</div>
            {!rawVisible ? (
              <button className="diagnostics-action" type="button" onClick={revealRawTail}>
                Show advanced raw TUI log
              </button>
            ) : (
              <section className="raw-tail" aria-label="Raw TUI log">
                {rawError ? (
                  rawError.code === "RAW_TUI_LOG_MISSING" ? (
                    <p className="empty-state">
                      No raw TUI log on this host (~/.codex/log/codex-tui.log not found).
                    </p>
                  ) : (
                    <div className="inline-alert" role="alert">
                      {rawError.message}
                    </div>
                  )
                ) : null}
                <pre>{rawTail?.textPreview ?? ""}</pre>
                <div className="raw-tail__actions">
                  <span>Next offset {rawTail?.nextByteOffset ?? 0}</span>
                  <button type="button" onClick={() => void loadRawTail()}>
                    Load raw tail
                  </button>
                </div>
              </section>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
