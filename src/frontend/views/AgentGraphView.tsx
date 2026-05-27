import { useState } from "react";

import { Panel } from "../components/Panel";
import { AgentNodeCard } from "../components/AgentNodeCard";
import type { AgentGraph, AgentNode, ApiError, SessionSummary } from "../../shared/contracts";

const numberFormatter = new Intl.NumberFormat("en-US");

interface AgentGraphViewProps {
  activeSession?: SessionSummary;
  graph?: AgentGraph;
  isLoading: boolean;
  error: ApiError | null;
  maxDepth: number;
  onMaxDepthChange(depth: number): void;
  onRefresh(): void;
  onSelectSession(sessionId: string, view: "Timeline"): void;
}

const statusSummaryText = (graph: AgentGraph) =>
  `${graph.statusSummary.open} open / ${graph.statusSummary.closed} closed / ${graph.statusSummary.failed ?? 0} failed`;

const formatTimestamp = (value?: string) => (value ? new Date(value).toLocaleString("en-US") : "n/a");

export function AgentGraphView({
  activeSession,
  error,
  graph,
  isLoading,
  maxDepth,
  onMaxDepthChange,
  onRefresh,
  onSelectSession,
}: AgentGraphViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) ?? graph?.root;
  const selectTimeline = (node: AgentNode) => onSelectSession(node.id, "Timeline");

  return (
    <Panel eyebrow={activeSession?.title ?? "Selected session"} title="Agent Graph">
      <div className="graph-toolbar">
        <label className="field field--compact">
          <span>Depth</span>
          <input
            aria-label="Graph depth"
            max={10}
            min={0}
            type="number"
            value={maxDepth}
            onChange={(event) => {
              onMaxDepthChange(Number.parseInt(event.target.value || "0", 10));
              onRefresh();
            }}
          />
        </label>
        <button type="button" onClick={onRefresh}>
          Refresh graph
        </button>
      </div>
      {error ? <div className="inline-alert" role="alert">{error.message}</div> : null}
      {isLoading ? <div role="status">Loading graph</div> : null}
      {!graph ? <div className="empty-state">No graph loaded.</div> : null}
      {graph ? (
        <>
          <div className="metric-row">
            <div className="metric">
              <span>Open children {graph.openCount}</span>
              <strong>{graph.openCount}</strong>
            </div>
            <div className="metric">
              <span>Max depth</span>
              <strong>{graph.maxDepth}</strong>
            </div>
            <div className="metric">
              <span>Status summary</span>
              <strong>{statusSummaryText(graph)}</strong>
            </div>
          </div>
          {graph.truncatedDepth ? (
            <div className="inline-alert">Depth limit reached; increase graph depth to expand descendants.</div>
          ) : null}
          <div className="graph-layout">
            <ul className="node-list" aria-label="Agent graph nodes">
              {graph.nodes.map((node) => (
                <li className="node-list__item" key={node.id}>
                  <AgentNodeCard
                    node={node}
                    selected={selectedNode?.id === node.id}
                    onSelect={() => setSelectedNodeId(node.id)}
                    onOpenTimeline={() => selectTimeline(node)}
                  />
                </li>
              ))}
            </ul>
            <aside className="graph-inspector" aria-label="Selected graph node">
              {selectedNode ? (
                <>
                  <span className="node-list__depth">depth {selectedNode.depth}</span>
                  <strong>{selectedNode.title}</strong>
                  <span>status {selectedNode.status}</span>
                  {selectedNode.sourceEdgeStatus ? <span>edge {selectedNode.sourceEdgeStatus}</span> : null}
                  <span>{numberFormatter.format(selectedNode.tokenTotal)} tokens</span>
                  <span>Thread ID {selectedNode.id}</span>
                  <span>Created {formatTimestamp(selectedNode.createdAt)}</span>
                  <span>Updated {formatTimestamp(selectedNode.updatedAt)}</span>
                  {selectedNode.nickname ? <span>{selectedNode.nickname}</span> : null}
                  {selectedNode.role ? <span>{selectedNode.role}</span> : null}
                  {selectedNode.finalReportPreview ? <p>{selectedNode.finalReportPreview}</p> : null}
                  <button type="button" onClick={() => selectTimeline(selectedNode)}>
                    Open selected in Timeline
                  </button>
                </>
              ) : null}
            </aside>
          </div>
        </>
      ) : null}
    </Panel>
  );
}
