# Session Source Adapter Phase 2 — Registry + Source Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This phase consumes the LOCKED contracts from `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md` — use those names/signatures verbatim; never rename.

**Goal:** Add a generic `SourceRegistry` (`createSourceRegistry`) that holds registered `SessionSource`s and dispatches API requests by an explicit `(source, id)` composite key, plus the additive contract changes (`SourceId`, `SessionSummary.source`, `SessionFilter.source`, and the `EdgeSource` rename from `"codex"|"reconstructed"` to `"native"|"reconstructed"`). The API handlers and frontend client learn to read a `source` discriminator (default `"codex"`) and dispatch through `registry.get(source)`; the merged `/api/sessions` list (no source filter) fans out across all registered sources. In this phase **only Codex is registered**, so behavior is identical for users — but the dispatch path is now source-generic. Claude Code is OUT OF SCOPE.

**Phase Boundary:** This phase changes contracts, introduces `src/backend/sources/registry.ts`, and re-points the existing API handlers (`health`, `sessions`, `timeline`, `agentGraph`, `stream`) and the frontend client through the registry/dispatch seam. It does NOT add `ClaudeCodeSource`, CC discovery, CC parsing, CC agent graph, or CC live tail (Phases 3–6). It does NOT change any renderer, the normalized model beyond the three additive fields, or the rendering/visual layer. `CodexSource` and `SessionSource.ts` are assumed to exist from Phase 1; if Phase 1 has not landed, see the Phase-1 Dependency note below.

**Verification:** `npm run typecheck`, `npm run test -- --run`, `npm run lint`, `npm run privacy:check`, `npm run e2e -- --grep @sessions` (and `@graph` for the `EdgeSource` rename).

**Smoke-Testable Outcome:** With a temp fixture `$CODEX_HOME` (or local `~/.codex`), every existing flow behaves identically: the Sessions list, a session lookup, a timeline, and the agent graph all resolve through `registry.get("codex")`. A request with no `source` discriminator defaults to `"codex"`; an unknown `source` (e.g. `claude-code`, which is not registered this phase) returns a typed `400`; the merged `/api/sessions` list (no source filter) returns the same rows it did before (single Codex source, fan-out of one). The agent graph reports `source: "native"` on Codex spawn edges where it previously reported `"codex"`.

**Phase Acceptance:** Vitest integration drives the dispatch flows against a generated temp Codex home, and `npm run e2e -- --grep @sessions` confirms no user-visible regression. Records `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-2.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks, but the phase owner remains responsible for sequencing, integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Land the `EdgeSource` rename as one atomic, typecheck-green change: every reference updated in the same task before any commit.
- Keep the contract shape (`SourceId`, `source` fields, `EdgeSource`) frozen before backend or frontend dispatch work depends on it.
- Preserve Phase 1 behavior: `CodexSource` + `SessionSource.ts` stay the single registered source; zero user-visible change.
- Confirm `npm run privacy:check` stays green every commit (raw never leaves the server).
- Update the downstream handoff if the registry's resolved signatures differ from the locked overview (they should not).

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Contracts + rename sweep | Task 1 | phase-owner only (breaking type change) | None — gates everything else | `src/shared/contracts.ts`, `src/backend/sqlite/stateStore.ts`, `src/backend/api/agentGraph.ts`, `src/frontend/views/SessionsView.tsx`, tests | `npm run typecheck` green; `@graph` e2e green |
| Registry | Task 2 | one sub-agent (after Task 1) | Task 3 backend after registry signature is stable | `src/backend/sources/registry.ts` | `npm run test -- --run tests/unit/sourceRegistry.test.ts` |
| API + client dispatch | Task 3 | one sub-agent (after Task 2) | None | API handlers, `src/backend/server.ts`, `src/frontend/api/client.ts` | `npm run test -- --run tests/integration/sourceDispatch.test.ts` |
| Acceptance | Task 4 | phase-owner only | None | acceptance packet, full command set | Full Phase 2 command set |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-31-session-source-adapter-phase-2-handoff.md`
- Required contents: current task status, branch/worktree, sub-agent results, verification evidence (typecheck + test + lint + privacy + e2e), service-wiring coverage, acceptance packet status, blockers/escalations, and exact restart instructions.

## Phase-1 Dependency Note

