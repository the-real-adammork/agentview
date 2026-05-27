# Codex Session Observability Dashboard Phase 2 Implementation Plan

**Goal:** Replace fixture Sessions data with a real read-only `state_5.sqlite` session index, schema health checks, safe `$CODEX_HOME` path handling, filters, and child/open counts.

**Phase Boundary:** This phase makes the Sessions view real and keeps Timeline, Agent Graph, Tokens, and Diagnostics on fixture or placeholder detail data. Later phases may rely on real `SessionSummary`, `getThread`, source path validation, and `thread_spawn_edges` counts without reworking the transport.

**Verification:** `npm run typecheck`, `npm run test -- --run`, `npm run e2e -- --grep @sessions`, `npm run perf:sessions`

**Smoke-Testable Outcome:** With a temp fixture `$CODEX_HOME` or local `~/.codex`, the app lists sessions sorted by `updated_at_ms` desc, composes filters, shows child/open counts, and never parses JSONL during first paint.

**Phase Acceptance:** Playwright drives the real Sessions flow against a generated temp Codex home and records `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-2.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks, but the phase owner remains responsible for sequencing, integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Preserve Phase 1 scripts and fixture behavior for views outside this phase.
- Keep SQLite schema, path guard, and API contract changes synchronized before UI work depends on them.
- Verify no JSONL or logs DB reads occur on the Sessions initial render path.
- Update downstream notes if real `SessionSummary` fields differ from the design.
- Block only for allowed escalations.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Backend state source | Task 1, Task 2 | one sub-agent | Sessions UI after contract shape is fixed | `src/backend/codexPaths.ts`, `src/backend/sqlite/stateStore.ts`, API routes | SQLite integration tests and health response |
| Sessions UI | Task 3 | one sub-agent | Backend state source after mock contract is stable | `src/frontend/views/SessionsView.tsx`, client types | Playwright sessions flow |
| Performance/acceptance | Task 4, Task 5 | phase-owner only | None | scripts, tests, acceptance packet | Full command set and perf evidence |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-26-codex-session-observability-dashboard-phase-2-handoff.md`
- Required contents: current task status, branch/worktree, sub-agent results, verification evidence, service-wiring coverage, acceptance packet status, blockers/escalations, and exact restart instructions.

## Codex Efficiency Rules

- Delegate backend and UI lanes only after `SessionFilter` and `SessionSummary` are stable.
- Keep path traversal, read-only DB opening, and API envelope decisions with the phase owner if conflicts appear.
- Do not implement rollout parsing, diagnostics log queries, or raw tail behavior in this phase.

## Autonomy And Escalation

| Escalation | Needed By | Agent-Owned Attempt First | Escalate Only If | Blocking Behavior |
| --- | --- | --- | --- | --- |
| Local Codex source data | Task 2, Task 5 | Generate temp `state_5.sqlite` fixtures and optionally test against `$CODEX_HOME` if present. | The user requires validation against private real data and local `~/.codex` is unavailable. | Phase can complete with temp fixtures; record real-data validation as not run. |

---

## File Map

