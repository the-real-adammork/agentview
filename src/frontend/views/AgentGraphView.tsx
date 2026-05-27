import { useMemo, useState } from "react";

import { ShortId } from "../components/ShortId";
import type { AgentGraph, AgentNode, ApiError, SessionSummary } from "../../shared/contracts";

const compactFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

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

const nodeRole = (node: AgentNode, rootId?: string) => {
  if (node.id === rootId || node.depth === 0) {
    return "ROOT · USER";
  }

  return `${node.role?.toUpperCase() ?? "AGENT"} · DEPTH ${node.depth}`;
};

const nodeCallsign = (node: AgentNode) => node.nickname ?? (node.depth === 0 ? "ADAM" : "AGENT");

const childCountFor = (graph: AgentGraph, nodeId: string) => graph.edges.filter((edge) => edge.parentId === nodeId).length;

const openChildCountFor = (graph: AgentGraph, nodeId: string) =>
  graph.edges.filter((edge) => edge.parentId === nodeId && edge.status === "open").length;

const parentFor = (graph: AgentGraph, nodeId: string) =>
  graph.edges.find((edge) => edge.childId === nodeId)?.parentId ?? null;

const buildGraphLayout = (graph: AgentGraph) => {
  const nodeWidth = 220;
  const nodeHeight = 104;
  const columnGap = 320;
  const positions = new Map<string, { x: number; y: number }>();
  const depths = [...new Set(graph.nodes.map((node) => node.depth))].sort((a, b) => a - b);

  for (const depth of depths) {
    const nodesAtDepth = graph.nodes.filter((node) => node.depth === depth);
    const step = Math.max(138, 560 / Math.max(1, nodesAtDepth.length));
    const startY = depth === 0 ? 280 : 70;

    nodesAtDepth.forEach((node, index) => {
      const parentPosition = parentFor(graph, node.id);
      const parentY = parentPosition ? positions.get(parentPosition)?.y : undefined;
      const siblingOffset = (index - (nodesAtDepth.length - 1) / 2) * step;
      positions.set(node.id, {
        x: 54 + depth * columnGap,
        y: depth > 1 && parentY !== undefined ? Math.max(70, parentY - 72 + index * 138) : startY + siblingOffset,
      });
    });
  }

  const maxX = Math.max(...[...positions.values()].map((position) => position.x), 54) + nodeWidth + 80;
  const maxY = Math.max(...[...positions.values()].map((position) => position.y), 280) + nodeHeight + 80;

  return {
    height: Math.max(620, maxY),
    nodeHeight,
    nodeWidth,
    positions,
    width: Math.max(980, maxX),
  };
};

