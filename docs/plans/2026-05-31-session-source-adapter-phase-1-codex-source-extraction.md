# Session Source Adapter — Phase 1: Codex Source Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Locked contracts live in `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md` — copy the type names and signatures verbatim; never rename.

**Goal:** Introduce the `SessionSource` interface plus a `CodexSource` adapter that wraps the existing `StateStore` + rollout cache + live tail + Codex paths with **zero behavior change**, then re-point the four Codex API consumers (timeline, sessions, agentGraph, health) through a single module-level `CodexSource` instance so every response stays byte-identical.

**Phase Boundary:** This phase only extracts the seam. It adds `src/backend/sources/SessionSource.ts` (interface + `ResolvedSession` / `SourceHealth` / `SourceTailResult` types) and `src/backend/sources/codex/CodexSource.ts` (a thin delegating wrapper), then re-points `src/backend/api/health.ts`, `src/backend/api/sessions.ts`, `src/backend/api/timeline.ts`, and `src/backend/api/agentGraph.ts` to obtain their Codex primitives from `CodexSource`. The registry, the `SessionSummary.source` discriminator, `(source, id)` dispatch, the `EdgeSource` generalization, and any second source (Claude Code) are **explicitly out of scope** — they are Phase 2+. `src/backend/api/timelineRaw.ts`, `src/backend/api/tokens.ts`, `src/backend/api/diagnostics.ts`, `src/backend/live/liveSources.ts`, and `src/backend/live/liveRuntime.ts` keep their existing direct calls in this phase (they are re-pointed in later phases). Because behavior is unchanged, this phase is guarded entirely by the existing unit/integration/e2e suite — no Codex output may change.

**Why this phase matters:** It is the de-risking step — a behavior-preserving refactor that lands the adapter seam before any Claude Code code exists, fully fenced by the existing tests.

**Verification:** `npm run typecheck`, `npm run test -- --run`, focused `npm run test -- --run tests/unit/sessionSourceContract.test.ts tests/integration/codexSource.test.ts`, `npm run e2e`, `npm run lint`, `npm run privacy:check`

**Smoke-Testable Outcome:** With a temp fixture `$CODEX_HOME` (via `createCodexHomeFixture`) or a local `~/.codex`, the Sessions list, a Timeline (including `fromByte` tail and `+Subs` subtree merge), the Agent Graph, and the Health endpoint all return exactly what they returned before extraction — every existing e2e spec (`@sessions`, `@timeline`, `@graph`) stays green — while every Codex primitive now flows through one `CodexSource` instance.