This phase consumes `src/backend/sources/SessionSource.ts` (interface + `ResolvedSession`, `SourceHealth`, `SourceTailResult`) and `src/backend/sources/codex/CodexSource.ts` from Phase 1 (`docs/plans/2026-05-31-session-source-adapter-phase-1-codex-source-extraction.md`). If that doc/code is not present at kickoff, STOP and confirm Phase 1 is landed first — Phase 2 cannot register a source without a `SessionSource` implementation. The registry is generic over the `SessionSource` interface and does not import `CodexSource` directly except at the single wiring/composition point (the registry is constructed from an array the API layer assembles).

## Naming Collision — READ BEFORE TOUCHING THE `source` QUERY PARAM

**The `source` query param name is already taken.** Today `/api/sessions` reads `?source=` and maps it to `SessionFilter.threadSource` (`"user" | "subagent"`) — see `src/backend/api/sessions.ts:70` (`parseEnum(url.searchParams.get("source"), "source", sourceValues)`) and `src/frontend/api/client.ts:132` (`appendParam(params, "source", filter.threadSource)`). The new `SourceId` dispatch ALSO wants a `source` discriminator.

**Decision for this phase:** the `SourceId` dispatch discriminator travels as the query param **`sourceId`** (values `"codex" | "claude-code"`), default `"codex"` when absent. The existing `source` → `threadSource` param is left untouched so the locked `SessionFilter.threadSource` axis keeps working. The contract field is still named `SessionSummary.source` / `SessionFilter.source` exactly as locked in the overview — only the wire query-param key differs to avoid the collision. Document this on every handler. (Renaming the in-flight `threadSource` param would be a larger, out-of-scope wire change.)

---

## Source of Truth: Locked Contract Deltas (from the overview — do not rename)

```ts
// src/shared/contracts.ts
export type SourceId = "codex" | "claude-code";

// SessionSummary gains:
//   source: SourceId;            // REQUIRED on new code paths; absent ⇒ treated as "codex" (back-compat)
// SessionFilter gains:
//   source?: SourceId;           // narrows the merged list to one tool
// EdgeSource changes:
export type EdgeSource = "native" | "reconstructed";   // was "codex" | "reconstructed"
//   ("native" = edge came from the tool's own data, e.g. Codex thread_spawn_edges OR CC subagent meta;
//    "reconstructed" = inferred by Agentview. SessionSummary.source says which tool.)
```

```ts
// src/backend/sources/registry.ts  (LOCKED — implement verbatim)
import type { PageOptions, SessionFilter, SessionSummary, SourceId } from "../../shared/contracts";
import type { SessionSource, SourceHealth } from "./SessionSource";

export interface SourceRegistry {
  get(source: SourceId): SessionSource;            // throws on unknown source
  has(source: SourceId): boolean;
  all(): SessionSource[];
  listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]>; // fan-out + merge by updatedAtMs desc
  getHealth(): Promise<SourceHealth[]>;
  close(): Promise<void>;
}

export const createSourceRegistry = (sources: SessionSource[]): SourceRegistry => { /* … */ };
```

**Dispatch rule:** API handlers read the `sourceId` query param (default `"codex"`), validate it against `SourceId`, and call `registry.get(sourceId)`. Native ids stay **unprefixed**; the `(source, id)` pair is the composite key. For the merged list, when `filter.source` is omitted the registry fans out across `all()` and merges by `updatedAtMs` desc. When `filter.source` is set, the registry delegates to that single source.

---

## File Map

