import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { realApiClient } from "../api/client";
import { Panel } from "../components/Panel";
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
    <section className="view-stack" aria-labelledby="diagnostics-title">
      <div className="view-heading">
        <p className="view-heading__eyebrow">Local runtime logs</p>
        <h1 id="diagnostics-title">Diagnostics</h1>
      </div>

      {warnings.length > 0 ? (
        <div className="inline-alert" role="alert">
          {warnings.join(" ")}
        </div>
      ) : null}

      <Panel eyebrow="Structured diagnostics" title="Log filters">
        <form className="diagnostics-toolbar" aria-label="Diagnostics filters" onSubmit={applyFilters}>
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

        {summary ? (
          <div className="metric-row" aria-label="Diagnostics summary">
            <div className="metric">
              <span>Warnings</span>
              <strong>{summary.warningCounts.total}</strong>
            </div>
            <div className="metric">
              <span>Failed commands</span>
              <strong>{summary.failedCommands.reduce((total, command) => total + command.count, 0)}</strong>
            </div>
          </div>
        ) : null}

        {summary?.loudestTargets.length ? (
          <section className="diagnostics-targets" aria-label="Loudest targets">
            {summary.loudestTargets.map((target) => (
              <a
                href="#diagnostics-logs"
                key={target.target}
                onClick={(event) => {
                  event.preventDefault();
                  applyTargetFilter(target.target);
                }}
              >
                {target.target} {target.warningCount} warnings {target.errorCount} errors
              </a>
            ))}
          </section>
        ) : null}

        <div className="table-frame" id="diagnostics-logs">
          <table aria-label="Diagnostics logs">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Target</th>
                <th scope="col">Thread</th>
                <th scope="col">Scope</th>
                <th scope="col">Preview</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.level}</td>
                  <td>{log.target}</td>
                  <td>
                    <span>{log.threadId ?? "-"}</span>
                    <span className="diagnostics-source">observed logs</span>
                  </td>
                  <td>{log.scope ?? "-"}</td>
                  <td>{log.bodyPreview}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel eyebrow="Command failures" title="Failed commands">
        <section className="failed-command-list">
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
      </Panel>

      <Panel eyebrow="Advanced" title="Raw log access">
        {!rawVisible ? (
          <button className="diagnostics-action" type="button" onClick={revealRawTail}>
            Show advanced raw TUI log
          </button>
        ) : (
          <section className="raw-tail" aria-label="Raw TUI log">
            {rawError ? (
              <div className="inline-alert" role="alert">
                {rawError.message}
              </div>
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
      </Panel>
    </section>
  );
}
