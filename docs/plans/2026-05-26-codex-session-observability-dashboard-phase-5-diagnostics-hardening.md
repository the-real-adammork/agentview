# Codex Session Observability Dashboard Phase 5 Implementation Plan

**Goal:** Add structured Diagnostics, failed-command summaries, async warning badges, advanced raw TUI log tail, and final performance, privacy, accessibility, and error-handling hardening across all five views.

**Phase Boundary:** This phase completes the v0.1 read-only dashboard. It hardens existing surfaces but does not add Tauri packaging, export/sharing, editor launch, source mutation, multi-root selection, or optional Codex tables outside the approved design.

**Verification:** `npm run typecheck`, `npm run test -- --run`, `npm run e2e`, `npm run a11y`, `npm run perf:all`, `npm run privacy:check`

**Smoke-Testable Outcome:** Diagnostics filters, failed-command summaries, and raw advanced tail work through local-only APIs; Sessions badges hydrate after first paint; all five views pass final E2E, accessibility, performance, privacy, and partial-error checks.

**Phase Acceptance:** Full automated acceptance passes and records `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-5.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks, but the phase owner remains responsible for sequencing, integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Preserve all previous phase acceptance behaviors while adding logs/raw-tail sources.
- Keep raw log access advanced-only and local path allowlisted.
- Turn final hardening into automated commands and packet evidence, not manual inspection.
- Resolve or explicitly document all residual privacy, performance, schema, and accessibility risks.
- Block only for allowed escalations.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Diagnostics API | Task 1 | one sub-agent | None initially | `src/backend/sqlite/logStore.ts`, diagnostics API route, summary derivation | Diagnostics integration tests |
| Source safety and privacy contract | Task 3 | phase-owner only | None | `src/shared/contracts.ts`, `src/shared/redaction.ts`, `src/backend/codexPaths.ts`, `src/frontend/api/client.ts`, `src/frontend/App.tsx` | Privacy/source-error tests before UI work starts |
| Diagnostics UI | Task 2 | one sub-agent after Task 3 | None with Task 3; may overlap only with Task 4 after files are disjoint | `src/frontend/views/DiagnosticsView.tsx`, `src/frontend/views/SessionsView.tsx`, diagnostics UI tests | Diagnostics E2E |
| Final QA | Task 4 | one sub-agent or phase-owner | After Task 2 and Task 3 | E2E, a11y, perf, privacy scripts | Full suite and acceptance packet |
| Final integration | Task 5 | phase-owner only | None | All source and packet files | Full Phase 5 gate |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-26-codex-session-observability-dashboard-phase-5-handoff.md`
- Required contents: current task status, branch/worktree, diagnostics source state, hardening evidence, service-wiring coverage, acceptance packet status, blockers/escalations, and exact restart instructions.

## Codex Efficiency Rules

- Do not run Phase 5 Task 2 and Task 3 in parallel. Task 3 owns shared contracts, path guards, API client behavior, app shell error handling, and privacy defaults before Diagnostics UI work consumes them.
- Delegate Diagnostics UI and final QA only after the phase owner has committed the shared error envelope, redaction, source-safety, and no-network/runtime-asset decisions.
- Keep cross-cutting error envelope, privacy default, and acceptance-packet decisions with the phase owner.
- Do not add out-of-scope export, editor launch, command execution, or source mutation affordances while hardening.

## Autonomy And Escalation

| Escalation | Needed By | Agent-Owned Attempt First | Escalate Only If | Blocking Behavior |
| --- | --- | --- | --- | --- |
| Real `logs_2.sqlite` source | Task 1, Task 5 | Generate temp logs DB fixtures and optionally validate against local `$CODEX_HOME` if present. | The user requires private real log validation and local logs are unavailable. | Complete with fixtures; record real-data validation as not run. |
| Raw TUI log source | Task 2 | Generate temp raw log fixture and keep raw mode advanced-only. | The user requires validation against private real raw log and it is unavailable. | Complete with fixture; record real raw-tail validation as not run. |

---

## File Map

