# Session Source Adapter — Phase 5: Claude Code Agent Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The shared contracts are LOCKED in `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md` — copy type names and signatures verbatim; never rename. This phase obeys **Planning decision #3** in that overview: the `AgentGraphRow`-shaped path was Codex-internal through Phase 4; Phase 5 **generalizes the agent-graph builder** to accept a normalized row shape produced by *either* source.

**Goal:** Make the Agent Graph view and the `+SUBS` timeline subtree-merge work for Claude Code. Implement `ClaudeCodeSource.listChildren` (one child `SessionSummary` per `subagents/agent-<id>.jsonl`, native parent edges), generalize `deriveAgentGraph` to accept normalized agent-graph rows from any source (Codex output stays byte-identical; CC rows are built from `subagents/*.meta.json` linking `meta.toolUseId` → the parent `Task` `tool_use.id`), populate `SessionSummary.childCount`/`openChildCount` for CC roots, and make the `timeline.ts` `+SUBS` merge walk CC children through the `SessionSource` interface so a CC parent timeline can fold in child-agent events under a depth cap equivalent to `MAX_SUBTREE_DEPTH`.

**Phase Boundary:** This phase only adds CC agent-graph wiring. It implements `ClaudeCodeSource.listChildren(rootSessionId, scanDepth)` and a new `ClaudeCodeSource.getAgentGraphRows(rootSessionId, scanDepth)`-equivalent, introduces a shared normalized `AgentGraphRow` row shape (relocated out of `stateStore.ts` so both sources import it without `if (codex)`), generalizes `deriveAgentGraph` + the `/api/agent-graph` handler to dispatch by `sourceId`, generalizes the `+SUBS` subtree merge in `timeline.ts` to walk children through the source interface, and populates `childCount`/`openChildCount` on CC `SessionSummary`s. It does NOT add CC **live tail** (Phase 6), and does not change any renderer, the normalized event model beyond what Phases 1–4 locked, the Codex agent-graph SQL, or the visual layer. Codex agent-graph and `+SUBS` output must stay **byte-identical**.