**Phase Acceptance:** Full command set passes against a generated temp Codex home, and the evidence is recorded in `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-1.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks (T1, T2), but the phase owner remains responsible for sequencing, the re-point integration (T3), verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Preserve byte-identical Codex behavior for every consumer; treat any e2e/integration diff as a hard failure, not an expected change.
- Keep `CodexSource` a *pure delegating wrapper* — no new logic, no reordering of `StateStore` / cache / tail calls, no changed error shapes or status codes.
- Confirm the locked `SessionSource` signatures are copied verbatim from the overview; if a signature must change, update the overview's "Source of Truth: Locked Contracts" first.
- Verify the four re-pointed handlers still construct their responses identically (same `ok`/`fail` envelopes, same warnings ordering, same `cacheStatus`, same subtree sort).
- Leave `timelineRaw`, `tokens`, `diagnostics`, `liveSources`, `liveRuntime` untouched this phase.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Source interface | Task 1 | one sub-agent | Task 2 after the interface file lands | `src/backend/sources/SessionSource.ts` | `npm run typecheck` + `tests/unit/sessionSourceContract.test.ts` |
| Codex adapter | Task 2 | one sub-agent | none (depends on Task 1) | `src/backend/sources/codex/CodexSource.ts`, `tests/fixtures/codexHome.ts` | `tests/integration/codexSource.test.ts` |
| API re-point | Task 3 | phase-owner only | none (depends on Task 2) | `src/backend/api/{health,sessions,timeline,agentGraph}.ts` | full `npm run test -- --run` + `npm run e2e` |
| Acceptance | Task 4 | phase-owner only | none | acceptance packet, scripts | full command set |

## Codex Efficiency Rules

- Do not delegate Task 3; the re-point is the integration risk and must stay with the phase owner.
- `CodexSource` must contain no Codex-vs-other branching — there is no other source yet. Pure delegation only.
- Do not add the registry, the `source` query param, or `(source, id)` keying in this phase — those are Phase 2.
- Do not touch renderers, `contracts.ts`, the frontend, or `EdgeSource` in this phase.

## Autonomy And Escalation

| Escalation | Needed By | Agent-Owned Attempt First | Escalate Only If | Blocking Behavior |
| --- | --- | --- | --- | --- |
| Local Codex source data | Task 2, Task 4 | Use `createCodexHomeFixture` temp homes (with real rollout JSONL written under `sessions/`) and optionally validate against `$CODEX_HOME` / `~/.codex` if present. | The user requires validation against private real data and local `~/.codex` is unavailable. | Phase can complete with temp fixtures; record real-data validation as not run. |

---

## File Map

- Create: `src/backend/sources/SessionSource.ts` — the `SessionSource` interface plus `ResolvedSession`, `SourceHealth`, `SourceTailResult` (copied verbatim from the overview's locked contracts).
- Create: `src/backend/sources/codex/CodexSource.ts` — `createCodexSource({ codexHome })` returning a `SessionSource` that delegates to `openStateStore` / `getRolloutFactsWithCache` / `parseRolloutFile` / `tailRolloutFile` / `resolveCodexSourcePath`.
- Modify: `src/backend/api/health.ts` — obtain health via a module-level `CodexSource` instead of `openStateStore` directly.
- Modify: `src/backend/api/sessions.ts` — list/getSession via `CodexSource`.
- Modify: `src/backend/api/timeline.ts` — resolveSession / parse / tail / listChildren via `CodexSource`, preserving the existing subtree merge and tail logic exactly.
- Modify: `src/backend/api/agentGraph.ts` — agent-graph rows via `CodexSource.listChildren`-derived rows (or a `CodexSource` accessor over `getAgentGraphRows`), preserving `deriveAgentGraph` output.
- Test: `tests/unit/sessionSourceContract.test.ts` — type-level conformance test for the interface.
- Test: `tests/integration/codexSource.test.ts` — each `CodexSource` method equals the existing direct call against a temp `createCodexHomeFixture`.
- Reuse: `tests/fixtures/codexHome.ts` — temp Codex home + `state_5.sqlite` builder (no changes required; add rollout JSONL files in-test where parse/tail coverage needs them).
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-1.md` — acceptance evidence packet.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Health and source availability | Header/status chrome | `handleHealthApiRequest` → `CodexSource.getHealth()` → `StateStore.getHealth` | `state_5.sqlite` pragma/schema checks | None | Temp or real `$CODEX_HOME` | Health integration test asserts identical `HealthStatus` body; `CodexSource.getHealth()` maps `StateStoreHealth` → `SourceHealth` with no field change observable to the handler. |
| Sessions list + lookup | Sessions table, row click | `handleSessionsApiRequest` → `CodexSource.listSessions` / `getSession` → `StateStore.listSessions` / `getThread` | `state_5.sqlite.threads`, `thread_spawn_edges` | None | Read-only SQLite | `tests/integration/sessionsApi.test.ts` stays green unchanged; `codexSource.test.ts` asserts `listSessions`/`getSession` equal the direct `StateStore` calls. |
| Timeline (cold/warm/stale + tail) | Timeline view, live tail polling | `handleTimelineApiRequest` → `CodexSource.resolveSession` / `parse` / `tail` | rollout JSONL + on-disk facts cache | None | Read-only filesystem + cache | `tests/integration/timelineApi.test.ts` stays green; `codexSource.test.ts` asserts `parse` equals `getRolloutFactsWithCache` and `tail` equals `tailRolloutFile`. |
| Timeline +Subs subtree | `+Subs` scope toggle | `handleTimelineApiRequest` subtree branch → `CodexSource.listChildren` + per-child `parse` | `thread_spawn_edges` + descendant rollouts | None | Read-only SQLite + filesystem | e2e `@timeline` +Subs assertion stays green; merged event order byte-identical. |
| Agent graph | Agent Graph view | `handleAgentGraphApiRequest` → `CodexSource` agent-graph rows → `deriveAgentGraph` | `thread_spawn_edges`, reconstructed overlay | None | Read-only SQLite + overlay | `tests/integration/graphTokensApi.test.ts` + e2e `@graph` stay green; `deriveAgentGraph` input rows unchanged. |