- Modify: `src/shared/contracts.ts` - complete `SessionFilter`, `SessionSummary`, health, warning/failed-tool status, and pagination types.
- Create: `src/backend/codexPaths.ts` - `$CODEX_HOME` resolution, normalized path allowlist, traversal protection.
- Create: `src/backend/sqlite/stateStore.ts` - read-only WAL-compatible `state_5.sqlite` connection, schema checks, session and edge queries.
- Create: `src/backend/api/sessions.ts`, `src/backend/api/health.ts` - real API handlers for health, `listSessions`, and `getThread`.
- Modify: `src/backend/server.ts` - route registration, local-only binding, Vite CORS restriction.
- Modify: `src/frontend/api/client.ts`, `src/frontend/views/SessionsView.tsx`, `src/frontend/App.tsx` - real Sessions data, filters, loading/error states, header counts.
- Create: `tests/fixtures/codexHome.ts` - temp Codex home and SQLite fixture builder.
- Test: `tests/unit/sessionFilter.test.ts`, `tests/integration/stateStore.test.ts`, `tests/e2e/sessions-index.spec.ts`.
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-2.md` - acceptance evidence packet.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Health and source availability | Header/status chrome | `getHealth()` | SQLite pragma/schema checks | None | Temp or real `$CODEX_HOME` | API integration test and Playwright status assertion. |
| Sessions first paint | Sessions table and header counts | `listSessions(filter, page)` | `state_5.sqlite.threads`, `thread_spawn_edges` | None | Read-only SQLite connection | Playwright rows sorted desc, no JSONL read instrumentation, perf result. |
| Session lookup | Row click selects session | `getThread(threadId)` | `state_5.sqlite.threads` | None | Read-only SQLite connection | E2E row click updates selected session and preserves placeholder detail route. |
| Filter composition | Search/filter controls | Session query builder | Parameterized SQL | None | Temp fixture DB | Unit/integration assertions for search, cwd, date, source, role, model, archived, warnings, failed-tool status, token thresholds. |

## E2E Harness Readiness

Reuse Phase 1 Playwright. Add a temp `$CODEX_HOME` fixture setup that creates `state_5.sqlite` and `thread_spawn_edges` before the server starts, then pass that root through environment variables in the Playwright web server command.

### Task 1: Add Codex Path Guard And Read-Only State Store

**Depends On:** Phase 1 acceptance packet

**Execution:** sub-agent lane: Backend state source; parallel with none initially; checkpoint `npm run test -- --run tests/integration/stateStore.test.ts`

**Files:**
- Create: `src/backend/codexPaths.ts`, `src/backend/sqlite/stateStore.ts`
- Modify: `src/shared/contracts.ts`
- Test: `tests/integration/stateStore.test.ts`, `tests/unit/codexPaths.test.ts`

**Service Wiring Rows Covered:**
- Health and source availability
- Sessions first paint

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/codexPaths.test.ts tests/integration/stateStore.test.ts`
- Expected result: read-only DB fixture opens, schema checks run, path traversal is rejected, and session rows normalize correctly.
- Evidence to collect: test output and temp fixture schema notes.

**Test Mode Disclosure:**
- Automated tests: real local temp SQLite fixture
- Production/dev path exercised: yes, same state store and path guard used by API
- Mock-only risk: private Codex schema drift may still differ from fixtures
- Required real dependencies: local SQLite package and temp filesystem
- Blocking if unavailable: yes for real Sessions phase

- [ ] Step 1: Write failing tests for `$CODEX_HOME` resolution, traversal rejection, read-only open, schema unsupported, and normalized `SessionSummary`.
- [ ] Step 2: Run focused tests and confirm failures.
- [ ] Step 3: Implement path guard and state store with persistent read-only connection behavior.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: add read-only codex state store`

### Task 2: Wire Health, Sessions, And Thread API Routes

**Depends On:** Task 1

**Execution:** sub-agent lane: Backend state source; parallel with Task 3 after route contract is available; checkpoint API integration tests

**Files:**
- Create: `src/backend/api/health.ts`, `src/backend/api/sessions.ts`
- Modify: `src/backend/server.ts`, `src/frontend/api/client.ts`
- Test: `tests/integration/sessionsApi.test.ts`

**Service Wiring Rows Covered:**
- Health and source availability
- Sessions first paint
- Session lookup
- Filter composition

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/sessionsApi.test.ts`
- Expected result: local API returns typed `ApiResult` envelopes, rejects invalid filters, and never reads rollout JSONL.
- Evidence to collect: test output and route coverage summary.

**Test Mode Disclosure:**
- Automated tests: real local API against temp SQLite fixture
- Production/dev path exercised: yes, HTTP route handlers and client envelopes
- Mock-only risk: real local Codex DB may have unsupported schema not represented in fixture
- Required real dependencies: local HTTP test runtime and SQLite package
- Blocking if unavailable: yes

- [ ] Step 1: Write route tests for health, list, lookup, unsupported schema, missing DB, invalid filter, and local-only behavior.
- [ ] Step 2: Run focused tests and confirm route failures.
- [ ] Step 3: Implement API routes with parameterized filters, child/open counts, and typed partial-data warnings.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: expose sessions api`

### Task 3: Replace Sessions UI With Real API Data

**Depends On:** Task 2

**Execution:** sub-agent lane: Sessions UI; parallel with Task 4 after API fixtures exist; checkpoint `npm run e2e -- --grep @sessions`

**Files:**
- Modify: `src/frontend/views/SessionsView.tsx`, `src/frontend/App.tsx`, `src/frontend/api/client.ts`
- Modify: `src/frontend/styles/app.css`
- Test: `tests/e2e/sessions-index.spec.ts`, `tests/unit/sessionFilter.test.ts`

**Service Wiring Rows Covered:**
- Sessions first paint
- Session lookup
- Filter composition

**Agent-Run Acceptance:**
- Automation command: `npm run e2e -- --grep @sessions`
- Expected result: rows sort by updated desc, filters compose, row click selects Timeline target, and late badge cells do not resize.
- Evidence to collect: Playwright trace/screenshots and DOM assertion output.

**Test Mode Disclosure:**
- Automated tests: real local API with temp SQLite fixture
- Production/dev path exercised: yes, browser -> API -> state store
- Mock-only risk: warning/failed-tool counts remain unavailable/unknown until later phases
- Required real dependencies: Playwright browser runtime and temp SQLite fixture
- Blocking if unavailable: yes

- [ ] Step 1: Write Playwright and component tests for table headers, active row `aria-current`, search over title/first message/full id, filters, token warning threshold, and row click.
- [ ] Step 2: Run tests and confirm fixture-only UI fails real API expectations.
- [ ] Step 3: Implement real Sessions data flow, fixed columns, async count placeholders, loading/error states, and reduced-motion-safe interactions.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: wire sessions view to state db`

