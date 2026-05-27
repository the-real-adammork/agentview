import { ShortId } from "../components/ShortId";
import type { ApiError, ArchivedFilter, SessionFilter, SessionSummary, ThreadSource } from "../../shared/contracts";

interface SessionsViewProps {
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  filter: SessionFilter;
  onFilterChange: (filter: SessionFilter) => void;
  sessions: SessionSummary[];
  isLoading: boolean;
  error: ApiError | null;
}

const numberFormatter = new Intl.NumberFormat("en-US");

const uniqueValues = (sessions: SessionSummary[], getValue: (session: SessionSummary) => string | null | undefined) =>
  Array.from(new Set(sessions.map(getValue).filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b),
  );

const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-US");

export function SessionsView({
  activeSessionId,
  onFilterChange,
  onSelectSession,
  filter,
  sessions,
  isLoading,
  error,
}: SessionsViewProps) {
  const roleOptions = uniqueValues(sessions, (session) => session.agentRole);
  const modelOptions = uniqueValues(sessions, (session) => session.model);
  const updateFilter = (patch: Partial<SessionFilter>) => onFilterChange({ ...filter, ...patch });

  return (
    <section className="view-stack" aria-labelledby="sessions-title">
      <div className="view-heading">
        <p className="view-heading__eyebrow">State DB Sessions</p>
        <h1 id="sessions-title">Sessions</h1>
      </div>
      <form className="sessions-toolbar" role="search" aria-label="Session filters">
        <label className="field field--wide">
          <span>Search</span>
          <input
            aria-label="Search sessions"
            type="search"
            value={filter.search ?? ""}
            onChange={(event) => updateFilter({ search: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Source</span>
          <select
            aria-label="Source"
            value={filter.threadSource ?? ""}
            onChange={(event) =>
              updateFilter({ threadSource: event.target.value ? (event.target.value as ThreadSource) : undefined })
            }
          >
            <option value="">Any</option>
            <option value="user">User</option>
            <option value="subagent">Subagent</option>
          </select>
        </label>
        <label className="field">
          <span>Role</span>
          <select
            aria-label="Role"
            value={filter.agentRole ?? ""}
            onChange={(event) => updateFilter({ agentRole: event.target.value || undefined })}
          >
            <option value="">Any</option>
            {roleOptions.map((role) => (
              <option value={role} key={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <select
            aria-label="Model"
            value={filter.model ?? ""}
            onChange={(event) => updateFilter({ model: event.target.value || undefined })}
          >
            <option value="">Any</option>
            {modelOptions.map((model) => (
              <option value={model} key={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Archived</span>
          <select
            aria-label="Archived"
            value={filter.archived ?? "include"}
            onChange={(event) => updateFilter({ archived: event.target.value as ArchivedFilter })}
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
            <option value="only">Only</option>
          </select>
        </label>
        <label className="field field--numeric">
          <span>Min tokens</span>
          <input
            aria-label="Minimum tokens"
            inputMode="numeric"
            min="0"
            type="number"
            value={filter.minTokens ?? ""}
            onChange={(event) =>
              updateFilter({ minTokens: event.target.value ? Number.parseInt(event.target.value, 10) : undefined })
            }
          />
        </label>
      </form>
      {error ? (
        <div className="inline-alert" role="alert">
          {error.message}
        </div>
      ) : null}
      <div className="table-frame">
        <table aria-label="Sessions">
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Status</th>
              <th scope="col">Branch</th>
              <th scope="col">Model</th>
              <th scope="col">Tokens</th>
              <th scope="col">Children</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && sessions.length === 0 ? (
              <tr>
                <td colSpan={7}>Loading sessions...</td>
              </tr>
            ) : null}
            {!isLoading && sessions.length === 0 ? (
              <tr>
                <td colSpan={7}>No sessions match the current filters.</td>
              </tr>
            ) : null}
            {sessions.map((session) => (
              <tr
                aria-current={session.id === activeSessionId ? "true" : undefined}
                className="session-row"
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                tabIndex={0}
              >
                <th scope="row">
                  <span className="session-title">{session.title}</span>
                  <ShortId value={session.id} />
                </th>
                <td className="badge-cell">{session.archived ? "archived" : session.status}</td>
                <td>{session.branch || session.gitBranch || "-"}</td>
                <td>{session.model || "-"}</td>
                <td className="numeric">{numberFormatter.format(session.tokensUsed ?? session.tokenTotal)}</td>
                <td className="numeric badge-cell">
                  {session.openChildCount}/{session.childCount}
                </td>
                <td>
                  <time dateTime={session.updatedAt}>{formatTime(session.updatedAt)}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