- Modify: `src/shared/contracts.ts`, `src/shared/redaction.ts` - diagnostics filters, log rows, failed-command summaries, summary, raw tail response, final error envelope refinements.
- Create: `src/backend/sqlite/logStore.ts`, `src/backend/diagnostics/rawTuiLog.ts`, `src/backend/api/diagnostics.ts` - read-only logs DB, advanced raw log tail, diagnostics summaries.
- Modify: `src/backend/codexPaths.ts`, `src/backend/server.ts`, `src/backend/api/sessions.ts` - raw path allowlist, route registration, async warning badges.
- Modify: `src/frontend/views/DiagnosticsView.tsx`, `src/frontend/views/SessionsView.tsx`, `src/frontend/App.tsx`, `src/frontend/api/client.ts`, `src/frontend/styles/app.css`.
- Create: `tests/integration/logStore.test.ts`, `tests/integration/diagnosticsApi.test.ts`, `tests/e2e/diagnostics-ui.spec.ts`, `tests/e2e/diagnostics-hardening.spec.ts`, `tests/a11y/observatory-a11y.spec.ts`, `tests/privacy/privacyPreviews.test.ts`, `tests/perf/fullDashboard.test.ts`.
- Modify: `package.json` - `a11y`, `perf:all`, `privacy:check`, and inherited `tokens:check` scripts.
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-5.md`.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Structured diagnostics | Diagnostics view filters | `queryLogs`, `getDiagnosticsSummary` | `logs_2.sqlite.logs` | None | Temp logs DB fixture | E2E filters by level/target/scope and integration tests page by cursor. |
| Failed command summaries | Diagnostics failed-command panel | `getDiagnosticsSummary` plus cached rollout failed-tool facts | rollout cache, optional `logs_2.sqlite.logs` | None | Temp rollout cache and logs DB fixtures | Integration/E2E prove failed commands render and fallback works when `logs_2.sqlite` is missing. |
| Sessions warning badges | Sessions visible rows | batched diagnostics summary | `logs_2.sqlite.logs` | delayed hydration timer | Local API | E2E proves badges hydrate after first paint without layout flash. |
| Raw advanced tail | Diagnostics advanced control | `tailRawLog(fromByte)` | `~/.codex/log/codex-tui.log` | Poll timer | Allowlisted raw log path only | E2E proves hidden by default, explicit reveal, redacted previews, next offset. |
| Partial error handling | All five views | `ApiResult` error/warning envelopes | missing/locked/malformed sources | None | Temp missing/unsupported fixtures | E2E/integration tests show partial panels instead of blank dashboard. |
| Final privacy/a11y/performance | All five views | Shared UI/API behavior | All sources introduced so far | None | Browser automation | `npm run a11y`, `npm run privacy:check`, `npm run perf:all`, `npm run tokens:check`, full E2E evidence, and Playwright network assertions for no telemetry/external runtime assets. |

## E2E Harness Readiness

Reuse the established Playwright harness and expand it to all five views. Add axe or equivalent accessibility checks and deterministic temp fixtures for logs, missing source files, schema drift, raw tail, and large row counts.

### Task 1: Add Read-Only Logs Store And Diagnostics Summary API

**Depends On:** Phase 4 acceptance packet

**Execution:** sub-agent lane: Diagnostics; parallel with none initially; checkpoint diagnostics API tests

**Files:**
- Create: `src/backend/sqlite/logStore.ts`, `src/backend/api/diagnostics.ts`
- Modify: `src/shared/contracts.ts`, `src/backend/server.ts`, `src/backend/cache/rolloutCache.ts`
- Test: `tests/integration/logStore.test.ts`, `tests/integration/diagnosticsApi.test.ts`

**Service Wiring Rows Covered:**
- Structured diagnostics
- Failed command summaries
- Sessions warning badges

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/logStore.test.ts tests/integration/diagnosticsApi.test.ts`
- Expected result: read-only logs DB opens, cursor pagination works, filters are parameterized, summaries return warning counts, loudest targets, failed command summaries, and rollout-cache fallback when `logs_2.sqlite` is unavailable.
- Evidence to collect: test output and fixture schema notes.

**Test Mode Disclosure:**
- Automated tests: real temp SQLite logs fixture
- Production/dev path exercised: yes, diagnostics API and log store
- Mock-only risk: private real log target diversity may exceed fixtures
- Required real dependencies: local SQLite package
- Blocking if unavailable: yes