### Task 4: Add First-Paint Performance Guard

**Depends On:** Task 2, Task 3

**Execution:** phase-owner; parallel with none; checkpoint `npm run perf:sessions`

**Files:**
- Modify: `package.json`
- Create: `tests/perf/sessionsFirstPaint.test.ts` or `scripts/perf/sessions-first-paint.mjs`
- Test: `tests/perf/sessionsFirstPaint.test.ts`

**Service Wiring Rows Covered:**
- Sessions first paint

**Agent-Run Acceptance:**
- Automation command: `npm run perf:sessions`
- Expected result: 500 fixture rows first paint under the threshold recorded in the technical design or packet, with virtualization enabled if needed.
- Evidence to collect: timing output, row count, hardware/runtime note.

**Test Mode Disclosure:**
- Automated tests: real local API with generated temp SQLite fixture
- Production/dev path exercised: yes, browser rendering path and API query
- Mock-only risk: local development machine timing may differ from future hardware
- Required real dependencies: Playwright or equivalent browser timing harness
- Blocking if unavailable: yes for performance claim

- [ ] Step 1: Add a failing performance check or script that generates 500 sessions and records first render timing.
- [ ] Step 2: Run the script and capture baseline failure or missing script.
- [ ] Step 3: Implement query/render optimizations, fixed column sizing, and virtualization only if needed.
- [ ] Step 4: Run `npm run perf:sessions`.
- [ ] Step 5: Commit this task. Suggested message: `test: add sessions first-paint guard`

### Task 5: Integrate Phase 2 Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3, Task 4

**Execution:** phase-owner; parallel with none; checkpoint full Phase 2 command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-2.md`
- Modify: any Phase 2 files needed for integration fixes

**Service Wiring Rows Covered:**
- Health and source availability
- Sessions first paint
- Session lookup
- Filter composition

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run e2e -- --grep @sessions && npm run perf:sessions`
- Expected result: Phase 2 behavior passes through real temp SQLite fixtures and packet records no JSONL initial render.
- Evidence to collect: command output, perf output, Playwright artifacts, source-read instrumentation summary.

**Test Mode Disclosure:**
- Automated tests: real local API with temp SQLite fixture
- Production/dev path exercised: yes, browser -> API -> read-only SQLite
- Mock-only risk: optional real `~/.codex` validation may be skipped if local data is unavailable
- Required real dependencies: local SQLite package and Playwright runtime
- Blocking if unavailable: yes, except optional private real-data validation

- [ ] Step 1: Create acceptance packet rows for every service wiring flow.
- [ ] Step 2: Run full commands and confirm any integration failures.
- [ ] Step 3: Apply final integration fixes within Phase 2 scope.
- [ ] Step 4: Rerun full commands and update packet with evidence.
- [ ] Step 5: Commit this task. Suggested message: `docs: record phase 2 acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: contracts, API, and UI compile.
- Run: `npm run test -- --run`
  Expected: unit and integration tests pass, including temp SQLite fixtures.
- Run: `npm run e2e -- --grep @sessions`
  Expected: browser verifies real Sessions flow through local API.
- Run: `npm run perf:sessions`
  Expected: 500-row first paint evidence is under threshold or records the remediation applied.

**Required Service Wiring Coverage:**
- Health and source availability - API and Playwright status assertions cover DB presence/schema.
- Sessions first paint - E2E and perf checks cover browser -> API -> state DB without JSONL reads.
- Session lookup - E2E row selection covers `getThread`.
- Filter composition - unit/integration/E2E checks cover all `SessionFilter` axes.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-2.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every applicable service-wiring row has evidence, and the acceptance packet exists with current commit evidence.
