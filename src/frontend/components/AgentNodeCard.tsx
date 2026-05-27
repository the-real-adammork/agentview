import type { AgentNode } from "../../shared/contracts";
import { ShortId } from "./ShortId";

interface AgentNodeCardProps {
  node: AgentNode;
  selected: boolean;
  onSelect(): void;
  onOpenTimeline(): void;
}

export function AgentNodeCard({ node, onOpenTimeline, onSelect, selected }: AgentNodeCardProps) {
  return (
    <button
      aria-pressed={selected}
      className="agent-node-card"
      data-status={node.status}
      onClick={onSelect}
      onDoubleClick={onOpenTimeline}
      type="button"
    >
      <span className="agent-node-card__depth">depth {node.depth}</span>
      <strong>{node.title}</strong>
      <span className="agent-node-card__meta">
        {node.status} / {node.tokenTotal.toLocaleString("en-US")} tokens
      </span>
      {node.nickname || node.role ? (
        <span className="agent-node-card__meta">
          {[node.nickname, node.role].filter(Boolean).join(" / ")}
        </span>
      ) : null}
      {node.metadataMissing ? <span className="agent-node-card__warning">metadata missing</span> : null}
      <ShortId value={node.id} />
    </button>
  );
}