- Modify: `src/shared/contracts.ts` — add `SourceId`; add `source: SourceId` to `SessionSummary` and `source?: SourceId` to `SessionFilter`; change `EdgeSource` to `"native" | "reconstructed"`; update the two doc-comments on `parentEdgeSource` / `AgentEdge.source` that say "codex".
- Modify: `src/backend/sqlite/stateStore.ts` — line ~164 `parentEdgeSource: realParentId ? "codex" : ...` → `"native"`; stamp `source: "codex"` on every `SessionSummary` the store returns (`getThread`, `listSessions` rows).
- Modify: `src/backend/api/agentGraph.ts` — `EdgeSource` import/usage now resolves to the new union; no literal `"codex"` to change here (it forwards `row.edgeSource`), but confirm typecheck.
- Modify: `src/frontend/views/SessionsView.tsx` — `session.parentEdgeSource === "reconstructed"` keeps working (the "native" branch is the else); confirm no `=== "codex"` literal exists (it does not) and typecheck passes.
- Create: `src/backend/sources/registry.ts` — `createSourceRegistry` + `SourceRegistry` impl (fan-out/merge, get/has/all/getHealth/close).
- Create: `src/backend/sources/sourceQuery.ts` — `parseSourceId(url): { ok: true; source: SourceId } | { ok: false; message: string }` (default `"codex"`, typed 400 message on unknown), shared by all handlers.
- Modify: `src/backend/api/sessions.ts` — parse `sourceId`; dispatch single-source list/lookup through `registry.get(source)`; merged list (no `filter.source`) via `registry.listSessions`.
- Modify: `src/backend/api/timeline.ts` — parse `sourceId`; resolve/parse through the dispatched source instead of calling `resolveCodexHome`/`openStateStore`/`parseRolloutFile` directly. (Codex source wraps that existing logic from Phase 1.)
- Modify: `src/backend/api/health.ts` — parse `sourceId` if present; otherwise report `registry.getHealth()` across all sources (single Codex entry this phase).
- Modify: `src/backend/api/stream.ts` — thread `sourceId` (default `"codex"`) through the subscribe request so live updates dispatch by source.
- Modify: `src/backend/live/liveSources.ts` — carry an optional `source: SourceId` on the subscribe request/filter; default `"codex"`; no behavior change with one source.
- Modify: `src/backend/server.ts` — construct the registry once (`createSourceRegistry([createCodexSource(...)])`) and pass it to the handlers (or expose a shared accessor mirroring the existing per-request `openStateStore` pattern; see Service Wiring note).
- Modify: `src/frontend/api/client.ts` — `buildSessionQuery` appends `sourceId` from `filter.source`; `listSessions`/`getThread`/`getTimeline`/`getAgentGraph` carry `sourceId` when set.
- Test: `tests/unit/sourceRegistry.test.ts`, `tests/unit/sourceQuery.test.ts`, `tests/unit/contracts.test.ts` (extend), `tests/integration/sourceDispatch.test.ts`, `tests/integration/reconstructedEdges.test.ts` (update `"codex"` → `"native"` expectations).
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-2.md` — acceptance evidence packet.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Source-scoped session list | Sessions table | `registry.get("codex").listSessions` (via `sourceId`) | `state_5.sqlite.threads` | None | Read-only SQLite (Codex) | Integration test: `?sourceId=codex` returns same rows; `?sourceId=claude-code` returns typed 400. |
| Merged session list (fan-out) | Sessions table (default view) | `registry.listSessions` (no `filter.source`) | `state_5.sqlite.threads` | None | Read-only SQLite (one source) | Integration test: omitting `sourceId`/`filter.source` fans out across `all()` and merges by `updatedAtMs` desc. |
| Default-source back-compat | Existing links / cache | dispatch defaults to `"codex"` | `state_5.sqlite` | None | Read-only SQLite | Integration test: request with no `sourceId` resolves Codex; `SessionSummary` without `source` treated as `"codex"`. |
| Session lookup `(source, id)` | Row click → detail | `registry.get(source).getSession(id)` | `state_5.sqlite.threads` | None | Read-only SQLite | Integration test: `(codex, id)` resolves the row; unknown source 400. |
| Timeline dispatch | Timeline view | `registry.get(source)` resolve+parse | rollout cache / JSONL | None | `$CODEX_HOME` rollout | Integration test: timeline for a Codex thread renders unchanged via dispatch. |
| Agent graph edge origin | Graph view edges | `deriveAgentGraph` forwarding `edgeSource` | `state_5.sqlite.thread_spawn_edges` | None | Read-only SQLite | Integration/e2e: Codex spawn edges now report `source: "native"`. |

## E2E Harness Readiness

Reuse the existing Phase 2 (Codex) Playwright harness and temp `$CODEX_HOME` fixture (`tests/fixtures/codexHome.ts`). No new e2e fixtures are required: the dispatch seam is generic but only Codex is registered, so `@sessions` and `@graph` specs must pass unchanged. The only assertion delta is in `@graph`: any spec/DOM that asserted an edge origin of `"codex"` must now assert `"native"` (search the e2e specs during Task 1).

---

### Task 1: Contracts Changes + `EdgeSource` Rename Reference Sweep

**Depends On:** Phase 1 acceptance (CodexSource + SessionSource.ts present)

**Execution:** phase-owner only (breaking type change); parallel with none — gates Tasks 2–4; checkpoint `npm run typecheck && npm run test -- --run tests/integration/reconstructedEdges.test.ts`

**Files:**
- Modify: `src/shared/contracts.ts`, `src/backend/sqlite/stateStore.ts`, `src/backend/api/agentGraph.ts`, `src/frontend/views/SessionsView.tsx`
- Test: `tests/unit/contracts.test.ts`, `tests/integration/reconstructedEdges.test.ts`

**Service Wiring Rows Covered:**
- Default-source back-compat
- Agent graph edge origin

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run tests/unit/contracts.test.ts tests/integration/reconstructedEdges.test.ts`
- Expected result: contracts compile with the new `SourceId`, `source` fields, and `EdgeSource = "native" | "reconstructed"`; every old `"codex"` edge literal is gone; Codex spawn edges report `"native"`.
- Evidence to collect: typecheck output, focused test output, the grep-sweep result showing zero remaining `EdgeSource = "codex"` literals.

