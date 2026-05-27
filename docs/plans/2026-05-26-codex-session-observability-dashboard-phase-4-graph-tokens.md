# Codex Session Observability Dashboard Phase 4 Implementation Plan

**Goal:** Add Agent Graph and Tokens views using `thread_spawn_edges`, session metadata, and cached rollout facts from Phase 3.

**Phase Boundary:** This phase completes the graph and token product surfaces. It does not add structured diagnostics, warning badge hydration, raw TUI log access, or final cross-source hardening; those are Phase 5.

**Verification:** `npm run typecheck`, `npm run test -- --run`, `npm run e2e -- --grep @graph-tokens`

**Smoke-Testable Outcome:** A selected session shows a depth-limited Agent Graph with node selection/navigation and a Tokens view with aggregate bars, token curve, rate-limit meters, top sessions drill-down, and cached-ratio empty states.

**Phase Acceptance:** Graph and Tokens E2E flows pass with evidence saved to `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-4.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks, but the phase owner remains responsible for sequencing, integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Reuse Phase 3 cached rollout facts instead of creating duplicate parsers.
- Keep graph and token API contracts transport-neutral for future Tauri IPC.
- Verify graph depth limits and token empty states are visible and accessible.
- Preserve Sessions and Timeline behavior from earlier acceptance packets.
- Block only for allowed escalations.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Graph | Task 1, Task 3 graph portion | one sub-agent | Tokens lane after shared derived contracts are fixed | `src/backend/api/agentGraph.ts`, `src/frontend/views/AgentGraphView.tsx` | Graph unit tests and E2E graph route |
| Tokens | Task 2, Task 3 token portion | one sub-agent | Graph lane after shared derived contracts are fixed | `src/backend/api/tokens.ts`, `src/frontend/views/TokensView.tsx` | Token unit tests and E2E tokens route |
| Integration/acceptance | Task 4 | phase-owner only | None | Shared contracts, cross-view navigation, acceptance packet | Full command set |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-26-codex-session-observability-dashboard-phase-4-handoff.md`
- Required contents: current task status, branch/worktree, graph/token contract decisions, sub-agent results, verification evidence, service-wiring coverage, acceptance packet status, blockers/escalations, and exact restart instructions.

## Codex Efficiency Rules

- Parallelize graph and token lanes only after the shared Phase 3 cached facts are stable.
- Keep cross-view navigation and shared derived-contract fixes with the phase owner.
- Do not add logs DB, warning badge, or raw tail work in this phase.

## Autonomy And Escalation

| Escalation | Needed By | Agent-Owned Attempt First | Escalate Only If | Blocking Behavior |
| --- | --- | --- | --- | --- |
| Real deep agent tree sample | Task 4 | Generate fixture parent/child edges with depth >= 3 and optional local real-data validation. | The user requires private real graph validation and no local source exists. | Complete with fixtures; record real-data validation as not run. |

---

## File Map

