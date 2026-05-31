import type { AgentEdgeStatus, EdgeConfidence, EdgeSource, EdgeVia } from "../../shared/contracts";

/**
 * One row of an agent-graph scan, produced by ANY source.
 * - A "metadata" row carries node fields (id/title/…); parentThreadId/childThreadId/edgeStatus are null.
 * - An "edge" row carries parentThreadId + childThreadId + edgeStatus (+ optional node fields for the child).
 * deriveAgentGraph indexes metadata by `id` and edges by (parentThreadId, childThreadId, edgeStatus).
 *
 * Relocated verbatim from `stateStore.ts` (Phase 5) so both the Codex `StateStore`
 * and the Claude Code `subagents.ts` row builder produce this exact shape without a
 * cross-source dependency. `stateStore.ts` re-exports it for back-compat. Moving the
 * declaration (not the body of `deriveAgentGraph`) is what keeps Codex graph output
 * byte-identical.
 */
export interface AgentGraphRow {
  id: string | null;
  title: string | null;
  firstUserMessage: string | null;
  preview: string | null;
  tokensUsed: number | null;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
  agentNickname: string | null;
  agentRole: string | null;
  parentThreadId: string | null;
  childThreadId: string | null;
  edgeStatus: AgentEdgeStatus | null;
  edgeOrder?: number | bigint | null;
  /** "native" for Codex thread_spawn_edges AND for CC subagent meta edges; "reconstructed" for the overlay. */
  edgeSource?: EdgeSource;
  edgeConfidence?: EdgeConfidence;
  edgeVia?: EdgeVia;
}

/**
 * A narrow capability both `CodexSource` (via its wrapped `StateStore`) and
 * `ClaudeCodeSource` satisfy structurally. The `/api/agent-graph` handler narrows
 * the dispatched `SessionSource` to this capability and calls `getAgentGraphRows`
 * generically — no source literal / `if (codex)` in the handler. Per Planning
 * decision #3, `getAgentGraphRows` is source-internal and NOT on the locked
 * `SessionSource` interface.
 */
export interface AgentGraphRowSource {
  getAgentGraphRows(rootSessionId: string, scanDepth: number): Promise<AgentGraphRow[]>;
}