## E2E Harness Readiness

Reuse the existing Playwright config and the temp `$CODEX_HOME` fixture wiring already used by `tests/e2e/sessions-index.spec.ts`, `timeline-detail.spec.ts`, and `graph-tokens.spec.ts`. No new e2e specs are added — the entire point of this phase is that the existing specs pass unchanged. The phase owner runs the full `npm run e2e` to prove no behavior drift across `@sessions`, `@timeline`, and `@graph`.

---

### Task 1: Define the `SessionSource` interface and adapter types

**Depends On:** Locked-contracts section of `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md`

**Execution:** sub-agent lane: Source interface; parallel with none initially; checkpoint `npm run typecheck && npm run test -- --run tests/unit/sessionSourceContract.test.ts`

**Files:**
- Create: `src/backend/sources/SessionSource.ts`
- Test: `tests/unit/sessionSourceContract.test.ts`

**Service Wiring Rows Covered:**
- Health and source availability (type surface only this task)

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run tests/unit/sessionSourceContract.test.ts`
- Expected result: the interface compiles against `src/shared/contracts.ts` imports, the type-level conformance test passes, and the exported names match the locked overview exactly.
- Evidence to collect: typecheck output and the focused test result.

**Test Mode Disclosure:**
- Automated tests: type-level conformance (compile-time assignability) plus a runtime no-op assertion so Vitest registers the spec.
- Production/dev path exercised: yes — this is the real interface the handlers will import in Task 3.
- Mock-only risk: none; the interface has no runtime behavior.
- Required real dependencies: TypeScript compiler.
- Blocking if unavailable: yes — Task 2 imports this interface.

- [ ] Step 1: Write `tests/unit/sessionSourceContract.test.ts` that imports the interface and the adapter types, then asserts (at compile time, via a typed `satisfies`/assignability fixture object and exported type aliases) that: `SourceHealth` has `{ source: SourceId; available: boolean; detail?: string }`; `ResolvedSession` has `{ source: SourceId; sessionId: string; rawLogPath: string; extra?: Record<string, unknown> }`; `SourceTailResult` has `{ events: TimelineEvent[]; nextByte: number; nextLine: number }`; and a `const _shape: SessionSource = { ... }` literal exercises every method signature (`id`, `getHealth`, `listSessions`, `getSession`, `resolveSession`, `parse`, `listChildren`, `tail`, `close`). Add one runtime `expect(true).toBe(true)` so the file is a valid spec. Confirm it fails (module does not exist yet).
- [ ] Step 2: Run `npm run test -- --run tests/unit/sessionSourceContract.test.ts` and confirm the failure is the missing module / unresolved import.
- [ ] Step 3: Create `src/backend/sources/SessionSource.ts` copying the locked contract verbatim:
  - `import type { CachedRolloutFacts, PageOptions, SessionFilter, SessionSummary, SourceId, TimelineEvent } from "../../shared/contracts";`
  - `export interface SourceHealth { source: SourceId; available: boolean; detail?: string; }`
  - `export interface ResolvedSession { source: SourceId; sessionId: string; rawLogPath: string; extra?: Record<string, unknown>; }`
  - `export interface SourceTailResult { events: TimelineEvent[]; nextByte: number; nextLine: number; }`
  - `export interface SessionSource { readonly id: SourceId; getHealth(): Promise<SourceHealth>; listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]>; getSession(sessionId: string): Promise<SessionSummary | null>; resolveSession(sessionId: string): Promise<ResolvedSession>; parse(resolved: ResolvedSession): Promise<CachedRolloutFacts>; listChildren(rootSessionId: string, scanDepth: number): Promise<SessionSummary[]>; tail(resolved: ResolvedSession, fromByte: number): Promise<SourceTailResult>; close(): Promise<void>; }`
  - NOTE: `SourceId` already exists in `src/shared/contracts.ts` only from Phase 2 onward. **In Phase 1 it does not yet exist**, so this file must define a local `export type SourceId = "codex" | "claude-code";` *only if* the contracts type is absent. Verify first: `grep -n "export type SourceId" src/shared/contracts.ts`. If present, import it; if absent (expected in Phase 1), declare it inline in `SessionSource.ts` with the exact union `"codex" | "claude-code"` so Phase 2 can move it to contracts without a rename. Do **not** add `SourceId` to `contracts.ts` in this phase.
- [ ] Step 4: Run `npm run typecheck && npm run test -- --run tests/unit/sessionSourceContract.test.ts` and confirm both pass.
- [ ] Step 5: Commit this task. Suggested message:

  ```
  feat(sources): add SessionSource interface and adapter types

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