- Modify: `src/shared/contracts.ts` - `AgentGraph`, `AgentNode`, `AgentEdge`, `TokenSeries`, token aggregate and empty-state contracts.
- Create: `src/backend/api/agentGraph.ts`, `src/backend/api/tokens.ts` - graph and token API handlers.
- Modify: `src/backend/sqlite/stateStore.ts`, `src/backend/cache/rolloutCache.ts`, `src/backend/server.ts` - edge queries, cached-fact retrieval, route registration.
- Modify: `src/frontend/api/client.ts`, `src/frontend/views/AgentGraphView.tsx`, `src/frontend/views/TokensView.tsx`, `src/frontend/styles/app.css`.
- Create: `src/frontend/components/AgentNodeCard.tsx`, `src/frontend/components/TokenChart.tsx`, `src/frontend/components/RateLimitMeter.tsx`.
- Test: `tests/unit/agentGraph.test.ts`, `tests/unit/tokenSeries.test.ts`, `tests/integration/graphTokensApi.test.ts`, `tests/e2e/graph-tokens.spec.ts`.
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-4.md`.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Agent graph render | Agent Graph view | `getAgentGraph(rootThreadId, options)` | `state_5.sqlite.thread_spawn_edges`, `threads`, optional rollout cache | None | Temp SQLite/cache fixtures | E2E renders root/depth 1/depth 2, status styling, inspector, and Timeline navigation. |
| Token series render | Tokens view | `getTokenSeries(threadId)` | rollout cache facts and session summaries | None | Temp JSONL/cache fixtures | E2E renders aggregates, curve, rate meters, cached-ratio empty state, drill-down. |
| Cross-view navigation | Graph nodes and token top sessions | Shared app route/selection state | Existing session state | None | Browser runtime | Playwright double-click/click routes to selected Timeline. |

## E2E Harness Readiness

Extend existing Playwright fixtures with parent/child edge rows and rollout token snapshots. Use the same temp `$CODEX_HOME` and cache fixtures from Phases 2-3 so the browser flow proves real service wiring.

### Task 1: Add Agent Graph API And Derivation

**Depends On:** Phase 3 acceptance packet

**Execution:** sub-agent lane: Graph; parallel with Task 2 after shared contracts are fixed; checkpoint graph tests

**Files:**
- Modify: `src/shared/contracts.ts`, `src/backend/sqlite/stateStore.ts`
- Create: `src/backend/api/agentGraph.ts`
- Test: `tests/unit/agentGraph.test.ts`, `tests/integration/graphTokensApi.test.ts`

**Service Wiring Rows Covered:**
- Agent graph render

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/agentGraph.test.ts tests/integration/graphTokensApi.test.ts`
- Expected result: graph API returns canonical DB edges, child metadata, depth limit, `truncatedDepth`, open counts, and status summary.
- Evidence to collect: test output and fixture graph shape.

**Test Mode Disclosure:**
- Automated tests: real temp SQLite fixtures and optional cache facts
- Production/dev path exercised: yes, graph API and state store queries
- Mock-only risk: very large real trees may need Phase 5 performance tuning
- Required real dependencies: temp SQLite fixture
- Blocking if unavailable: yes

- [ ] Step 1: Write failing graph derivation tests for root, depth 1, depth 2, truncated depth, open/closed status, and missing child metadata.
- [ ] Step 2: Run focused tests and confirm failures.
- [ ] Step 3: Implement graph contracts, state queries, and API route.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: add agent graph api`

### Task 2: Add Token Series API And Derivation

**Depends On:** Phase 3 acceptance packet

**Execution:** sub-agent lane: Tokens; parallel with Task 1 after shared contracts are fixed; checkpoint token tests

**Files:**
- Modify: `src/shared/contracts.ts`, `src/backend/cache/rolloutCache.ts`
- Create: `src/backend/api/tokens.ts`
- Test: `tests/unit/tokenSeries.test.ts`, `tests/integration/graphTokensApi.test.ts`

**Service Wiring Rows Covered:**
- Token series render

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/tokenSeries.test.ts tests/integration/graphTokensApi.test.ts`
- Expected result: token API returns snapshots, aggregates, context utilization, rate-limit values, cached ratio only when valid, and empty-state reasons.
- Evidence to collect: test output and fixture token snapshot summary.

**Test Mode Disclosure:**
- Automated tests: real temp JSONL/cache fixtures
- Production/dev path exercised: yes, token API reads Phase 3 cached facts
- Mock-only risk: missing real token fields may only appear in private data
- Required real dependencies: temp filesystem/cache fixtures
- Blocking if unavailable: yes

