import type { SessionSummary } from "../../shared/contracts";
import { AnimatedNumber } from "./AnimatedNumber";
import {
  depthLabel,
  indexSessions,
  sessionDepth,
  sessionLineage,
  toneForDepth,
} from "../views/sessionTree";

interface SessionSquareProps {
  session: SessionSummary | undefined;
  sessions: SessionSummary[];
  active: boolean;
  /** When true the continuous selection rail passes under the square. */
  railStart: boolean;
  onClick: () => void;
}

const tokensOf = (session: SessionSummary): number => session.tokensUsed ?? session.tokenTotal ?? 0;

/**
 * Header square identifying the selected session: its place in the agent
 * hierarchy (parent / sub-agent / sub-sub-agent) shown as stacked depth bars,
 * its name + role, and a live token count. Clicking opens the Sessions list.
 */
export function SessionSquare({ session, sessions, active, railStart, onClick }: SessionSquareProps) {
  if (!session) {
    return null;
  }

  const index = indexSessions(sessions);
  const depth = sessionDepth(session, index);
  const tone = toneForDepth(depth);
  const isSub = depth > 0;
  const lineage = sessionLineage(session, index);
  const name = isSub ? session.agentNickname || session.titlePreview || session.title || "—" : session.title;
  const tooltip = [
    `Selected session — ${depthLabel(depth)}${isSub && session.agentRole ? ` · ${session.agentRole}` : ""}`,
    lineage.map((node) => (node.parentId ? node.agentNickname || "SUB" : "ROOT")).join(" → "),
    "Click to browse sessions",
  ].join("\n");

  return (
    <button
      type="button"
      className="session-sq"
      data-tone={tone}
      data-active={active ? "true" : "false"}
      data-rail={railStart ? "on" : undefined}
      onClick={onClick}
      title={tooltip}
    >
      <span className="ss-bars" aria-hidden="true">
        {lineage.map((node, lineageIndex) => (
          <span
            key={node.id}
            className="ss-bar"
            data-lvl={Math.min(lineageIndex, 2)}
            data-current={lineageIndex === lineage.length - 1 ? "true" : "false"}
          />
        ))}
      </span>
      <span className="ss-body">
        <span className="ss-top">
          <span className="ss-depth">{depthLabel(depth)}</span>
          {isSub && session.agentRole ? <span className="ss-role">· {session.agentRole}</span> : null}
        </span>
        <span className="ss-name">{name}</span>
      </span>
      <AnimatedNumber
        className="ss-tok num"
        value={tokensOf(session)}
        format={(value) => `${(value / 1000).toFixed(1)}K`}
      />
      <span className="ss-arrow" aria-hidden="true">▸</span>
    </button>
  );
}