### Task 2: Implement `CodexSource` as a pure delegating wrapper

**Depends On:** Task 1

**Execution:** sub-agent lane: Codex adapter; parallel with none (depends on Task 1); checkpoint `npm run test -- --run tests/integration/codexSource.test.ts`

**Files:**
- Create: `src/backend/sources/codex/CodexSource.ts`
- Test: `tests/integration/codexSource.test.ts`
- Reuse: `tests/fixtures/codexHome.ts`

**Service Wiring Rows Covered:**
- Health and source availability
- Sessions list + lookup
- Timeline (cold/warm/stale + tail)
- Timeline +Subs subtree
- Agent graph

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/codexSource.test.ts`
- Expected result: every `CodexSource` method returns exactly what the existing direct call returns against the same temp Codex home — health maps cleanly, session rows are identical, parsed facts are deep-equal, tail payloads match, and derived children match the `getAgentGraphRows` projection.
- Evidence to collect: focused test output plus a note of which methods are covered by deep-equality vs. structural assertions.

**Test Mode Disclosure:**
- Automated tests: real local temp `state_5.sqlite` fixture plus real rollout JSONL files written into the temp home for `parse`/`tail` coverage.
- Production/dev path exercised: yes — `CodexSource` is the same module the handlers import in Task 3.
- Mock-only risk: private Codex schema drift may differ from the fixture; mitigated by the optional `~/.codex` smoke in Task 4.
- Required real dependencies: `node:sqlite`, temp filesystem.
- Blocking if unavailable: yes for the Codex extraction phase.

- [ ] Step 1: Write `tests/integration/codexSource.test.ts` with one `describe` per method, each building a `createCodexHomeFixture` temp home (threads + edges; for parse/tail, also write a small rollout JSONL under `sessions/<id>.jsonl` using `observedEventMsg`/`observedResponseItem` envelopes) and asserting equality against the existing primitive:
  - `getHealth()` → `{ source: "codex", available: true }` and `detail` undefined when `StateStore.getHealth()` resolves; `available: false` with a `detail` message when `openStateStore` throws a `StateStoreError` (e.g. via `createUnsupportedCodexHomeFixture`).
  - `listSessions(filter, page)` deep-equals `(await openStateStore({ codexHome })).listSessions(filter, page)` for a representative filter (search + archived + token bounds) and page.
  - `getSession(id)` deep-equals `StateStore.getThread(id)`; missing id → `null`.
  - `resolveSession(id)` returns `{ source: "codex", sessionId: id, rawLogPath }` where `rawLogPath` equals the path the timeline handler resolves today (absolute path under the temp home), and rejects a traversal path the same way the current resolution does.
  - `parse(resolved)` deep-equals `getRolloutFactsWithCache({ codexHome, threadId, rolloutPath, parse: parseRolloutFile(...) }).facts` (set a distinct `AGENTVIEW_CACHE_ROOT` temp dir per test so cache state is isolated).
  - `listChildren(rootId, scanDepth)` returns children derived from `StateStore.getAgentGraphRows(rootId, scanDepth)` matching the child set the timeline subtree branch computes today (unique non-root `childThreadId`s, as `SessionSummary[]` via `getSession`).
  - `tail(resolved, fromByte)` produces a `SourceTailResult` whose `events` equal `tailRolloutFile(...).payload.events`, `nextByte` equals `payload.nextByteOffset`, and `nextLine` equals the running line counter (`linesRead`-advanced) the handler uses.
  - `close()` closes the underlying store (assert a second `getHealth()`/query after close behaves like the direct store after `close()`).
  Confirm the suite fails (module missing).
- [ ] Step 2: Run `npm run test -- --run tests/integration/codexSource.test.ts` and confirm failures are the missing `CodexSource` module.
- [ ] Step 3: Implement `src/backend/sources/codex/CodexSource.ts`:
  - `export const createCodexSource = ({ codexHome }: { codexHome: string }): SessionSource => { ... }` — lazily open and memoize one `StateStore` (`let storePromise: Promise<StateStore> | null`) so repeated calls reuse the connection and `close()` disposes it.
  - `id: "codex"`.
  - `getHealth`: call `StateStore.getHealth()`; on success return `{ source: "codex", available: true }`; catch `StateStoreError`/errors and return `{ source: "codex", available: false, detail: error.message }`. Do **not** rethrow — `available:false` is the mapped shape. (The handler in Task 3 keeps its own error→status mapping for the missing/unsupported cases; see Task 3 note on preserving status codes.)
  - `listSessions`/`getSession`: delegate to `StateStore.listSessions` / `getThread`.
  - `resolveSession`: reuse the *exact* path-resolution the timeline handler uses today — i.e. resolve `thread.rolloutPath` against `codexHome` with the same traversal guard (`resolveCodexSourcePath` for relative paths; the handler's absolute-path branch for already-absolute rollout paths). Return `{ source: "codex", sessionId, rawLogPath }`. Fetch the thread via `getSession` to read `rolloutPath`; throw the same errors (`ROLLOUT_MISSING` / traversal / not-readable) the handler throws today so Task 3 can keep identical status mapping.
  - `parse`: call `getRolloutFactsWithCache({ codexHome, threadId: resolved.sessionId, rolloutPath: resolved.rawLogPath, parse: (m, s) => parseRolloutFile(resolved.rawLogPath, { threadId, rolloutPath, sourceMtimeMs: m, sourceSizeBytes: s }) })` and return `.facts`. (Phase 1 returns only `facts`; the handler still needs `status`/`warnings` — see Task 3, which keeps the cache call in the handler OR has `CodexSource` expose them. Decision below in Task 3.)
  - `listChildren`: call `StateStore.getAgentGraphRows(rootSessionId, scanDepth)`, project to the unique non-root `childThreadId`s, and map each to a `SessionSummary` via `getSession`, preserving discovery order. (This mirrors the timeline subtree descendant computation.)
  - `tail`: call `tailRolloutFile({ path: resolved.rawLogPath, threadId: resolved.sessionId, fromByte, sourceLine })` and map `{ events: payload.events, nextByte: payload.nextByteOffset, nextLine: <advanced line counter> }`. Carry `truncated`/`warnings` through the handler unchanged (see Task 3).
  - `close`: if a store was opened, `await store.close()`.
- [ ] Step 4: Run `npm run typecheck && npm run test -- --run tests/integration/codexSource.test.ts` and confirm all pass.
- [ ] Step 5: Commit this task. Suggested message:

  ```
  feat(sources): wrap codex stateStore/cache/tail in CodexSource

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