**Test Mode Disclosure:**
- Automated tests: real local temp SQLite fixture (Codex)
- Production/dev path exercised: yes — same state store and agent-graph derivation
- Mock-only risk: none beyond existing Codex schema-drift risk
- Required real dependencies: local `node:sqlite` and temp filesystem
- Blocking if unavailable: yes

- [ ] Step 1: Write a failing `tests/unit/contracts.test.ts` assertion (type-level + value) that a `SessionSummary` carries `source: "codex"` and that `EdgeSource` accepts `"native"` (e.g. a `const e: EdgeSource = "native"` and an `AgentEdge` with `source: "native"`). Add a failing case asserting a thread-spawn edge's `parentEdgeSource` is `"native"` (not `"codex"`).
- [ ] Step 2: Update `tests/integration/reconstructedEdges.test.ts`: change `expect(child?.parentEdgeSource).toBe("codex")` (line ~69) to `toBe("native")` and `?.source ?? "codex").toBe("codex")` (line ~99) to the `"native"` equivalents. Run `npm run test -- --run tests/integration/reconstructedEdges.test.ts tests/unit/contracts.test.ts` and confirm failures (old literals still in source).
- [ ] Step 3: In `src/shared/contracts.ts`: add `export type SourceId = "codex" | "claude-code";`; add `source: SourceId;` to `SessionSummary` (place near `id`); add `source?: SourceId;` to `SessionFilter`; change `export type EdgeSource = "codex" | "reconstructed";` → `export type EdgeSource = "native" | "reconstructed";`; update the two doc-comments referencing `"codex"` on `parentEdgeSource` and `AgentEdge.source` to say `"native"`.
- [ ] Step 4: Reference sweep — run `grep -rn "EdgeSource" src/ tests/`, `grep -rn 'parentEdgeSource' src/ tests/`, `grep -rn 'edgeSource' src/ tests/`, and `grep -rn '"codex"' src/ tests/ | grep -iv codexHome` and resolve each edge-origin hit: `src/backend/sqlite/stateStore.ts:~164` `parentEdgeSource: realParentId ? "codex" : ...` → `"native"`; confirm `src/backend/sqlite/stateStore.ts:~673` already uses `"reconstructed"` (no change). Also grep the e2e specs (`grep -rn '"codex"' tests/e2e/`) for any edge-origin assertion and update to `"native"`.
- [ ] Step 5: In `src/backend/sqlite/stateStore.ts`, stamp `source: "codex"` on every returned `SessionSummary` (the `normalizeRow`/`getThread`/`listSessions` row builder near line ~152) so the required `source` field is populated; confirm `SessionsView.tsx` `parentEdgeSource === "reconstructed"` branch (line ~360) still typechecks (the "native" case is the untaken else, no literal to change).
- [ ] Step 6: Run `npm run typecheck && npm run test -- --run tests/unit/contracts.test.ts tests/integration/reconstructedEdges.test.ts && npm run lint` and confirm green.
- [ ] Step 7: Commit this task. Suggested message: `feat(contracts): add SourceId + rename EdgeSource codex→native`