export function AgentGraphView({
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
  const layout = useMemo(() => (graph ? buildGraphLayout(graph) : null), [graph]);

  return (
    <section className="graph-view" aria-labelledby="agent-graph-title">
      {error ? <div className="inline-alert" role="alert">{error.message}</div> : null}
      {isLoading ? <div role="status">Loading graph</div> : null}
      {!graph ? <div className="empty-state">No graph loaded.</div> : null}
      {graph && layout ? (
        <div className="graph">
          <div className="graph-canvas" data-testid="agent-graph-canvas">
            <div className="graph-head">
              <h1 id="agent-graph-title">
                <span className="dot" /> Agent Graph
              </h1>
              <span>
                Agent Tree · thread_spawn_edges
              </span>
              <span>
                Depth {maxDepth} · {graph.nodes.length} nodes · {graph.edges.length} edges
              </span>
            </div>

            <div className="graph-toolbar" aria-label="Graph controls">
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

            <div className="graph-grid" aria-hidden="true">
              {[0, 25, 50, 75, 100].map((percent) => (
                <span key={percent} style={{ left: `${percent}%` }} />
              ))}
              <b style={{ left: "38%" }}>Depth·1</b>
              <b style={{ left: "72%" }}>Depth·2</b>
            </div>

            <svg
              aria-hidden="true"
              className="graph-edges"
              data-testid="agent-graph-edges"
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width={layout.width}
            >
              <defs>
                <marker id="graph-arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" />
                </marker>
                <marker id="graph-arrow-warn" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" />
                </marker>
              </defs>
              {graph.edges.map((edge) => {
                const parentPosition = layout.positions.get(edge.parentId);
                const childPosition = layout.positions.get(edge.childId);
                if (!parentPosition || !childPosition) {
                  return null;
                }

                const x1 = parentPosition.x + layout.nodeWidth;
                const y1 = parentPosition.y + layout.nodeHeight / 2;
                const x2 = childPosition.x;
                const y2 = childPosition.y + layout.nodeHeight / 2;
                const mx = (x1 + x2) / 2;
                const marker = edge.status === "open" ? "url(#graph-arrow-warn)" : "url(#graph-arrow)";

                return (
                  <g className={`graph-edge graph-edge--${edge.status}`} key={`${edge.parentId}-${edge.childId}`}>
                    <path d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} markerEnd={marker} />
                    <text x={mx} y={(y1 + y2) / 2 - 6}>
                      {edge.status}
                    </text>
                  </g>
                );
              })}
            </svg>

            <ul
              aria-label="Agent graph nodes"
              className="graph-nodes"
              style={{ height: layout.height, width: layout.width }}
            >
              {graph.nodes.map((node) => (
                <li
                  className="graph-node-item"
                  key={node.id}
                  style={{
                    left: layout.positions.get(node.id)?.x ?? 0,
                    top: layout.positions.get(node.id)?.y ?? 0,
                  }}
                >
                  <button
                    aria-pressed={selectedNode?.id === node.id}
                    className={`node ${node.sourceEdgeStatus === "open" ? "status-open" : ""}`}
                    data-open={selectedNode?.id === node.id}
                    data-status={node.status}
                    onClick={() => setSelectedNodeId(node.id)}
                    onDoubleClick={() => selectTimeline(node)}
                    type="button"
                  >
                    <span className="corner-tl" />
                    <span className="corner-br" />
                    <span className="role">{nodeRole(node, graph.root.id)}</span>
                    <strong className="nick">{nodeCallsign(node)}</strong>
                    <span className="node-title">{node.title}</span>
                    <span className="id">
                      <ShortId value={node.id} />
                    </span>
                    <span className="row">
                      <span className="chip dim">{compactFormatter.format(node.tokenTotal)} tok</span>
                      <span className={node.sourceEdgeStatus === "open" ? "chip warn" : "chip good"}>
                        {node.sourceEdgeStatus ?? node.status}
                      </span>
                      {node.metadataMissing ? <span className="chip warn">meta</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {graph.truncatedDepth ? (
              <div className="graph-truncated inline-alert">Depth limit reached; increase graph depth to expand descendants.</div>
            ) : null}
          </div>

          <aside className="graph-info" aria-label="Selected graph node">
            <div className="panel-tit">
              <span className="dot" />
              <span>Node · Inspector</span>
            </div>
            {selectedNode ? (
              <div className="graph-info__body">
                <span className={selectedNode.depth > 0 ? "haztag amber" : "haztag primary"}>
                  {nodeRole(selectedNode, graph.root.id)}
                </span>
                <strong className="display graph-info__title">{selectedNode.title}</strong>
                <ShortId value={selectedNode.id} />

                <div className="graph-stat-grid">
                  <div>
                    <span>Tokens</span>
                    <strong>{compactFormatter.format(selectedNode.tokenTotal)}</strong>
                  </div>
                  <div>
                    <span>Children</span>
                    <strong>{childCountFor(graph, selectedNode.id)}</strong>
                    {openChildCountFor(graph, selectedNode.id) > 0 ? <em>{openChildCountFor(graph, selectedNode.id)} open</em> : null}
                  </div>
                  <div>
                    <span>Depth</span>
                    <strong>{selectedNode.depth}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{selectedNode.sourceEdgeStatus ?? selectedNode.status}</strong>
                  </div>
                </div>

                <div className="graph-facts">
                  <span>Thread ID {selectedNode.id}</span>
                  {selectedNode.nickname ? <span>Callsign {selectedNode.nickname}</span> : null}
                  {selectedNode.role ? <span>Role {selectedNode.role}</span> : null}
                  <span>Created {formatTimestamp(selectedNode.createdAt)}</span>
                  <span>Updated {formatTimestamp(selectedNode.updatedAt)}</span>
                  <span>Open children {graph.openCount}</span>
                  <span>Status summary {statusSummaryText(graph)}</span>
                </div>

                <div className="graph-message">
                  <span className="kicker">Final agent message</span>
                  <p>{selectedNode.finalReportPreview ?? "in progress"}</p>
                </div>

                <button type="button" onClick={() => selectTimeline(selectedNode)}>
                  Open selected in Timeline
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </section>
  );
}