### Task 3: Re-point health/sessions/timeline/agentGraph through a module-level `CodexSource`

**Depends On:** Task 2

**Execution:** phase-owner; parallel with none; checkpoint full `npm run test -- --run` + `npm run e2e`

**Files:**
- Modify: `src/backend/api/health.ts`
- Modify: `src/backend/api/sessions.ts`
- Modify: `src/backend/api/timeline.ts`
- Modify: `src/backend/api/agentGraph.ts`
- Test (existing, must stay green): `tests/integration/sessionsApi.test.ts`, `tests/integration/timelineApi.test.ts`, `tests/integration/graphTokensApi.test.ts`, `tests/integration/sourceErrors.test.ts`, `tests/integration/streamApi.test.ts`, `tests/integration/stateStore.test.ts`, `tests/e2e/sessions-index.spec.ts`, `tests/e2e/timeline-detail.spec.ts`, `tests/e2e/graph-tokens.spec.ts`

**Service Wiring Rows Covered:**
- Health and source availability
- Sessions list + lookup
- Timeline (cold/warm/stale + tail)
- Timeline +Subs subtree
- Agent graph

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run && npm run e2e`
- Expected result: every existing integration and e2e spec passes unchanged — identical envelopes, status codes, warnings, `cacheStatus`, and subtree event ordering. No spec is modified to accommodate the refactor.
- Evidence to collect: full test output, e2e summary across `@sessions`/`@timeline`/`@graph`, and a short diff-review note confirming response construction is unchanged.

**Test Mode Disclosure:**
- Automated tests: real local API against temp `state_5.sqlite` fixtures + rollout JSONL (existing harness).
- Production/dev path exercised: yes — HTTP handlers now resolve Codex primitives via `CodexSource`.
- Mock-only risk: none new; same fixtures as before.
- Required real dependencies: `node:sqlite`, Playwright runtime.
- Blocking if unavailable: yes.

**Re-point strategy (preserve byte-identical behavior):**

The handlers open a *fresh* Codex store per request today (`resolveCodexHome()` then `openStateStore({ codexHome })`, closed in a `finally`). To keep behavior identical and avoid lifecycle surprises, the module-level instance is a **per-request `CodexSource`** created from the resolved home and closed in the existing `finally`, swapped in 1:1 for the current open/close. (A single long-lived process-wide instance is deliberately deferred to Phase 2 with the registry, because the overlay/connection caching already lives inside `stateStore.ts` and changing lifecycle here would be behavior-affecting.) Concretely: replace `const store = await openStateStore({ codexHome })` with `const source = createCodexSource({ codexHome })`, replace `store.getThread` → `source.getSession`, `store.listSessions` → `source.listSessions`, `store.getHealth` → `source.getHealth` (mapping back to the handler's `HealthStatus`/status-code logic), `store.getAgentGraphRows` (timeline subtree + agentGraph) via the path described per-handler below, and `await store.close()` → `await source.close()`.

- [ ] Step 1 (health): Re-point `handleHealthApiRequest` to `createCodexSource({ codexHome }).getHealth()`. Because the handler must still emit `503` for `STATE_DB_MISSING`/`SCHEMA_UNSUPPORTED` and build `stateDb: health.schema` for the body, expose the underlying `StateStoreHealth.schema` too — add a narrow `getStateDbHealth()` accessor on `CodexSource` *or* keep the handler's `catch` mapping by having `getHealth()` rethrow the original `StateStoreError` while still offering the mapped `SourceHealth` (decision: keep the handler's existing `try/catch` and error→status mapping verbatim, and have `CodexSource` provide a `getHealth()` that returns `SourceHealth` plus the raw `schema`; simplest is to let the health handler read `schema` via a tiny `CodexSource.schema()` helper). Confirm `tests/integration/sourceErrors.test.ts` and the health assertions in the e2e shell still pass. Run `npm run test -- --run tests/integration/sourceErrors.test.ts`.
- [ ] Step 2 (sessions): Re-point `handleSessionsApiRequest` list + lookup to `source.listSessions(filter, page)` and `source.getSession(threadId)`. Keep all query parsing, `INVALID_FILTER`/`THREAD_NOT_FOUND`/`405` branches, and `writeStateStoreError` mapping unchanged. Run `npm run test -- --run tests/integration/sessionsApi.test.ts` and confirm green.
- [ ] Step 3 (timeline): Re-point `handleTimelineApiRequest`:
  - Replace the in-handler `resolveRolloutPath` + `getThread` rollout lookup with `source.getSession(threadId)` (for the 404/`ROLLOUT_MISSING` branches) and `source.resolveSession(threadId)` for `rawLogPath`, keeping the existing error names (`RolloutNotFoundError`/`RolloutPathTraversalError`) and status mapping.
  - Replace the cold/warm path `getRolloutFactsWithCache(...)` with `source.parse(resolved)` — but the handler needs `cached.status` and `cached.warnings` for the response. **Decision:** to keep byte-identical `cacheStatus` and warnings without enlarging the locked `parse` signature, leave the `getRolloutFactsWithCache` call in the handler for the *status/warnings*-bearing cold path, and use `source.parse` only where a bare `CachedRolloutFacts` suffices (the subtree descendants, which today discard `status` and only concat `events`/`warnings`). Document this split in the acceptance packet. Alternatively (cleaner, still in-scope) have `CodexSource` expose the full `RolloutCacheResult` via an internal helper the handler calls, while `parse` (the locked method) returns `.facts`. Pick one and keep `cacheStatus`/warnings ordering identical.
  - Replace the subtree descendant discovery (`store.getAgentGraphRows` → unique child ids → per-child `getThread` + `resolveRolloutPath` + parse) with `source.listChildren(threadId, MAX_SUBTREE_DEPTH)` for the child `SessionSummary`s, then `source.resolveSession` + `source.parse` per descendant. Preserve the exact event merge + sort comparator.
  - Replace the tail branch `tailRolloutFile(...)` with `source.tail(resolved, fromByte)` using `sourceLine: cached.facts.events.length + 1`, mapping `nextByte`→`nextByteOffset` and carrying tail warnings in the same order.
  - Run `npm run test -- --run tests/integration/timelineApi.test.ts tests/integration/liveTail.test.ts` and confirm green.
- [ ] Step 4 (agentGraph): Re-point `handleAgentGraphApiRequest`. `deriveAgentGraph` consumes `AgentGraphRow[]` from `store.getAgentGraphRows(rootThreadId, maxDepth + 1)`. Since the locked `SessionSource` has no `getAgentGraphRows`, expose the raw rows via a narrow `CodexSource` accessor (e.g. `getAgentGraphRows(rootId, scanDepth)` that delegates to the store) **kept alongside** the locked `listChildren` — this is a Codex-internal accessor, not part of the cross-source interface, and is acceptable because Phase 1 must not change `deriveAgentGraph`'s input. (Phase 5 generalizes graph derivation for CC; not now.) Run `npm run test -- --run tests/integration/graphTokensApi.test.ts tests/unit/agentGraph.test.ts` and confirm green.
- [ ] Step 5: Run the full suite and e2e: `npm run typecheck && npm run lint && npm run test -- --run && npm run e2e && npm run privacy:check`. Confirm everything is green with no spec edits.
- [ ] Step 6: Commit this task. Suggested message:

  ```
  refactor(api): route codex consumers through CodexSource

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