### Task 2: `createSourceRegistry` + Fan-Out/Merge Unit Tests

**Depends On:** Task 1

**Execution:** sub-agent lane: Registry; parallel with Task 3 backend after registry signature is stable; checkpoint `npm run test -- --run tests/unit/sourceRegistry.test.ts`

**Files:**
- Create: `src/backend/sources/registry.ts`
- Test: `tests/unit/sourceRegistry.test.ts`

**Service Wiring Rows Covered:**
- Merged session list (fan-out)
- Session lookup `(source, id)`

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/sourceRegistry.test.ts`
- Expected result: `get` returns the matching source and throws a typed error on unknown id; `has` reflects registration; `all()` returns sources in registration order; `listSessions` fans out across all sources and merges by `updatedAtMs` desc; `getHealth` aggregates; `close` closes every source.
- Evidence to collect: focused test output.

**Test Mode Disclosure:**
- Automated tests: fake in-memory `SessionSource` stubs implementing the locked interface
- Production/dev path exercised: yes — the real `createSourceRegistry` under test, fed by stubs
- Mock-only risk: stubs may diverge from `CodexSource`'s real behavior — covered by Task 3 integration against the real Codex source
- Required real dependencies: none (pure unit)
- Blocking if unavailable: no

- [ ] Step 1: Write `tests/unit/sourceRegistry.test.ts` with two fake `SessionSource`s (`id: "codex"`, `id: "claude-code"`) returning canned `SessionSummary[]` with interleaved `updatedAtMs`. Failing assertions: `get("codex")` returns the codex stub; `get("claude-code")` returns the cc stub; `get("unknown" as SourceId)` throws with a message naming the unknown id; `has("claude-code") === true`, `has("git" as SourceId) === false`; `all()` length/order; `listSessions()` (no filter) returns both sources' rows merged by `updatedAtMs` desc; `listSessions({ source: "codex" })` returns only codex rows (single delegate, no fan-out); `getHealth()` returns one entry per source; `close()` calls each source's `close`.
- [ ] Step 2: Run `npm run test -- --run tests/unit/sourceRegistry.test.ts` and confirm failures (module missing).
- [ ] Step 3: Implement `src/backend/sources/registry.ts` verbatim to the locked `SourceRegistry` interface. `createSourceRegistry(sources)` builds a `Map<SourceId, SessionSource>` keyed by `source.id`. `get` throws `new Error(...)` (typed) when absent; `has` checks the map; `all` returns `[...map.values()]` in insertion order. `listSessions(filter, page)`: if `filter?.source` set, delegate to that one source's `listSessions(filter, page)`; else `Promise.all(all().map(s => s.listSessions(filter, page)))`, flatten, sort by `updatedAtMs` desc (treat missing `updatedAtMs` as `0` / oldest), then apply `page` (limit/offset) to the merged array. `getHealth`: `Promise.all(all().map(s => s.getHealth()))`. `close`: `Promise.all(all().map(s => s.close()))`.
- [ ] Step 4: Run `npm run test -- --run tests/unit/sourceRegistry.test.ts && npm run typecheck` and confirm green.
- [ ] Step 5: Commit this task. Suggested message: `feat(sources): add createSourceRegistry fan-out dispatch`

### Task 3: API Dispatch by `sourceId` + Client Carries Source + Integration Tests

**Depends On:** Task 2

**Execution:** sub-agent lane: API + client dispatch; parallel with none; checkpoint `npm run test -- --run tests/integration/sourceDispatch.test.ts`

**Files:**
- Create: `src/backend/sources/sourceQuery.ts`
- Modify: `src/backend/api/sessions.ts`, `src/backend/api/timeline.ts`, `src/backend/api/health.ts`, `src/backend/api/stream.ts`, `src/backend/live/liveSources.ts`, `src/backend/server.ts`, `src/frontend/api/client.ts`
- Test: `tests/unit/sourceQuery.test.ts`, `tests/integration/sourceDispatch.test.ts`, `tests/integration/sessionsApi.test.ts` (extend)

**Service Wiring Rows Covered:**
- Source-scoped session list
- Merged session list (fan-out)
- Default-source back-compat
- Session lookup `(source, id)`
- Timeline dispatch

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/sourceQuery.test.ts tests/integration/sourceDispatch.test.ts tests/integration/sessionsApi.test.ts`
- Expected result: missing `sourceId` defaults to `"codex"`; `?sourceId=codex` and the no-source merged list both return the existing Codex rows; `?sourceId=claude-code` (unregistered) returns a typed `400`; timeline/agent-graph for a Codex thread resolve through the dispatched source unchanged; client `buildSessionQuery` emits `sourceId` from `filter.source` without colliding with the existing `source`→`threadSource` param.
- Evidence to collect: integration test output, a manual `curl` (or test) capture of the `400` body for an unknown source.

