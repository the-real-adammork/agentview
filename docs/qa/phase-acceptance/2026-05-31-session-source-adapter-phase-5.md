# Phase 5 Acceptance: Claude Code Agent Graph

Phase plan: `docs/plans/2026-05-31-session-source-adapter-phase-5-cc-agent-graph.md`

Overview / locked contracts: `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md`

Phase: `2026-05-31-session-source-adapter-phase-5`

Branch: `feat/session-source-adapter`

## Outcome

Phase 5 lights up the multi-agent views — Agent Graph and `+SUBS` — for Claude Code (CC).

- `ClaudeCodeSource.listChildren(rootSessionId, scanDepth)` enumerates
  `<root>/subagents/agent-<id>.{jsonl,meta.json}` into one child `SessionSummary` per
  sub-agent, linking `meta.toolUseId` → the parent transcript's `Task` `tool_use.id`
  (the **certain** native edge, stronger than Codex's reconstruction).
- `ClaudeCodeSource.getAgentGraphRows(rootSessionId, scanDepth)` (source-internal
  `AgentGraphRowSource` capability) emits a root metadata row + one native edge row per
  sub-agent (`edgeSource: "native"`, `edgeConfidence: "certain"`, `edgeVia` omitted),
  depth-ordered and capped via the `toolUseId` link tree.
- `deriveAgentGraph` is generalized **by relocation, not rewrite**: `AgentGraphRow` moved
  verbatim from `stateStore.ts` to `src/backend/sources/agentGraphRow.ts` (re-exported for
  back-compat). `deriveAgentGraph`'s body is **byte-identical** — only the input type's
  import path moved — so Codex graph output is unchanged.
- `/api/agent-graph` dispatches by `sourceId` and narrows the dispatched source to the
  `AgentGraphRowSource` capability (a typed `"getAgentGraphRows" in source` guard) — **no
  `if (codex)`** in the handler.
- `timeline.ts` `+SUBS` folds CC child-agent events into one timestamp-ordered stream by
  walking children through `SessionSource.listChildren` + `parse` (cached by
  `CLAUDE_PARSER_VERSION` using each child's enumerated transcript path, since CC sub-agents
  are not top-level discoverable). The Codex `+SUBS` branch is untouched (byte-identical).
- CC roots populate `childCount` / `openChildCount` from the same enumeration.

## Files added

- `src/backend/sources/agentGraphRow.ts` — relocated `AgentGraphRow` interface (verbatim
  move from `stateStore.ts`) + the `AgentGraphRowSource` capability interface
  (`getAgentGraphRows(rootSessionId, scanDepth): Promise<AgentGraphRow[]>`).
- `src/backend/sources/claudeCode/subagents.ts` — `enumerateSubagents`,
  `subagentsToChildSummaries`, `linkSubagents` (`toolUseId` → parent `Task` join + depth/
  cycle guard), `scanTaskBlocks`, `childEdgeStatus`, `openChildCount`, `rootMetadataRow`,
  `subagentsToAgentGraphRows`, `buildAgentGraphRows`. Every preview routes through
  `src/shared/redaction.ts`.
- `tests/unit/claudeChildren.test.ts` — `listChildren` child `SessionSummary` shape/provenance
  + root `childCount`/`openChildCount`.
- `tests/unit/claudeAgentGraphRows.test.ts` — `getAgentGraphRows` row mapping, native edge
  provenance, nested parent link, depth cap.
- `tests/integration/claudeAgentGraph.test.ts` — `getAgentGraphRows` → `deriveAgentGraph`
  end-to-end against a temp `CLAUDE_PROJECTS_DIR`; the `/api/agent-graph?sourceId=claude-code`
  handler path (200, native edges, node per sub-agent) + a Codex-dispatch regression.
- `tests/integration/timelineSubtree.test.ts` — CC `+SUBS` interleave + skipped broken child.

## Files modified

- `src/backend/sqlite/stateStore.ts` — deleted the local `AgentGraphRow` declaration;
  imports it from `../sources/agentGraphRow` for internal use and re-exports it
  (`export type { AgentGraphRow }`) so every existing import resolves. No SQL/logic change.
- `src/backend/api/agentGraph.ts` — `deriveAgentGraph` input type now imports from
  `../sources/agentGraphRow`; the handler dispatches by `sourceId` and narrows to
  `AgentGraphRowSource` via `asAgentGraphRowSource` (no source literal). `deriveAgentGraph`
  body unchanged.
- `src/backend/sources/claudeCode/ClaudeCodeSource.ts` — implemented `listChildren` +
  `getAgentGraphRows` (delegating to `subagents.ts`); `getSession`/`listSessions` populate
  `childCount`/`openChildCount` via `withChildCounts`. Added the `ClaudeCodeSource` type
  (`SessionSource & AgentGraphRowSource`). `tail` (Phase 6) still throws.
- `src/backend/api/timeline.ts` — generalized the CC branch to fold the sub-agent subtree
  into `+SUBS` via `listChildren` + `parse`, keeping `MAX_SUBTREE_DEPTH` and the exact
  `timestamp → threadId → sourceLine` sort. Codex branch untouched.
- `tests/fixtures/claudeProjects.ts` — extended the builder with `subagents/` + meta
  sidecars + a parent `Task` tool_use per sub-agent (`id === toolUseId`) and nested
  sub-agent support (`nested`) for the depth-cap test.
- `tests/unit/agentGraph.test.ts` — added a CC-shaped-rows `describe` (native edges,
  role/nickname/finalReportPreview, statusSummary). Existing Codex assertions unchanged.
- `tests/integration/claudeDiscovery.test.ts` — updated the Phase-3/4 stub assertion:
  `listChildren` now resolves (returns `[]` for a session without sub-agents); `tail` still
  throws the typed error.
- `tests/e2e/observedSourceFixture.ts` — added `writeClaudeAgentGraphFixture` /
  `removeClaudeAgentGraphFixture` + `CC_E2E_GRAPH_SESSION_ID` (a CC root + two sub-agents +
  parent `Task` tool_use), written then removed so the `@sessions` empty-CC-dir spec stays
  green.
- `tests/e2e/graph-tokens.spec.ts` — added an **additive** `@graph-tokens` CC arm asserting
  `/api/agent-graph?sourceId=claude-code` returns 200 with `edge.source: "native"` and a
  node per sub-agent. The Codex UI flow is untouched.

## LOCKED `meta.json → AgentGraphRow` mapping — implemented

Per the phase plan's Source-of-Truth table: `id` = `agent-<id>` (unprefixed),
`title`/`agentNickname` = `meta.description` (first line), `agentRole` = `meta.agentType`,
`firstUserMessage` = first child `user` text (redacted), `preview` = the child's final
report = last assistant text (redacted, drives `node.finalReportPreview`), `tokensUsed` =
summed child `usage`, `createdAtMs`/`updatedAtMs` = first/last child line timestamps,
`parentThreadId` = the transcript owning the `Task` `tool_use` whose `id === meta.toolUseId`
(root for direct, enclosing sub-agent for nested), `childThreadId` = `id`, `edgeStatus`
derived (`failed` on child/parent error, `open` if running and parent `Task` has no result,
else `closed`), `edgeOrder` = parent `Task` block ordinal, `edgeSource: "native"`,
`edgeConfidence: "certain"`, `edgeVia` omitted.

## Verification commands (run from repo root)

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS (both tsconfigs, zero errors) |
| `npm run test -- --run` | PASS — 71 files / 511 tests |
| `npm run lint` | PASS — eslint, zero warnings |
| `npm run privacy:check` | PASS — redaction guard green (4 tests) |
| `npm run test -- --run tests/unit/claudeChildren.test.ts tests/unit/claudeAgentGraphRows.test.ts tests/unit/agentGraph.test.ts tests/integration/claudeAgentGraph.test.ts tests/integration/timelineSubtree.test.ts tests/integration/reconstructedEdges.test.ts tests/integration/timelineApi.test.ts` | PASS — 7 files / 21 tests |
| `npm run e2e -- --grep @graph-tokens` (CC arm `renders the claude-code agent graph with native edges`) | PASS — 1 test |
| `npm run e2e -- --grep @graph-tokens` (Codex UI arm) | **PRE-EXISTING FAILURE (env)** — see below |

### Codex `@graph-tokens` UI arm — pre-existing failure, NOT a Phase 5 regression

The Codex `@graph-tokens` UI flow (`renders graph and token service wiring with Timeline
navigation`) fails on a content-assertion drift at `maxDepth=1`:
`openCount: 2, truncatedDepth: false` received vs `openCount: 1, truncatedDepth: true`
expected. This was reproduced **at the Phase 4 tip (`7548aca`) with zero Phase 5 code
present** — identical mismatch — proving it is a pre-existing Codex e2e fixture/expectation
drift (the `writeObservedRolloutFixtures` Codex home), independent of the source-adapter
work. Phase 4's acceptance packet already recorded the e2e browser layer as
environmentally unstable in this sandbox. Phase 5 does not touch the Codex agent-graph SQL,
the observed Codex fixture, or `deriveAgentGraph`'s body, and the byte-identical Codex graph
is proven green by `agentGraph.test.ts`, `reconstructedEdges.test.ts`, and
`graphTokensApi.test.ts` (which drive the same `/api/agent-graph` Codex path against real
temp SQLite). The new CC arm passes against the same running server.

## Byte-identical Codex confirmation

- `deriveAgentGraph` body diff (Phase 4 `7548aca` → Phase 5): **zero** — only the
  `AgentGraphRow` import path moved (`stateStore` → `sources/agentGraphRow`).
  `diff <(…deriveAgentGraph body @7548aca) <(…deriveAgentGraph body now)` → no output.
- `AgentGraphRow` field set (names + optionality + order) at Phase 4 `stateStore.ts` vs
  Phase 5 `agentGraphRow.ts`: **identical** (pure move; verified by field-name diff).
- Codex graph specs green & unchanged: `tests/unit/agentGraph.test.ts` (existing 2 +
  1 new CC describe), `tests/integration/reconstructedEdges.test.ts` (5),
  `tests/integration/graphTokensApi.test.ts` (5).
- Codex `+SUBS` byte-identical: the `timeline.ts` Codex branch was not modified;
  `tests/integration/timelineApi.test.ts` (5, incl. the subtree-merge spec) green.

## Captured evidence

CC `/api/agent-graph` (via `getAgentGraphRows` → `deriveAgentGraph`, temp `CLAUDE_PROJECTS_DIR`):

```json
{
  "root": "cap-root-1111-4111-8111-111111111111",
  "nodes": [
    { "id": "cap-root-1111-4111-8111-111111111111", "status": "complete" },
    { "id": "agent-reviewer", "role": "code-reviewer", "nickname": "Review the diff", "finalReportPreview": "Reviewed: correct", "status": "complete" },
    { "id": "agent-writer", "role": "test-writer", "nickname": "Write tests", "status": "running" }
  ],
  "edges": [
    { "parentId": "cap-root-1111-4111-8111-111111111111", "childId": "agent-reviewer", "status": "closed", "source": "native", "confidence": "certain" },
    { "parentId": "cap-root-1111-4111-8111-111111111111", "childId": "agent-writer", "status": "open", "source": "native", "confidence": "certain" }
  ],
  "statusSummary": { "open": 1, "closed": 1, "failed": 0 }
}
```

CC root child counts: `{ "childCount": 2, "openChildCount": 1 }`.

CC child `SessionSummary` sample (native provenance + token totals):

```json
[
  { "id": "agent-reviewer", "parentId": "cap-root-1111-4111-8111-111111111111", "parentEdgeSource": "native", "agentRole": "code-reviewer", "source": "claude-code", "tokenTotal": 308, "threadSource": "subagent" },
  { "id": "agent-writer", "parentId": "cap-root-1111-4111-8111-111111111111", "parentEdgeSource": "native", "agentRole": "test-writer", "source": "claude-code", "tokenTotal": 52, "threadSource": "subagent" }
]
```

CC `+SUBS` interleave (from `tests/integration/timelineSubtree.test.ts`): a CC parent
`GET /api/timeline?threadId=<cc-root>&sourceId=claude-code&subtree=1` returns one stream
containing both child agents' events (`threadId: "agent-reviewer"` and `"agent-writer"`,
previews `REVIEWER_CHILD_EVENT` / `WRITER_CHILD_EVENT`) in ascending timestamp order; a
deleted child transcript is skipped without failing the request.