### Task 4: Integrate Phase 1 acceptance packet

**Depends On:** Task 1, Task 2, Task 3

**Execution:** phase-owner; parallel with none; checkpoint full Phase 1 command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-1.md`
- Modify: any Phase 1 file needed for integration fixes (no contract or behavior changes)

**Service Wiring Rows Covered:**
- Health and source availability
- Sessions list + lookup
- Timeline (cold/warm/stale + tail)
- Timeline +Subs subtree
- Agent graph

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run lint && npm run test -- --run && npm run e2e && npm run privacy:check`
- Expected result: the whole suite passes with no spec edits; the packet records that Codex behavior is byte-identical and that all Codex primitives now flow through `CodexSource`.
- Evidence to collect: full command output, e2e summary, the decision taken for the timeline `parse`/status split, and (optional) `~/.codex` smoke result.

**Test Mode Disclosure:**
- Automated tests: real local temp `state_5.sqlite` + rollout JSONL via existing fixtures.
- Production/dev path exercised: yes — browser → API → `CodexSource` → state store/cache/tail.
- Mock-only risk: optional real `~/.codex` validation may be skipped if local data is unavailable.
- Required real dependencies: `node:sqlite`, Playwright runtime.
- Blocking if unavailable: yes, except optional private real-data validation.