**Test Mode Disclosure:**
- Automated tests: real local API against temp SQLite fixture (Codex), spawned like `tests/integration/sessionsApi.test.ts`
- Production/dev path exercised: yes — HTTP handlers → registry → CodexSource → state store
- Mock-only risk: `claude-code` unregistered-source path is the only synthetic case; it is the real production behavior this phase (CC lands Phase 3)
- Required real dependencies: local HTTP runtime, `node:sqlite`, temp filesystem
- Blocking if unavailable: yes

- [ ] Step 1: Write `tests/unit/sourceQuery.test.ts` for `parseSourceId(url)`: absent `sourceId` → `{ ok: true, source: "codex" }`; `?sourceId=codex` → `"codex"`; `?sourceId=claude-code` → `"claude-code"` (valid `SourceId`, registry decides registration); `?sourceId=bogus` → `{ ok: false, message }`. Run and confirm failure (module missing).
- [ ] Step 2: Implement `src/backend/sources/sourceQuery.ts` exporting `parseSourceId(url: URL)` validating against the `SourceId` union (set `{"codex","claude-code"}`), defaulting to `"codex"`, returning a typed `{ ok:false, message }` for any other value. Run `npm run test -- --run tests/unit/sourceQuery.test.ts` and confirm green.
- [ ] Step 3: Write failing `tests/integration/sourceDispatch.test.ts` (mirror `sessionsApi.test.ts` spawn-API harness): (a) `GET /api/sessions` (no `sourceId`) returns the fixture Codex rows; (b) `GET /api/sessions?sourceId=codex` returns the same rows; (c) `GET /api/sessions?sourceId=claude-code` returns HTTP `400` with a typed `code` (e.g. `UNKNOWN_SOURCE`); (d) `GET /api/sessions?sourceId=bogus` returns `400`; (e) `GET /api/timeline?threadId=<codex>&sourceId=codex` returns the same timeline as without `sourceId`; (f) `GET /api/agent-graph?rootThreadId=<codex>` edges report `source: "native"`. Run and confirm failures.
- [ ] Step 4: Build the registry composition: in `src/backend/server.ts` (or a small `src/backend/sources/defaultRegistry.ts` accessor mirroring the per-request `openStateStore` pattern) construct `createSourceRegistry([ /* CodexSource from Phase 1 */ ])`. Keep the existing per-request open/close lifecycle: the registry/handlers must `close()` Codex resources per request exactly as today (no shared long-lived handle regression).
- [ ] Step 5: Re-point handlers through the registry:
  - `src/backend/api/sessions.ts`: call `parseSourceId(url)` → `400` on `!ok`; if a single-thread lookup, `registry.get(source).getSession(id)`; for the list, if `filter.source` set use `registry.get(filter.source).listSessions(...)` else `registry.listSessions(...)` (merged fan-out). Wire `filter.source` from the parsed `sourceId` (so `?sourceId=codex` narrows; absent ⇒ merged). Return `404` for unknown thread, `400` for unknown/invalid source. Leave the existing `source`→`threadSource` parse intact.
  - `src/backend/api/timeline.ts`: `parseSourceId` → `registry.get(source)`; resolve+parse through the source (CodexSource wraps the existing `resolveCodexHome`/`resolveRolloutPath`/`getRolloutFactsWithCache`/`tailRolloutFile` logic). Behavior identical for `"codex"`.
  - `src/backend/api/health.ts`: `parseSourceId`; report `registry.getHealth()` (one Codex entry this phase) or the single source's health when `sourceId` is set.
  - `src/backend/api/stream.ts` + `src/backend/live/liveSources.ts`: thread an optional `source: SourceId` (default `"codex"`) onto the subscribe request/filter; dispatch the live source by id; no behavior change with one source.