- [ ] Step 1: Write failing token derivation tests for aggregate totals, cached ratio guards, rate limits, context utilization, and missing-data empty states.
- [ ] Step 2: Run focused tests and confirm failures.
- [ ] Step 3: Implement token series derivation and API route.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: add token series api`

### Task 3: Build Graph And Tokens Views

**Depends On:** Task 1, Task 2

**Execution:** sub-agent wave: Graph and Tokens lanes; parallel between graph UI and token UI with no shared file edits except styles coordinated by phase owner; checkpoint `npm run e2e -- --grep @graph-tokens`

**Files:**
- Modify: `src/frontend/views/AgentGraphView.tsx`, `src/frontend/views/TokensView.tsx`, `src/frontend/api/client.ts`
- Create: `src/frontend/components/AgentNodeCard.tsx`, `src/frontend/components/TokenChart.tsx`, `src/frontend/components/RateLimitMeter.tsx`
- Modify: `src/frontend/styles/app.css`
- Test: `tests/e2e/graph-tokens.spec.ts`, `tests/unit/graphTokenComponents.test.tsx`

**Service Wiring Rows Covered:**
- Agent graph render
- Token series render
- Cross-view navigation

**Agent-Run Acceptance:**
- Automation command: `npm run e2e -- --grep @graph-tokens`
- Expected result: Graph and Tokens views render from real APIs, show empty states where fields are missing, and navigate to Timeline.
- Evidence to collect: Playwright traces/screenshots and DOM assertion output.

**Test Mode Disclosure:**
- Automated tests: real local API with temp SQLite, JSONL, and cache fixtures
- Production/dev path exercised: yes, browser -> graph/token APIs -> persistence/cache
- Mock-only risk: graph layout may need tuning for unusual real trees
- Required real dependencies: Playwright browser runtime
- Blocking if unavailable: yes

- [ ] Step 1: Write component/E2E tests for graph nodes/edges/inspector/navigation and token charts/meters/top sessions.
- [ ] Step 2: Run focused tests and confirm placeholder views fail.
- [ ] Step 3: Implement UI using fixed layout constraints, accessible controls, reduced-motion graph pulses, and tabular numeric token displays.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: render graph and token views`

### Task 4: Integrate Phase 4 Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3

**Execution:** phase-owner; parallel with none; checkpoint full Phase 4 command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-4.md`
- Modify: any Phase 4 files needed for integration fixes

**Service Wiring Rows Covered:**
- Agent graph render
- Token series render
- Cross-view navigation

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run e2e -- --grep @graph-tokens`
- Expected result: Phase 4 checks pass and packet records graph/token coverage plus known depth limitations.
- Evidence to collect: command output, Playwright artifacts, fixture graph/token descriptions.

**Test Mode Disclosure:**
- Automated tests: real local API with temp SQLite, JSONL, and cache fixtures
- Production/dev path exercised: yes, browser -> APIs -> DB/cache
- Mock-only risk: optional validation against real private deep graph may be skipped
- Required real dependencies: local SQLite/cache filesystem and Playwright
- Blocking if unavailable: yes

- [ ] Step 1: Create acceptance packet rows for every service-wiring flow.
- [ ] Step 2: Run full commands and capture failures.
- [ ] Step 3: Apply final integration fixes within Phase 4 scope.
- [ ] Step 4: Rerun full commands and update packet with evidence.
- [ ] Step 5: Commit this task. Suggested message: `docs: record phase 4 acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: graph/token contracts, APIs, and views compile.
- Run: `npm run test -- --run`
  Expected: graph/token unit and integration tests pass.
- Run: `npm run e2e -- --grep @graph-tokens`
  Expected: browser verifies Graph and Tokens service wiring and navigation.

**Required Service Wiring Coverage:**
- Agent graph render - integration and E2E tests cover DB edges, depth limit, open status, inspector, and Timeline navigation.
- Token series render - unit/integration/E2E tests cover cached rollout facts, aggregates, ratio guards, rate meters, and empty states.
- Cross-view navigation - Playwright covers node/top-session navigation to Timeline.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-4.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every applicable service-wiring row has evidence, and the acceptance packet exists with current commit evidence.