- [ ] Step 1: Write failing tests for read-only open, schema unsupported, level/target/thread filters, cursor pagination, warning counts, target summaries, failed command summaries, and rollout-cache fallback when logs DB is missing.
- [ ] Step 2: Run focused tests and confirm failures.
- [ ] Step 3: Implement log store and diagnostics API with typed warnings.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: add diagnostics log api`

### Task 2: Build Diagnostics UI, Failed Command Panel, Warning Badges, And Raw Advanced Tail

**Depends On:** Task 1, Task 3

**Execution:** sub-agent lane: Diagnostics UI; parallel with none that edits shared contracts, path guards, API client, app shell, or diagnostics E2E files; checkpoint diagnostics E2E

**Files:**
- Modify: `src/frontend/views/DiagnosticsView.tsx`, `src/frontend/views/SessionsView.tsx`
- Create: `src/backend/diagnostics/rawTuiLog.ts`
- Modify: `src/backend/api/diagnostics.ts`, `src/frontend/styles/app.css`
- Test: `tests/e2e/diagnostics-ui.spec.ts`, `tests/integration/rawTuiLog.test.ts`

**Service Wiring Rows Covered:**
- Structured diagnostics
- Failed command summaries
- Sessions warning badges
- Raw advanced tail

**Agent-Run Acceptance:**
- Automation command: `npm run e2e -- --grep @diagnostics`
- Expected result: Diagnostics filters work, scope toggle re-queries, failed-command panel renders from logs/cache summary, loudest links navigate, badges hydrate after first paint, raw tail is hidden until advanced activation.
- Evidence to collect: Playwright trace/screenshots, first-paint/badge timing note.

**Test Mode Disclosure:**
- Automated tests: real local API with temp logs DB and raw log fixture
- Production/dev path exercised: yes, browser -> diagnostics API -> logs/raw log
- Mock-only risk: real raw log privacy patterns may vary
- Required real dependencies: Playwright browser runtime and temp filesystem
- Blocking if unavailable: yes

- [ ] Step 1: Write E2E tests for diagnostics filters, scope, failed-command summaries, logs-missing rollout-cache fallback, tail append, loudest navigation, warning badge hydration, and raw hidden-by-default behavior.
- [ ] Step 2: Run focused tests and confirm Diagnostics is incomplete.
- [ ] Step 3: Implement UI and raw tail path guard with redacted previews and explicit advanced control.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: add diagnostics view`

### Task 3: Harden Shared Error Envelope, Privacy Defaults, Source Safety, And Runtime Asset Policy

**Depends On:** Task 1

**Execution:** phase-owner; parallel with none; checkpoint privacy/error tests before Task 2 starts

**Files:**
- Modify: `src/shared/contracts.ts`, `src/shared/redaction.ts`, `src/backend/codexPaths.ts`, `src/frontend/api/client.ts`, `src/frontend/App.tsx`, all affected view error states, `package.json`
- Test: `tests/privacy/privacyPreviews.test.ts`, `tests/integration/sourceErrors.test.ts`, inherited `scripts/check-style-tokens.mjs`

**Service Wiring Rows Covered:**
- Partial error handling
- Final privacy/a11y/performance

**Agent-Run Acceptance:**
- Automation command: `npm run privacy:check && npm run tokens:check && npm run test -- --run tests/integration/sourceErrors.test.ts`
- Expected result: base instructions absent from default payloads, previews redacted, raw controls explicit, missing/locked/malformed sources render partial states, external runtime fonts/assets/telemetry are blocked, and no export/editor/command endpoints exist.
- Evidence to collect: privacy test output and source-error fixture matrix.

**Test Mode Disclosure:**
- Automated tests: fixtures with secret-like strings, missing files, unsupported schemas, malformed JSONL, corrupt cache
- Production/dev path exercised: yes, shared API/UI error envelope and redaction paths
- Mock-only risk: undiscovered secret formats may need future redaction patterns
- Required real dependencies: local test runtime
- Blocking if unavailable: yes

- [ ] Step 1: Write failing tests for secret-like previews, credential URLs, base-instruction absence, raw gating, path traversal, partial source errors, no telemetry/export/editor/command endpoints, and no external runtime font/asset references.
- [ ] Step 2: Run focused tests and confirm failures.
- [ ] Step 3: Implement final redaction/error/source-safety fixes across APIs and views.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `fix: harden observatory privacy defaults`

### Task 4: Add Final Accessibility, Performance, Privacy, And Network Gates

**Depends On:** Task 2, Task 3

**Execution:** sub-agent lane: Hardening/QA; parallel with none after UI is stable; checkpoint a11y/perf scripts

**Files:**
- Create: `tests/a11y/observatory-a11y.spec.ts`, `tests/perf/fullDashboard.test.ts`
- Modify: `package.json`, `src/frontend/styles/app.css`, affected components/views
- Test: `tests/e2e/diagnostics-hardening.spec.ts`, `tests/a11y/observatory-a11y.spec.ts`, `tests/perf/fullDashboard.test.ts`

**Service Wiring Rows Covered:**
- Final privacy/a11y/performance
- Partial error handling