- [ ] Step 6: Update `src/frontend/api/client.ts`: in `buildSessionQuery` add `appendParam(params, "sourceId", filter.source)` (distinct from the existing `appendParam(params, "source", filter.threadSource)`); add `sourceId` to `getThread`/`getTimeline`/`getAgentGraph` query builders when the caller passes a source (extend the `ObservatoryApi` option objects minimally, default omitted ⇒ server defaults to `"codex"`).
- [ ] Step 7: Run `npm run test -- --run tests/unit/sourceQuery.test.ts tests/integration/sourceDispatch.test.ts tests/integration/sessionsApi.test.ts && npm run typecheck && npm run lint` and confirm green.
- [ ] Step 8: Run `npm run privacy:check` and confirm green (no new raw content path introduced).
- [ ] Step 9: Commit this task. Suggested message: `feat(api): dispatch sessions/timeline/graph by sourceId`

### Task 4: Phase 2 Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3

**Execution:** phase-owner only; parallel with none; checkpoint full Phase 2 command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-2.md`
- Modify: any Phase 2 files needed for integration fixes

**Service Wiring Rows Covered:**
- All rows in the Service Wiring Matrix

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run lint && npm run privacy:check && npm run e2e -- --grep @sessions && npm run e2e -- --grep @graph`
- Expected result: dispatch seam green end-to-end; no user-visible regression; Codex edges report `"native"`; unknown source returns typed `400`.
- Evidence to collect: command output, e2e artifacts, unknown-source `400` body capture, grep evidence that no `EdgeSource = "codex"` edge literal remains.

**Test Mode Disclosure:**
- Automated tests: real local API with temp SQLite fixture (Codex) + Playwright
- Production/dev path exercised: yes — browser → API → registry → CodexSource → state store
- Mock-only risk: optional real `~/.codex` validation may be skipped if local data is unavailable
- Required real dependencies: `node:sqlite`, Playwright runtime, temp filesystem
- Blocking if unavailable: yes, except optional private real-data validation

- [ ] Step 1: Create the acceptance packet with a Service Wiring table row per matrix flow and a Commits table (Tasks 1–4).
- [ ] Step 2: Run the full command set and confirm any integration failures.
- [ ] Step 3: Apply final integration fixes within Phase 2 scope.
- [ ] Step 4: Rerun the full command set and record evidence (artifact paths) into the packet, including the unknown-source `400` capture and the `EdgeSource` grep sweep.
- [ ] Step 5: Commit this task. Suggested message: `docs: record session-source-adapter phase 2 acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: contracts (`SourceId`, `source` fields, `EdgeSource = "native" | "reconstructed"`), registry, API handlers, and client compile across both tsconfigs.
- Run: `npm run test -- --run`
  Expected: unit + integration pass, including `sourceRegistry`, `sourceQuery`, `sourceDispatch`, updated `reconstructedEdges`, and existing Codex suites.
- Run: `npm run lint`
  Expected: zero warnings.
- Run: `npm run privacy:check`
  Expected: redaction guard green — raw content never leaves the server.
- Run: `npm run e2e -- --grep @sessions`
  Expected: real Sessions flow unchanged through the dispatch seam.
- Run: `npm run e2e -- --grep @graph`
  Expected: agent graph renders; Codex spawn edges report `source: "native"`.

**Required Service Wiring Coverage:**
- Source-scoped session list — integration test covers `?sourceId=codex` parity and unknown-source `400`.
- Merged session list (fan-out) — integration test covers omitted-source fan-out + `updatedAtMs` desc merge ordering.
- Default-source back-compat — integration test covers missing `sourceId` ⇒ `"codex"` and absent `SessionSummary.source` ⇒ `"codex"`.
- Session lookup `(source, id)` — integration test covers composite-key resolution and unknown-source `400`.
- Timeline dispatch — integration test covers Codex timeline parity via dispatch.
- Agent graph edge origin — integration + e2e cover `"native"` edge origin after the rename.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-2.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every applicable service-wiring row has evidence, the `EdgeSource` rename leaves zero `"codex"` edge literals (grep evidence), an unknown `sourceId` returns a typed `400`, and the acceptance packet exists with current commit evidence.