**Why this phase matters:** Phase 4 made a single CC session render end-to-end; this phase lights up the multi-agent views — Agent Graph and `+SUBS` — for CC, using the **certain** native `toolUseId → Task tool_use` edge (stronger than Codex's reconstruction). After this phase the only CC gap is live tail.

**Verification:** `npm run typecheck`, `npm run test -- --run`, focused `npm run test -- --run tests/unit/claudeChildren.test.ts tests/unit/claudeAgentGraphRows.test.ts tests/unit/agentGraph.test.ts tests/integration/claudeAgentGraph.test.ts tests/integration/timelineSubtree.test.ts tests/integration/reconstructedEdges.test.ts`, `npm run e2e -- --grep @graph-tokens`, `npm run lint`, `npm run privacy:check`.

> **e2e tag note:** the repository's graph e2e is tagged `@graph-tokens` (in `tests/e2e/graph-tokens.spec.ts`), not `@graph`. Every command below uses the real tag `@graph-tokens`. See the "Deviations from the locked overview" section.

**Smoke-Testable Outcome:** With a temp `CLAUDE_PROJECTS_DIR` fixture (`createClaudeProjectsFixture`, extended with a `subagents/` dir + meta sidecars) registered as the `claude-code` source: opening the Agent Graph for a CC root (`?sourceId=claude-code&rootThreadId=<cc-root>`) returns a graph whose edges report `source: "native"`, one node per sub-agent with `nickname`/`role`/`finalReportPreview` derived from the sub-agent meta + transcript; the CC root row in the Sessions list shows `childCount` = number of sub-agents and `openChildCount` = sub-agents whose child status is open; and a CC parent Timeline with `subtree=1` interleaves the child agents' events in timestamp order, capped at `MAX_SUBTREE_DEPTH`. Every existing Codex `@graph-tokens`, `@sessions`, and `@timeline` spec stays green and Codex graph/`+SUBS` bytes are unchanged.

**Phase Acceptance:** Vitest unit + integration drive the CC agent-graph derivation, the cross-source `deriveAgentGraph`, and the cross-source `+SUBS` merge against a generated temp `CLAUDE_PROJECTS_DIR`; `npm run e2e -- --grep @graph-tokens` confirms the Codex graph is unchanged and (with the CC fixture registered) a CC tree renders. Records `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-5.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks (T1, T2, T3), but the phase owner remains responsible for sequencing, the `deriveAgentGraph` generalization integration, verification, the acceptance packet, and downstream (Phase 6) assumptions.

**Phase Owner Responsibilities:**
- Keep Codex agent-graph and `+SUBS` output **byte-identical**: the `AgentGraphRow` relocation must be a pure move/re-export (no field/order change), and `deriveAgentGraph` must produce the same `nodes`/`edges`/`statusSummary`/ordering for Codex rows as before. Treat any Codex `@graph-tokens` / `reconstructedEdges` / `agentGraph` diff as a hard failure, not an expected change.
- Confine all CC branching to `src/backend/sources/claudeCode/`. No `if (codex)` / `if (claude-code)` appears in `deriveAgentGraph`, `timeline.ts`, or `agentGraph.ts` — those dispatch generically through the registry and consume the shared row shape.
- Hold the normalized `AgentGraphRow` shape + the `meta.json → row` field mapping frozen (this doc's "Source of Truth") before T1/T2 build against it.
- Confirm `npm run privacy:check` stays green every commit — sub-agent previews (titles, `finalReportPreview`, task) normalize through the same `src/shared/redaction.ts` masks as the main CC parse; raw CC content never leaves the server.
- Respect the locked `SessionSource.listChildren(rootSessionId, scanDepth): Promise<SessionSummary[]>` signature; `getAgentGraphRows` is a **source-internal** method (not on the `SessionSource` interface) — see "Where the row builder lives".

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| CC children + row builder | Task 1, Task 2 | one sub-agent (T2 depends on T1's fixture + child derivation) | Task 3 after the row shape is frozen | `src/backend/sources/claudeCode/subagents.ts`, `ClaudeCodeSource.ts`, `tests/fixtures/claudeProjects.ts` | `tests/unit/claudeChildren.test.ts`, `tests/unit/claudeAgentGraphRows.test.ts` |
| Builder generalization + handler | Task 2 (graph side) | phase-owner only (Codex-byte-identical risk) | none — gates the e2e | `src/backend/api/agentGraph.ts`, `src/backend/sources/agentGraphRow.ts` | `tests/unit/agentGraph.test.ts`, `tests/integration/claudeAgentGraph.test.ts`, `@graph-tokens` |
| `+SUBS` cross-source merge | Task 3 | one sub-agent (after T1 lands `listChildren`) | none | `src/backend/api/timeline.ts` | `tests/integration/timelineSubtree.test.ts` |
| Acceptance | Task 4 | phase-owner only | none | acceptance packet, full command set | full Phase 5 command set |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-31-session-source-adapter-phase-5-handoff.md`
- Required contents: current task status, branch/worktree, sub-agent results, verification evidence (typecheck + test + lint + privacy + e2e), service-wiring coverage, acceptance packet status, blockers/escalations, the byte-identical-Codex confirmation, and exact restart instructions.

## Phase-Dependency Note

This phase consumes, from earlier phases:
- `src/backend/sources/SessionSource.ts` — interface incl. `listChildren(rootSessionId, scanDepth): Promise<SessionSummary[]>` and `ResolvedSession` with `extra?: { subagentsDir }` (Phase 1).
- `src/backend/sources/registry.ts` — `createSourceRegistry`, `get(source)`, fan-out (Phase 2).
- `src/backend/sources/sourceQuery.ts` — `parseSourceId(url)` (Phase 2).
- `src/shared/contracts.ts` — `SourceId`, `SessionSummary.source`, `EdgeSource = "native" | "reconstructed"` (Phase 2).
- `src/backend/sources/claudeCode/ClaudeCodeSource.ts` + `discovery.ts` + `claudeMeta.ts` + `claudePaths.ts` — `listSessions`/`getSession`/`getHealth`/`resolveSession` (Phase 3).
- `src/backend/sources/claudeCode/parseClaudeSession.ts` + `toolMap.ts` — `parse(resolved): CachedRolloutFacts`, which already emits `agent_launch` events for `Task` tool_use blocks (Phase 4). The `Task` `tool_use.id` it records is the join key this phase links to `meta.toolUseId`.
- `tests/fixtures/claudeProjects.ts` — the CC projects-dir builder (Phase 3). **If Phase 3's builder does not yet write a `subagents/` dir + meta sidecars, Task 1 Step 1 extends it** (see below). If `claudeProjects.ts` does not exist at kickoff, STOP and confirm Phases 3–4 landed first — Phase 5 cannot derive CC children without CC discovery + parse.

> **Codex baseline assumption (from Phase 2):** by this phase `EdgeSource` is already `"native" | "reconstructed"` and `StateStore.normalizeThread` already stamps `parentEdgeSource: realParentId ? "native" : ...` and `source: "codex"`. The `reconstructedEdges.test.ts` expectations already read `"native"`. Phase 5 adds CC's native edges as a second producer of `"native"` and does not re-touch the rename.

---

## Source of Truth: The Normalized Agent-Graph Row (LOCKED for this phase)

`deriveAgentGraph` already consumes `AgentGraphRow[]` (`src/backend/api/agentGraph.ts`). **The normalized row shape IS the existing `AgentGraphRow`** — Phase 5 does not invent a new shape; it (a) **relocates** `AgentGraphRow` out of `stateStore.ts` into a source-shared module so both sources import it without a cross-source dependency, and (b) makes CC produce rows of that exact shape. Keeping the same interface is what makes Codex output byte-identical: `deriveAgentGraph` is unchanged in behavior; only the *import path* of its input type moves.

### Relocated type — `src/backend/sources/agentGraphRow.ts` (new)

Move this interface verbatim from `stateStore.ts` (do not change field names, optionality, or order). `stateStore.ts` re-exports it (`export type { AgentGraphRow } from "../sources/agentGraphRow";`) so every existing import keeps resolving:

```ts
import type {
  AgentEdgeStatus, EdgeConfidence, EdgeSource, EdgeVia,
} from "../../shared/contracts";

/**
 * One row of an agent-graph scan, produced by ANY source.
 * - A "metadata" row carries node fields (id/title/…); parentThreadId/childThreadId/edgeStatus are null.
 * - An "edge" row carries parentThreadId + childThreadId + edgeStatus (+ optional node fields for the child).
 * deriveAgentGraph indexes metadata by `id` and edges by (parentThreadId, childThreadId, edgeStatus).
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
```

`deriveAgentGraph(rootThreadId, rows, options)` keeps its current signature and body. It already:
- forwards `row.edgeSource` / `row.edgeConfidence` / `row.edgeVia` onto each `AgentEdge` (so CC edges with `edgeSource: "native"` surface as `edge.source: "native"`);
- sorts siblings by `sortCreatedAtMs` then `edgeOrder` then `childId.localeCompare`;
- maps `edgeStatus` → node `status` via `edgeStatusToSessionStatus` (`open→running`, `failed→failed`, else `complete`).

No change to `deriveAgentGraph` logic is required for CC — only that CC feeds it well-formed rows. (If `agentGraph.test.ts` imports `AgentGraphRow` from `stateStore`, the re-export keeps it green; optionally re-point the import to `../../src/backend/sources/agentGraphRow` in the same task.)

### meta.json → AgentGraphRow mapping (CC, LOCKED)

For a CC root with `<root>/subagents/agent-<id>.jsonl` + `<root>/subagents/agent-<id>.meta.json` where `meta = { agentType, description, toolUseId }`:

| `AgentGraphRow` field | CC source value |
| --- | --- |
| `id` | child session id = `agent-<id>` (the sub-agent transcript's `agentId` / file stem). **Unprefixed** native id (matches `SessionSummary.id` from `listChildren`). |
| `title` | `meta.description` (first line, trimmed). Falls back to `firstUserMessage` then `preview` then `id` via `titleFromRow` if empty. |
| `firstUserMessage` | first `user` message text block in the sub-agent transcript (redacted preview), else `null`. |
| `preview` | the sub-agent's **final report** = last `assistant`/`agent_message` text block (redacted preview) → drives `node.finalReportPreview`. |
| `tokensUsed` | sum of `usage` totals across the sub-agent transcript's assistant messages (same derivation as the CC `tokenTotal` in `claudeMeta.ts`). |
| `createdAtMs` | first line timestamp (ms) of the sub-agent transcript. |
| `updatedAtMs` | last line timestamp (ms) of the sub-agent transcript. |
| `agentNickname` | `meta.description` short label (nickname). Use the same nickname derivation `listChildren` uses; `null` if none. |
| `agentRole` | `meta.agentType` (e.g. `code-reviewer`), else `null`. |
| `parentThreadId` | **edge row only:** the parent session id that owns the `Task` `tool_use` whose `id === meta.toolUseId`. For a direct child this is the CC root; for a nested sub-agent it is the enclosing sub-agent's id. |
| `childThreadId` | **edge row only:** the child session id (`= id` above). |
| `edgeStatus` | derived child status: `open` if the child transcript is still running (no terminal report / recent mtime per `claudeMeta.ts` status heuristic) **and** the parent's matching `Task` tool_use has no `tool_result` yet; `failed` if the child or its `tool_result` is an error; else `closed`. |
| `edgeOrder` | the ordinal position of the matching `Task` `tool_use` block within the parent transcript (stable sort tiebreak), else the file-name sort index. |
| `edgeSource` | `"native"` (certain — the `toolUseId` link is exact). |
| `edgeConfidence` | `"certain"` (the `toolUseId → Task tool_use.id` join is unambiguous). |
| `edgeVia` | omit (CC native edges are not "reconstructed"; `edgeVia` is reconstruction-only). Leave `undefined`. |

The CC scan emits, per root, **one metadata row for the root** (node fields from the root `SessionSummary`/transcript; `parentThreadId=childThreadId=edgeStatus=null`) and **one edge row per discovered sub-agent** (with the child's node fields populated so `deriveAgentGraph` needs no second lookup). Mirror the Codex recursive query's shape: root metadata row first, then edge rows ordered by depth, then `createdAtMs`, then edge ordinal. Cap recursion at `scanDepth` and guard cycles by tracking visited child ids (a sub-agent could, in principle, appear under two parents — keep the first, like the Codex `instr(path,…)=0` guard).

### Where the row builder lives — `getAgentGraphRows` is source-internal

Per **Planning decision #3**, `getAgentGraphRows` is **not** added to the `SessionSource` interface. It stays a source-internal capability:
- `CodexSource` already exposes the Codex rows via its wrapped `StateStore.getAgentGraphRows` (Phase 1/2 accessor).
- `ClaudeCodeSource` gains a method of the same name/signature (`getAgentGraphRows(rootSessionId, scanDepth): Promise<AgentGraphRow[]>`).

The `/api/agent-graph` handler dispatches by `sourceId` and calls the dispatched source's `getAgentGraphRows`. To keep the handler source-generic without an `if`, add a **narrow optional capability interface** in `agentGraphRow.ts`:

```ts
export interface AgentGraphRowSource {
  getAgentGraphRows(rootSessionId: string, scanDepth: number): Promise<AgentGraphRow[]>;
}
```

Both `CodexSource` and `ClaudeCodeSource` implement it (structurally). The handler narrows the dispatched `SessionSource` to `AgentGraphRowSource` (a typed `"getAgentGraphRows" in source` guard, or expose it via a registry accessor) and calls it — no source literal in the handler.

---

## File Map

- Create: `src/backend/sources/agentGraphRow.ts` — relocated `AgentGraphRow` interface (verbatim move from `stateStore.ts`) + the `AgentGraphRowSource` capability interface.
- Modify: `src/backend/sqlite/stateStore.ts` — delete the local `AgentGraphRow` declaration; `export type { AgentGraphRow } from "../sources/agentGraphRow";` (re-export so existing imports resolve). **No logic/SQL change.**
- Create: `src/backend/sources/claudeCode/subagents.ts` — enumerate `<root>/subagents/agent-<id>.jsonl` + `agent-<id>.meta.json`; parse meta; link `meta.toolUseId` → parent `Task` tool_use; build child `SessionSummary[]` (for `listChildren`) and `AgentGraphRow[]` (for `getAgentGraphRows`) from the meta + child transcript.
- Modify: `src/backend/sources/claudeCode/ClaudeCodeSource.ts` — implement `listChildren(rootSessionId, scanDepth)` and `getAgentGraphRows(rootSessionId, scanDepth)` (delegating to `subagents.ts`); populate `childCount`/`openChildCount` on the root `SessionSummary` from the same enumeration (in `getSession`/`listSessions` for CC roots).
- Modify: `src/backend/api/agentGraph.ts` — dispatch by `sourceId` (`parseSourceId`) → `registry.get(source)`; obtain rows via the `AgentGraphRowSource` capability of the dispatched source; import `AgentGraphRow` from `../sources/agentGraphRow`. Codex path unchanged in behavior.
- Modify: `src/backend/api/timeline.ts` — generalize the `+SUBS` subtree merge: walk children via the dispatched source's `getAgentGraphRows`/`listChildren` instead of `store.getAgentGraphRows`; fold each descendant's events via the dispatched source's `parse(resolveSession(childId))`; keep `MAX_SUBTREE_DEPTH` and the existing timestamp→threadId→sourceLine sort.
- Modify: `tests/fixtures/claudeProjects.ts` — extend the CC builder to write a `subagents/` dir with `agent-<id>.jsonl` (`isSidechain:true`, parent `sessionId`, `agentId`) and `agent-<id>.meta.json` (`{agentType, description, toolUseId}`), and to stamp a matching `Task` `tool_use` (id === `toolUseId`) into the parent transcript. Support nested sub-agents for the depth-cap test.
- Test: `tests/unit/claudeChildren.test.ts` — `listChildren` → child `SessionSummary[]` shape/provenance.
- Test: `tests/unit/claudeAgentGraphRows.test.ts` — `getAgentGraphRows` → `AgentGraphRow[]` mapping + edge provenance + depth cap.
- Test: `tests/unit/agentGraph.test.ts` (extend) — `deriveAgentGraph` over CC-shaped rows yields `edge.source: "native"`; existing Codex-shaped assertions unchanged.
- Test: `tests/integration/claudeAgentGraph.test.ts` — `ClaudeCodeSource.getAgentGraphRows` → `deriveAgentGraph` end-to-end against a temp `CLAUDE_PROJECTS_DIR`; and the `/api/agent-graph?sourceId=claude-code` handler path.
- Test: `tests/integration/timelineSubtree.test.ts` — `+SUBS` merge folds CC child events under the cap; Codex `+SUBS` unchanged.
- Test: `tests/integration/reconstructedEdges.test.ts` (regression only — must stay green, no edits expected).
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-5.md` — acceptance evidence packet.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| CC children enumeration | Sessions list child/open counts | `ClaudeCodeSource.listChildren` | `subagents/*.jsonl` + `*.meta.json` | None | Read-only filesystem (`CLAUDE_PROJECTS_DIR`) | Unit: one child `SessionSummary` per sub-agent; `parentId` = root, `parentEdgeSource: "native"`, `agentRole = meta.agentType`, nickname/task from `meta.description`, `source: "claude-code"`, token totals from child transcript. |
| CC root child counts | Sessions table count cells | `ClaudeCodeSource.getSession`/`listSessions` | `subagents/` enumeration | None | Read-only filesystem | Unit/integration: CC root `childCount` = #sub-agents, `openChildCount` = #open child status. |
| Cross-source graph rows | Agent Graph view | dispatched `getAgentGraphRows` (Codex SQL OR CC subagents) → `deriveAgentGraph` | state DB (Codex) / `subagents/` (CC) | None | Read-only SQLite + filesystem | Unit: CC rows map per the LOCKED table; integration: `/api/agent-graph?sourceId=claude-code` 200 with `edge.source: "native"`. |
| Codex graph byte-identical | Agent Graph view (Codex) | `deriveAgentGraph` unchanged | `thread_spawn_edges` | None | Read-only SQLite | `agentGraph.test.ts` + `reconstructedEdges.test.ts` + `@graph-tokens` unchanged; row relocation is a pure move. |
| CC `+SUBS` subtree merge | Timeline `+SUBS` scope | `timeline.ts` walking children via the dispatched source | child CC transcripts | None | Read-only filesystem | Integration: CC parent `subtree=1` interleaves child events in timestamp order; depth capped at `MAX_SUBTREE_DEPTH`; missing/unreadable child skipped. |
| Codex `+SUBS` byte-identical | Timeline `+SUBS` (Codex) | `timeline.ts` (generalized, Codex dispatch) | Codex rollouts | None | Read-only SQLite + rollouts | `timelineApi.test.ts` / existing `@timeline` unchanged; same sort, same warnings ordering. |

## E2E Harness Readiness

Reuse the existing `@graph-tokens` Playwright spec (`tests/e2e/graph-tokens.spec.ts`) and the Codex `observedSourceFixture` so the **Codex graph stays green unchanged**. For the CC graph e2e, register the `claude-code` source in the Playwright web-server env (set `CLAUDE_PROJECTS_DIR` to a generated fixture written by an extended helper alongside `writeObservedRolloutFixtures`) and add a CC assertion block to the `@graph-tokens` spec: navigate to the CC root (the merged session list now interleaves CC), open Agent Graph, assert the `/api/agent-graph?sourceId=claude-code` response has a node per sub-agent and `edge.source: "native"`. Keep the CC assertions additive so the Codex flow is untouched.

---

### Task 1: `ClaudeCodeSource.listChildren` + Child `SessionSummary` Derivation

**Depends On:** Phases 3–4 (`ClaudeCodeSource` discovery + parse; `claudeProjects.ts` fixture)

**Execution:** sub-agent lane: CC children + row builder; parallel with none initially (gates T2/T3); checkpoint `npm run test -- --run tests/unit/claudeChildren.test.ts`

**Files:**
- Modify: `tests/fixtures/claudeProjects.ts` (extend with `subagents/` + meta sidecars + parent `Task` tool_use)
- Create: `src/backend/sources/claudeCode/subagents.ts`
- Modify: `src/backend/sources/claudeCode/ClaudeCodeSource.ts`
- Test: `tests/unit/claudeChildren.test.ts`

**Service Wiring Rows Covered:**
- CC children enumeration
- CC root child counts

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/claudeChildren.test.ts`
- Expected result: `listChildren` returns one child `SessionSummary` per `subagents/agent-<id>.jsonl`; each carries `parentId = rootSessionId`, `parentEdgeSource: "native"`, `agentRole = meta.agentType`, nickname + `lastMessage`/title from `meta.description`, `source: "claude-code"`, and token totals summed from the child transcript; CC root `childCount`/`openChildCount` reflect the enumeration.
- Evidence to collect: focused test output; a sample child `SessionSummary` capture.

**Test Mode Disclosure:**
- Automated tests: real local temp `CLAUDE_PROJECTS_DIR` fixture (no DB)
- Production/dev path exercised: yes — the same `subagents.ts` enumeration used by the API
- Mock-only risk: real CC `subagents/` layout drift vs. fixture (mitigated: fixture mirrors the verified `{agentType, description, toolUseId}` shape and `isSidechain:true` lines)
- Required real dependencies: temp filesystem
- Blocking if unavailable: yes

- [ ] Step 1: Extend `tests/fixtures/claudeProjects.ts`: add a `subagents` option to the builder that, for a given parent session, writes `<root>/subagents/agent-<id>.jsonl` (lines stamped `isSidechain: true`, parent `sessionId`, `agentId`, with at least one `user` and one `assistant` message carrying `usage`) and `<root>/subagents/agent-<id>.meta.json` = `{ agentType, description, toolUseId }`, AND injects a `Task` `tool_use` block (`id === toolUseId`) into the parent transcript at a known position. Support a `nested` flag so a sub-agent can itself own a `subagents/` child (for the T3 depth-cap test).
- [ ] Step 2: Write `tests/unit/claudeChildren.test.ts` with a fixture root that has two sub-agents (`agentType: "code-reviewer"` / `"test-writer"`, distinct `description`/`toolUseId`). Failing assertions: `listChildren(root, scanDepth)` returns 2 children; each `child.parentId === root`, `child.parentEdgeSource === "native"`, `child.source === "claude-code"`, `child.agentRole === meta.agentType`, `child.agentNickname`/title derived from `meta.description`, `child.tokenTotal` equals the summed child-transcript `usage`; the root summary's `childCount === 2` and `openChildCount` matches the open child count. Run and confirm failure (module missing).
- [ ] Step 3: Implement `src/backend/sources/claudeCode/subagents.ts` exporting `enumerateSubagents(root)` (reads `subagents/*.meta.json` + sibling `.jsonl`, returns a normalized list incl. child id, meta, parent id, derived status, token total, createdAt/updatedAt, previews) and `subagentsToChildSummaries(root, entries): SessionSummary[]` mapping each entry to a child `SessionSummary` per the wiring row. Reuse `claudeMeta.ts` token/status/title helpers and `src/shared/redaction.ts` previews — no new raw path.
- [ ] Step 4: Wire `ClaudeCodeSource.listChildren(rootSessionId, scanDepth)` to resolve the root's `subagentsDir` (from `resolveSession(...).extra`), enumerate (respecting `scanDepth` for nested sub-agents), and return the child summaries; populate `childCount`/`openChildCount` on the root `SessionSummary` in `getSession`/`listSessions` from the same enumeration (memoize per request to avoid double-scan).
- [ ] Step 5: Run `npm run test -- --run tests/unit/claudeChildren.test.ts && npm run typecheck && npm run lint` and confirm green.
- [ ] Step 6: Commit this task. Suggested message: `feat(sources): claude-code listChildren + child summaries from subagents`

### Task 2: Generalize `deriveAgentGraph` Input + CC Row Builder + Graph Handler Dispatch

**Depends On:** Task 1

**Execution:** phase-owner owns the relocation + handler (Codex-byte-identical risk); sub-agent may build the CC row mapping under the frozen shape; checkpoint `npm run test -- --run tests/unit/agentGraph.test.ts tests/unit/claudeAgentGraphRows.test.ts tests/integration/claudeAgentGraph.test.ts`

**Files:**
- Create: `src/backend/sources/agentGraphRow.ts`
- Modify: `src/backend/sqlite/stateStore.ts` (re-export only), `src/backend/sources/claudeCode/subagents.ts`, `src/backend/sources/claudeCode/ClaudeCodeSource.ts`, `src/backend/api/agentGraph.ts`
- Test: `tests/unit/claudeAgentGraphRows.test.ts`, `tests/unit/agentGraph.test.ts` (extend), `tests/integration/claudeAgentGraph.test.ts`

**Service Wiring Rows Covered:**
- Cross-source graph rows
- Codex graph byte-identical

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/agentGraph.test.ts tests/unit/claudeAgentGraphRows.test.ts tests/integration/claudeAgentGraph.test.ts tests/integration/reconstructedEdges.test.ts`
- Expected result: `deriveAgentGraph` over CC rows yields a node per sub-agent with `nickname`/`role`/`finalReportPreview` and `edge.source: "native"`, `edge.confidence` absent-or-`"certain"`; the existing Codex `deriveAgentGraph` assertions are byte-identical; `/api/agent-graph?sourceId=claude-code&rootThreadId=<cc-root>` returns 200 with the CC graph; Codex `reconstructedEdges` stays green.
- Evidence to collect: focused test output; a JSON capture of a CC `/api/agent-graph` body; grep evidence that `deriveAgentGraph`'s body is unchanged (diff shows only the `AgentGraphRow` import path moved).

**Test Mode Disclosure:**
- Automated tests: real local temp `CLAUDE_PROJECTS_DIR` (CC) + temp `$CODEX_HOME` (Codex regression)
- Production/dev path exercised: yes — handler → registry → dispatched `getAgentGraphRows` → `deriveAgentGraph`
- Mock-only risk: none beyond fixture-layout drift (covered by T1's verified shape)
- Required real dependencies: temp filesystem; `node:sqlite` for the Codex regression
- Blocking if unavailable: yes

- [ ] Step 1: Relocate `AgentGraphRow`: create `src/backend/sources/agentGraphRow.ts` with the interface copied **verbatim** from `stateStore.ts` plus the `AgentGraphRowSource` capability interface. In `stateStore.ts`, delete the local declaration and add `export type { AgentGraphRow } from "../sources/agentGraphRow";`. Run `npm run typecheck` — every existing import (`agentGraph.ts`, `agentGraph.test.ts`, `timeline.ts`) must still resolve via the re-export. No behavior change.
- [ ] Step 2: Re-point `deriveAgentGraph`'s input import to `../sources/agentGraphRow` in `agentGraph.ts` (cosmetic; the type is identical via re-export). Run `npm run test -- --run tests/unit/agentGraph.test.ts tests/integration/reconstructedEdges.test.ts` and confirm **still green** (proves the relocation is byte-identical).
- [ ] Step 3: Write failing `tests/unit/claudeAgentGraphRows.test.ts`: from the T1 fixture root, `ClaudeCodeSource.getAgentGraphRows(root, scanDepth)` returns one root metadata row (node fields, null edge fields) + one edge row per sub-agent with: `parentThreadId === root`, `childThreadId === agent-<id>`, `edgeSource === "native"`, `edgeConfidence === "certain"` (or asserted-absent-`edgeVia`), `agentRole === meta.agentType`, `preview` === the child's final report, `tokensUsed` summed; nested sub-agent appears only when `scanDepth` allows and is capped otherwise; cycle/duplicate child guarded. Run and confirm failure.
- [ ] Step 4: Implement `ClaudeCodeSource.getAgentGraphRows(rootSessionId, scanDepth)` in `subagents.ts` + `ClaudeCodeSource.ts` per the LOCKED `meta.json → row` mapping: emit the root metadata row, then a depth-ordered edge row per sub-agent (recursing into nested `subagents/` up to `scanDepth`, visited-guarded). Link `meta.toolUseId` → the parent transcript's `Task` `tool_use.id` to set `parentThreadId` (root for direct children; enclosing sub-agent id for nested) and `edgeOrder` (the `Task` block ordinal). Run the unit test and confirm green.
- [ ] Step 5: Extend `tests/unit/agentGraph.test.ts` with a CC-shaped `AgentGraphRow[]` (edge rows carrying `edgeSource: "native"`, `edgeConfidence: "certain"`): assert `deriveAgentGraph` produces `edge.source === "native"`, the node `role`/`nickname`/`finalReportPreview` populate, and `statusSummary` reflects the child statuses. Keep all existing Codex-shaped assertions unchanged. Run and confirm green.
- [ ] Step 6: Generalize `src/backend/api/agentGraph.ts`: parse `sourceId` (`parseSourceId(url)` → typed 400 on bad value); `const source = registry.get(sourceId)`; obtain rows via the `AgentGraphRowSource` capability (`getAgentGraphRows(rootThreadId, maxDepth+1)`); call `deriveAgentGraph(rootThreadId, rows, { maxDepth })` unchanged. Preserve the existing per-request lifecycle and error mapping (`THREAD_NOT_FOUND` 404, state-db 503). No `if (codex)` — both sources structurally satisfy `AgentGraphRowSource`.
- [ ] Step 7: Write `tests/integration/claudeAgentGraph.test.ts`: against a temp `CLAUDE_PROJECTS_DIR` (registered `claude-code`), call the `/api/agent-graph?sourceId=claude-code&rootThreadId=<cc-root>` handler; assert 200, a node per sub-agent, `edge.source: "native"`, `root` node = CC root; add a Codex regression assertion (`?sourceId=codex` or default) returning the unchanged Codex graph. Run and confirm green.
- [ ] Step 8: Run `npm run test -- --run tests/unit/agentGraph.test.ts tests/unit/claudeAgentGraphRows.test.ts tests/integration/claudeAgentGraph.test.ts tests/integration/reconstructedEdges.test.ts && npm run typecheck && npm run lint && npm run privacy:check` and confirm green.
- [ ] Step 9: Commit this task. Suggested message: `feat(graph): cross-source deriveAgentGraph + claude-code native edges`

### Task 3: `+SUBS` Timeline Merge Across Sources

**Depends On:** Task 1 (`listChildren`/`getAgentGraphRows`); Task 2 recommended (shared row + dispatch pattern)

**Execution:** sub-agent lane: `+SUBS` cross-source merge; parallel with none; checkpoint `npm run test -- --run tests/integration/timelineSubtree.test.ts`

**Files:**
- Modify: `src/backend/api/timeline.ts`
- Test: `tests/integration/timelineSubtree.test.ts`, `tests/integration/timelineApi.test.ts` (regression — Codex `+SUBS` unchanged)

**Service Wiring Rows Covered:**
- CC `+SUBS` subtree merge
- Codex `+SUBS` byte-identical

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/timelineSubtree.test.ts tests/integration/timelineApi.test.ts`
- Expected result: a CC parent `GET /api/timeline?threadId=<cc-root>&sourceId=claude-code&subtree=1` returns events that interleave the child agents' events in timestamp order (then `threadId`, then `sourceLine`), capped at `MAX_SUBTREE_DEPTH`, with a missing/unreadable child skipped not fatal; the Codex `+SUBS` path is byte-identical (same events, same sort, same warnings ordering).
- Evidence to collect: integration test output; a capture showing a child-agent event appearing in a CC parent's `+SUBS` stream.

**Test Mode Disclosure:**
- Automated tests: real local temp `CLAUDE_PROJECTS_DIR` (CC) + temp `$CODEX_HOME` (Codex regression)
- Production/dev path exercised: yes — handler → dispatched source resolve/parse/listChildren
- Mock-only risk: none beyond fixture drift
- Required real dependencies: temp filesystem; `node:sqlite` for Codex regression
- Blocking if unavailable: yes

- [ ] Step 1: Write failing `tests/integration/timelineSubtree.test.ts`: a CC root with two sub-agents whose child events have timestamps interleaved with the parent's. Assert `subtree=1` returns a single stream containing both child agents' events ordered by `timestamp`, then `threadId`, then `sourceLine`; assert a third, deliberately broken child (missing transcript) is skipped without failing the request; assert that with a depth-capped nested sub-agent, descendants beyond `MAX_SUBTREE_DEPTH` are excluded. Run and confirm failure.
- [ ] Step 2: Generalize the `+SUBS` branch in `src/backend/api/timeline.ts`: replace the direct `store.getAgentGraphRows(threadId, MAX_SUBTREE_DEPTH)` + `store.getThread` + Codex `parseRolloutFile` calls with source-generic dispatch — `const source = registry.get(sourceId)`; collect descendant ids via the dispatched source (`source.getAgentGraphRows(threadId, MAX_SUBTREE_DEPTH)` childThreadIds, deduped, excluding the root — matching the current Codex logic) OR via `source.listChildren` recursion; for each descendant, `source.resolveSession(id)` → `source.parse(resolved)` → fold `facts.events` and warnings. Keep `MAX_SUBTREE_DEPTH = 10` and the exact final sort (`timestamp` → `threadId` → `sourceLine`). Best-effort: a descendant whose resolve/parse throws is skipped (try/catch as today).
- [ ] Step 3: Confirm the Codex `+SUBS` path is byte-identical: the dispatched `CodexSource` must yield the same descendant id set (its `getAgentGraphRows` returns the same rows as `store.getAgentGraphRows` did) and the same parsed events. Run `npm run test -- --run tests/integration/timelineApi.test.ts` and confirm green (no Codex diff).
- [ ] Step 4: Run `npm run test -- --run tests/integration/timelineSubtree.test.ts tests/integration/timelineApi.test.ts && npm run typecheck && npm run lint && npm run privacy:check` and confirm green.
- [ ] Step 5: Commit this task. Suggested message: `feat(timeline): cross-source +SUBS subtree merge for claude-code`

### Task 4: Phase 5 Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3

**Execution:** phase-owner only; parallel with none; checkpoint full Phase 5 command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-5.md`
- Modify: any Phase 5 files needed for integration fixes; `tests/e2e/graph-tokens.spec.ts` (additive CC assertions, if registering the CC source in the e2e web server)

**Service Wiring Rows Covered:**
- All rows in the Service Wiring Matrix

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run lint && npm run privacy:check && npm run e2e -- --grep @graph-tokens`
- Expected result: CC agent graph + `+SUBS` work end-to-end; Codex graph/`+SUBS` byte-identical; CC edges report `source: "native"`; CC roots show `childCount`/`openChildCount`; no `if (codex)` outside `src/backend/sources/`.
- Evidence to collect: full command output, e2e artifacts, a CC `/api/agent-graph` body capture, a CC `+SUBS` capture, and a diff/grep confirming `deriveAgentGraph`'s body is unchanged (only the `AgentGraphRow` import path moved).

**Test Mode Disclosure:**
- Automated tests: real local temp `CLAUDE_PROJECTS_DIR` + temp `$CODEX_HOME` + Playwright
- Production/dev path exercised: yes — browser → API → registry → dispatched source → filesystem/SQLite
- Mock-only risk: optional real `~/.claude/projects` validation may be skipped if local data is unavailable
- Required real dependencies: temp filesystem, `node:sqlite`, Playwright runtime
- Blocking if unavailable: yes, except optional private real-data validation

- [ ] Step 1: Create the acceptance packet with a Service Wiring table row per matrix flow and a Commits table (Tasks 1–4).
- [ ] Step 2: Run the full command set and confirm any integration failures.
- [ ] Step 3: Apply final integration fixes within Phase 5 scope.
- [ ] Step 4: Rerun the full command set and record evidence (artifact paths) into the packet, including: the CC graph `edge.source: "native"` capture, the CC `+SUBS` interleave capture, the CC root `childCount`/`openChildCount` capture, and the byte-identical-Codex confirmation (relocation diff + green Codex specs).
- [ ] Step 5: Commit this task. Suggested message: `docs: record session-source-adapter phase 5 acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: relocated `AgentGraphRow`, the `AgentGraphRowSource` capability, the generalized `agentGraph.ts` + `timeline.ts`, and the CC `subagents.ts` compile across both tsconfigs.
- Run: `npm run test -- --run`
  Expected: unit + integration pass, including `claudeChildren`, `claudeAgentGraphRows`, extended `agentGraph`, `claudeAgentGraph`, `timelineSubtree`, and the unchanged Codex suites (`agentGraph`, `reconstructedEdges`, `timelineApi`).
- Run: `npm run lint`
  Expected: zero warnings.
- Run: `npm run privacy:check`
  Expected: redaction guard green — CC sub-agent previews (title, `finalReportPreview`, task) mask through `src/shared/redaction.ts`; raw CC content never leaves the server.
- Run: `npm run e2e -- --grep @graph-tokens`
  Expected: the Codex graph renders unchanged; with the CC source registered, a CC tree renders with `edge.source: "native"` and a node per sub-agent.

**Required Service Wiring Coverage:**
- CC children enumeration — unit covers one child `SessionSummary` per sub-agent with native provenance + token totals.
- CC root child counts — unit/integration cover `childCount`/`openChildCount` on the CC root.
- Cross-source graph rows — unit + integration cover the LOCKED `meta.json → row` mapping and `edge.source: "native"`.
- Codex graph byte-identical — `agentGraph`/`reconstructedEdges`/`@graph-tokens` unchanged after the row relocation.
- CC `+SUBS` subtree merge — integration covers interleaved child events, depth cap, and skipped broken child.
- Codex `+SUBS` byte-identical — `timelineApi`/`@timeline` unchanged after generalization.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-5.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every applicable service-wiring row has evidence, CC agent-graph edges report `source: "native"`, CC roots populate `childCount`/`openChildCount`, the `+SUBS` merge folds CC child events under `MAX_SUBTREE_DEPTH`, the Codex agent-graph and `+SUBS` output is proven byte-identical (relocation diff + green Codex specs), no `if (codex)` exists outside `src/backend/sources/`, and the acceptance packet exists with current commit evidence.

## Deviations from the locked overview

- **e2e tag `@graph-tokens`, not `@graph`.** The task brief said `--grep @graph`; the repository's graph e2e is tagged `@graph-tokens` (`tests/e2e/graph-tokens.spec.ts`; `@graph` matches nothing). All commands use the real tag. No behavior change — this is a tag-name correction only.
- **`getAgentGraphRows` is source-internal, not on the `SessionSource` interface.** This follows Planning decision #3 verbatim (the `AgentGraphRow`-shaped path stays a source capability; only `listChildren` returning `SessionSummary[]` is on the interface). Phase 5 adds a narrow `AgentGraphRowSource` capability interface that both sources satisfy structurally, so the handler stays source-generic without widening the locked `SessionSource` signature.
- **`AgentGraphRow` relocated (not redefined).** The "normalized row shape" the overview anticipated is the existing `AgentGraphRow`; Phase 5 moves it to `src/backend/sources/agentGraphRow.ts` and re-exports from `stateStore.ts`. This is what guarantees Codex `deriveAgentGraph` output is byte-identical: the consumer type is unchanged, only its declaration site moves. No contract (`src/shared/contracts.ts`) change is required this phase.
