import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";

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

const nodeRole = (node: AgentNode, isRoot: boolean) => {
  if (isRoot || node.depth === 0) {
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

const buildPositions = (graph: AgentGraph) => {
  const columnGap = 320;
  const positions = new Map<string, { x: number; y: number }>();
  const depths = [...new Set(graph.nodes.map((node) => node.depth))].sort((a, b) => a - b);

  for (const depth of depths) {
    const nodesAtDepth = graph.nodes.filter((node) => node.depth === depth);
    const step = Math.max(138, 560 / Math.max(1, nodesAtDepth.length));
    const startY = depth === 0 ? 280 : 70;

    nodesAtDepth.forEach((node, index) => {
      const parentId = parentFor(graph, node.id);
      const parentY = parentId ? positions.get(parentId)?.y : undefined;
      const siblingOffset = (index - (nodesAtDepth.length - 1) / 2) * step;
      positions.set(node.id, {
        x: 54 + depth * columnGap,
        y: depth > 1 && parentY !== undefined ? Math.max(70, parentY - 72 + index * 138) : startY + siblingOffset,
      });
    });
  }

  return positions;
};

interface GraphNodeData extends Record<string, unknown> {
  node: AgentNode;
  isRoot: boolean;
  onSelect(): void;
  onOpenTimeline(): void;
}

type AgentFlowNode = Node<GraphNodeData, "agent">;

function AgentFlowNodeView({ data, selected }: NodeProps<AgentFlowNode>) {
  const { node, isRoot, onSelect, onOpenTimeline } = data;

  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        aria-pressed={selected}
        className={`node ${node.sourceEdgeStatus === "open" ? "status-open" : ""}`}
        data-open={selected}
        data-status={node.status}
        onClick={onSelect}
        onDoubleClick={onOpenTimeline}
        type="button"
      >
        <span className="corner-tl" />
        <span className="corner-br" />
        <span className="role">{nodeRole(node, isRoot)}</span>
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
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

const nodeTypes = { agent: AgentFlowNodeView };

const minimapNodeColor = (node: AgentFlowNode) =>
  node.data.node.sourceEdgeStatus === "open" ? "var(--warn)" : "var(--primary)";

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
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) ?? graph?.root;

  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const onSelectSessionRef = useRef(onSelectSession);
  onSelectSessionRef.current = onSelectSession;

  const positions = useMemo(() => (graph ? buildPositions(graph) : null), [graph]);

  useEffect(() => {
    if (!graph || !positions) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const activeId = selectedNodeIdRef.current ?? graph.root.id;
    setNodes(
      graph.nodes.map((node) => ({
        id: node.id,
        type: "agent",
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        selected: node.id === activeId,
        data: {
          node,
          isRoot: node.id === graph.root.id,
          onSelect: () => setSelectedNodeId(node.id),
          onOpenTimeline: () => onSelectSessionRef.current(node.id, "Timeline"),
        },
      })),
    );
    setEdges(
      graph.edges.map((edge) => ({
        id: `${edge.parentId}-${edge.childId}`,
        source: edge.parentId,
        target: edge.childId,
        type: "default",
        animated: edge.status === "open",
        label: edge.status,
        className: `graph-flow-edge graph-flow-edge--${edge.status}`,
      })),
    );
  }, [graph, positions, setNodes, setEdges]);

  useEffect(() => {
    const activeId = selectedNodeId ?? graph?.root.id;
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === activeId })));
  }, [selectedNodeId, graph, setNodes]);

  return (
    <section className="graph-view" aria-labelledby="agent-graph-title">
      {error ? <div className="inline-alert" role="alert">{error.message}</div> : null}
      {isLoading ? <div role="status">Loading graph</div> : null}
      {!graph ? <div className="empty-state">No graph loaded.</div> : null}
      {graph ? (
        <div className="graph">
          <div className="graph-canvas" data-testid="agent-graph-canvas">
            <div className="graph-head">
              <h1 id="agent-graph-title">
                <span className="dot" /> Agent Graph
              </h1>
              <span>Agent Tree · thread_spawn_edges</span>
              <span>
                Depth {maxDepth} · {graph.nodes.length} nodes · {graph.edges.length} edges
              </span>
            </div>

            <div className="graph-flow">
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

              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable={false}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                minZoom={0.2}
                maxZoom={1.5}
                proOptions={{ hideAttribution: false }}
              >
                <Background gap={28} color="var(--ink-ghost)" />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable nodeColor={minimapNodeColor} maskColor="rgba(0, 0, 0, 0.6)" />
              </ReactFlow>

              {graph.truncatedDepth ? (
                <div className="graph-truncated inline-alert">
                  Depth limit reached; increase graph depth to expand descendants.
                </div>
              ) : null}
            </div>
          </div>

          <aside className="graph-info" aria-label="Selected graph node">
            <div className="panel-tit">
              <span className="dot" />
              <span>Node · Inspector</span>
            </div>
            {selectedNode ? (
              <div className="graph-info__body">
                <span className={selectedNode.depth > 0 ? "haztag amber" : "haztag primary"}>
                  {nodeRole(selectedNode, selectedNode.id === graph.root.id)}
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

                <button type="button" onClick={() => onSelectSession(selectedNode.id, "Timeline")}>
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