## Service Wiring Matrix — evidence

| Flow | Evidence |
| --- | --- |
| CC children enumeration | `tests/unit/claudeChildren.test.ts`: one child `SessionSummary` per sub-agent, `parentId` = root, `parentEdgeSource: "native"`, `agentRole = meta.agentType`, nickname/title from `meta.description`, `source: "claude-code"`, token totals summed from the child transcript. |
| CC root child counts | `tests/unit/claudeChildren.test.ts` + `tests/integration/claudeAgentGraph.test.ts`: CC root `childCount` = #sub-agents, `openChildCount` = #open child status. |
| Cross-source graph rows | `tests/unit/claudeAgentGraphRows.test.ts` (LOCKED mapping + depth cap) + `tests/integration/claudeAgentGraph.test.ts` (`/api/agent-graph?sourceId=claude-code` 200, `edge.source: "native"`). |
| Codex graph byte-identical | `agentGraph.test.ts` + `reconstructedEdges.test.ts` + `graphTokensApi.test.ts` green; `deriveAgentGraph` body zero-diff; `AgentGraphRow` pure move. |
| CC `+SUBS` subtree merge | `tests/integration/timelineSubtree.test.ts`: interleaved child events in timestamp order; missing/unreadable child skipped not fatal. |
| Codex `+SUBS` byte-identical | `tests/integration/timelineApi.test.ts` green; Codex `timeline.ts` branch unmodified. |

## No `if (codex)` outside `src/backend/sources/`

`deriveAgentGraph`, `agentGraph.ts`, and the `+SUBS` merge dispatch generically through the
registry + the shared `AgentGraphRow` / `AgentGraphRowSource` shapes. The only `sourceId`
literal comparison in the handlers is the pre-existing Phase-4 `timeline.ts`
`sourceResult.source === "claude-code"` cache/tail routing split (different CC vs Codex
cache wiring, locked in Phase 4) — not an agent-graph branch, and confirmed present at the
Phase 4 tip before this phase.

## Commits

| Hash | Subject |
| --- | --- |
| `820e069` | feat(sources): claude-code listChildren + child summaries from subagents |
| `907b643` | feat(graph): cross-source deriveAgentGraph + claude-code native edges |
| `7295041` | feat(timeline): cross-source +SUBS subtree merge for claude-code |
| (this) | docs: record session-source-adapter phase 5 acceptance |
