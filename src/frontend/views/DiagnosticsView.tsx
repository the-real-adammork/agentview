import { Panel } from "../components/Panel";
import type { RuntimeLog } from "../../shared/contracts";

interface DiagnosticsViewProps {
  logs: RuntimeLog[];
}

export function DiagnosticsView({ logs }: DiagnosticsViewProps) {
  return (
    <Panel eyebrow="Fixture runtime logs" title="Diagnostics">
      <div className="table-frame">
        <table aria-label="Diagnostics logs">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Target</th>
              <th scope="col">Preview</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.level}</td>
                <td>{log.target}</td>
                <td>{log.bodyPreview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