**Agent-Run Acceptance:**
- Automation command: `npm run a11y && npm run perf:all && npm run privacy:check && npm run tokens:check && npm run e2e`
- Expected result: contrast/focus/table/aria-current/decorative aria-hidden/reduced-motion checks pass; performance gates for Sessions, rollout, graph, diagnostics, and live-tail row caps are recorded; Playwright network assertions show no telemetry, remote assets, or external runtime fonts.
- Evidence to collect: a11y report, perf output, Playwright artifacts.

**Test Mode Disclosure:**
- Automated tests: real local API with generated temp source fixtures
- Production/dev path exercised: yes, browser runtime across all five views
- Mock-only risk: exact timings may vary by hardware
- Required real dependencies: Playwright/axe or equivalent browser tooling
- Blocking if unavailable: yes

- [ ] Step 1: Add failing a11y/perf/network tests for all five views, reduced motion, focus rings, real table headers, `aria-current`, decorative `aria-hidden`, first-paint, large rollout, graph depth, diagnostics paging, live row cap, no telemetry, no remote assets, and no external runtime fonts.
- [ ] Step 2: Run checks and confirm failures or missing scripts.
- [ ] Step 3: Fix UI/layout/style/performance issues without changing product scope.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `test: add final observatory quality gates`

### Task 5: Integrate Phase 5 Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3, Task 4

**Execution:** phase-owner; parallel with none; checkpoint full Phase 5 command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-5.md`
- Modify: any Phase 5 files needed for integration fixes

**Service Wiring Rows Covered:**
- Structured diagnostics
- Failed command summaries
- Sessions warning badges
- Raw advanced tail
- Partial error handling
- Final privacy/a11y/performance

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run e2e && npm run a11y && npm run perf:all && npm run privacy:check && npm run tokens:check`
- Expected result: full v0.1 dashboard acceptance passes and packet records commands, artifacts, residual risks, and deferred out-of-scope work.
- Evidence to collect: full command output, reports, traces/screenshots, perf/privacy/a11y summaries.

**Test Mode Disclosure:**
- Automated tests: real local API with temp SQLite/JSONL/log/raw fixtures
- Production/dev path exercised: yes, all five views and local source boundaries
- Mock-only risk: optional validation against private real Codex data may be skipped
- Required real dependencies: local browser tooling, SQLite package, temp filesystem
- Blocking if unavailable: yes

- [ ] Step 1: Create the final acceptance packet with command/evidence sections for every service-wiring row.
- [ ] Step 2: Run the full Phase 5 command set and capture failures.
- [ ] Step 3: Apply final integration fixes within v0.1 scope.
- [ ] Step 4: Rerun the full command set and update packet with evidence and downstream assumptions.
- [ ] Step 5: Commit this task. Suggested message: `docs: record phase 5 acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: all contracts, API routes, views, and tests compile.
- Run: `npm run test -- --run`
  Expected: all unit/integration tests pass.
- Run: `npm run e2e`
  Expected: all five views pass browser flows through local API and generated source fixtures.
- Run: `npm run a11y`
  Expected: automated accessibility checks pass for table semantics, focus rings, `aria-current`, contrast, decorative `aria-hidden`, and reduced motion.
- Run: `npm run perf:all`
  Expected: Sessions first paint, rollout warm/cold parse, graph rendering, diagnostics paging, and live-tail row cap evidence is recorded.
- Run: `npm run privacy:check`
  Expected: redacted previews, base-instruction default absence, raw advanced gating, local-only path allowlists, no telemetry, no remote runtime assets, no external runtime fonts, and no export/editor/command endpoints are verified.
- Run: `npm run tokens:check`
  Expected: deterministic style-token/runtime asset check inherited from Phase 1 still passes after all view and hardening edits.

**Required Service Wiring Coverage:**
- Structured diagnostics - integration and E2E tests cover logs DB queries and summaries.
- Failed command summaries - integration and E2E tests cover logs/cache-derived failed command panels and fallback when `logs_2.sqlite` is unavailable.
- Sessions warning badges - E2E covers delayed hydration after first paint.
- Raw advanced tail - integration and E2E tests cover allowlisted raw log tail hidden by default.
- Partial error handling - integration and E2E tests cover missing/locked/malformed/unsupported source states.
- Final privacy/a11y/performance - named scripts cover all cross-view gates, including no telemetry, remote assets, or external runtime fonts.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-5.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every applicable service-wiring row has evidence, and the acceptance packet exists with current commit evidence.
