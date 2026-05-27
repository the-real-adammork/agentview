import { ShortId } from "../components/ShortId";
import type { SessionSummary } from "../../shared/contracts";

interface SessionsViewProps {
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  sessions: SessionSummary[];
}

const numberFormatter = new Intl.NumberFormat("en-US");

export function SessionsView({ activeSessionId, onSelectSession, sessions }: SessionsViewProps) {
  return (
    <section className="view-stack" aria-labelledby="sessions-title">
      <div className="view-heading">
        <p className="view-heading__eyebrow">Fixture Sessions</p>
        <h1 id="sessions-title">Sessions</h1>
      </div>
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
            {sessions.map((session) => (
              <tr
                aria-selected={session.id === activeSessionId}
                className="session-row"
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                tabIndex={0}
              >
                <th scope="row">
                  <span className="session-title">{session.title}</span>
                  <ShortId value={session.id} />
                </th>
                <td>{session.status}</td>
                <td>{session.branch}</td>
                <td>{session.model}</td>
                <td className="numeric">{numberFormatter.format(session.tokenTotal)}</td>
                <td className="numeric">
                  {session.openChildCount}/{session.childCount}
                </td>
                <td>
                  <time dateTime={session.updatedAt}>{new Date(session.updatedAt).toLocaleTimeString("en-US")}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