- [ ] Step 1: Create the acceptance packet with one row per service-wiring flow, each citing the command and the test/spec that proves it.
- [ ] Step 2: Run the full command set and confirm any integration failures; fix within Phase 1 scope only (no behavior or contract changes).
- [ ] Step 3: Record the timeline `parse`/`cacheStatus`+warnings decision, the agentGraph internal-accessor decision, and the per-request `CodexSource` lifecycle decision in the packet so Phase 2 inherits accurate assumptions.
- [ ] Step 4: Re-run the full command set and attach evidence (command output, e2e artifacts, optional `~/.codex` smoke).
- [ ] Step 5: Commit this task. Suggested message:

  ```
  docs: record session-source-adapter phase 1 acceptance

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: `SessionSource.ts`, `CodexSource.ts`, and the four re-pointed handlers compile under both tsconfigs.
- Run: `npm run lint`
  Expected: eslint passes with zero warnings.
- Run: `npm run test -- --run`
  Expected: unit + integration pass, including the new `sessionSourceContract` and `codexSource` specs and every unchanged Codex spec.
- Run: `npm run e2e`
  Expected: `@sessions`, `@timeline` (cold + tail + `+Subs`), and `@graph` flows pass unchanged.
- Run: `npm run privacy:check`
  Expected: redaction guard stays green — raw Codex content still never leaves the server.

**Required Service Wiring Coverage:**
- Health and source availability — health integration/e2e assertions cover `CodexSource.getHealth` mapping and the unchanged 503 error path.
- Sessions list + lookup — `sessionsApi` integration + `@sessions` e2e cover list/getSession via `CodexSource`.
- Timeline (cold/warm/stale + tail) — `timelineApi` + `liveTail` integration and `@timeline` e2e cover parse + tail via `CodexSource`.
- Timeline +Subs subtree — `@timeline` +Subs e2e covers `listChildren`-driven subtree merge with identical ordering.
- Agent graph — `graphTokensApi` + `agentGraph` unit and `@graph` e2e cover the Codex agent-graph rows unchanged.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-1.md`

**Completion Rule:** The phase cannot be marked complete until every acceptance command passes with **no existing spec modified to accommodate the refactor**, every applicable service-wiring row has evidence, the `SessionSource` signatures match the locked overview verbatim, and the acceptance packet exists with current commit evidence.
