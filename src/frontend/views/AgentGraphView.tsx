import { Panel } from "../components/Panel";
import type { AgentGraph } from "../../shared/contracts";

const numberFormatter = new Intl.NumberFormat("en-US");

interface AgentGraphViewProps {
  graph: AgentGraph;
}

export function AgentGraphView({ graph }: AgentGraphViewProps) {
  return (
    <Panel eyebrow="Fixture hierarchy" title="Agent Graph">
      <div className="metric-row">
        <div className="metric">
          <span>Open children {graph.openCount}</span>
          <strong>{graph.openCount}</strong>
        </div>
        <div className="metric">
          <span>Max depth</span>
          <strong>{graph.maxDepth}</strong>
        </div>
      </div>
      <ul className="node-list" aria-label="Agent nodes">
        {graph.nodes.map((node) => (
          <li className="node-list__item" key={node.id}>
            <span className="node-list__depth">depth {node.depth}</span>
            <strong>{node.title}</strong>
            <span>
              {node.status} / {numberFormatter.format(node.tokenTotal)} tokens
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
