# Codex Session Observability Dashboard Phase 3 Implementation Plan

**Goal:** Add streaming rollout JSONL parsing, preview redaction, derived cache, Timeline rendering, collapsed tool outputs, scrubber, and selected-session tailing.

**Phase Boundary:** This phase makes selected session detail real through the Timeline surface. Later phases reuse cached parsed rollout facts for Agent Graph, Tokens, Diagnostics summaries, and hardening, but they do not reimplement parser/cache fundamentals.

**Verification:** `npm run typecheck`, `npm run test -- --run`, `npm run e2e -- --grep @timeline`, `npm run perf:rollout`

**Smoke-Testable Outcome:** Opening a real or temp fixture session shows normalized timeline events from JSONL, joined tool calls/results, redacted previews, collapsed large outputs, scrubber ticks, warm cache reuse, and append-only tail updates.

**Phase Acceptance:** Parser/cache integration tests and Playwright Timeline flow pass, with evidence saved to `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-3.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks, but the phase owner remains responsible for sequencing, integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Preserve Phase 2 Sessions first-paint behavior and avoid adding JSONL reads to the list path.
- Keep parser contracts, cache schema, and Timeline UI in sync as real event shapes are discovered.
- Verify preview redaction runs before render and raw expansion stays explicit.
- Record downstream assumptions for Graph/Tokens consumers of `CachedRolloutFacts`.
- Block only for allowed escalations.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Parser/cache | Task 1, Task 2 | one sub-agent | Timeline UI after event contract is stable | `src/backend/rollout/*`, `src/backend/cache/*`, `src/shared/contracts.ts` | Parser/cache tests and cache fixture inspection |
| Timeline UI | Task 3 | one sub-agent | Parser/cache lane after fixture API exists | `src/frontend/views/TimelineView.tsx`, timeline components/styles | Playwright Timeline flow |
| Tail/perf/acceptance | Task 4, Task 5 | phase-owner only | None | API contracts, cache byte offsets, acceptance packet | Full command set and perf evidence |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-26-codex-session-observability-dashboard-phase-3-handoff.md`
- Required contents: current task status, branch/worktree, parser/cache schema, sub-agent results, verification evidence, service-wiring coverage, acceptance packet status, blockers/escalations, and exact restart instructions.

## Codex Efficiency Rules

- Keep `CachedRolloutFacts` schema decisions centralized; Graph/Tokens will depend on them in Phase 4.
- Delegate parser/cache and Timeline UI only when their file boundaries are clean.
- Do not add `logs_2.sqlite`, raw TUI log, graph layout, or token chart work in this phase.

## Autonomy And Escalation

| Escalation | Needed By | Agent-Owned Attempt First | Escalate Only If | Blocking Behavior |
| --- | --- | --- | --- | --- |
| Large real rollout sample | Task 5 | Generate representative JSONL fixtures and optionally use local `$CODEX_HOME` if present. | The user requires validation against private real transcripts and none are available. | Complete with fixtures; record real-data validation as not run. |

---

## File Map

- Modify: `src/shared/contracts.ts`, `src/shared/redaction.ts` - `TimelineEvent`, `Turn`, `ToolCall`, `TokenSnapshot`, `CachedRolloutFacts`, redacted preview helpers.
- Create: `src/backend/rollout/jsonlStream.ts`, `src/backend/rollout/parseRollout.ts` - streaming line reads and tolerant event normalization.
- Create: `src/backend/cache/rolloutCache.ts`, `src/backend/tail/liveTail.ts` - cache key/invalidation, atomic writes, byte-offset tailing.
- Create: `src/backend/api/timeline.ts` - `getTimeline`, detail source resolution, and `tailThread`.
- Modify: `src/backend/api/sessions.ts`, `src/backend/server.ts`, `src/frontend/api/client.ts` - thread rollout path lookup and route/client registration.
- Modify: `src/frontend/views/TimelineView.tsx`; Create: `src/frontend/components/TimelineEventRow.tsx`, `ToolOutputPreview.tsx`, `TimelineScrubber.tsx`.
- Test: `tests/unit/redaction.test.ts`, `tests/unit/parseRollout.test.ts`, `tests/integration/rolloutCache.test.ts`, `tests/e2e/timeline-detail.spec.ts`, `tests/perf/rolloutParse.test.ts`.
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-3.md`.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Timeline detail load | Timeline view selected session | `getTimeline(threadId)` | `state_5.sqlite` lookup, rollout JSONL, cache JSON | None | Temp `$CODEX_HOME/sessions` tree | Playwright opens selected session and sees normalized events. |
| Rollout parse/cache | Timeline/API runtime | `parseRollout`, `rolloutCache` | App-owned cache under `.observatory/cache/v1` | None | Local filesystem | Integration tests prove cold parse, warm cache, stale cache, corrupt cache fallback. |
| Redacted tool previews | Timeline rows and collapsed output | Redaction helper and parser previews | Cache stores derived previews | None | Local JSONL fixture containing secret-like text | Tests prove previews are redacted before render and raw defaults are hidden. |
| Selected rollout tail | Timeline live mode | `tailThread(threadId, fromByte)` | Rollout file byte offset and cache update | Poll/watch timer | Append-only fixture file | Integration/E2E append rows without scroll jump and return next byte offset. |

## E2E Harness Readiness

Extend the Phase 2 Playwright fixture to create rollout JSONL files linked from `threads.rollout_path`. Add Timeline assertions as soon as `getTimeline` exists so parser/UI integration is verified while the feature is built.

### Task 1: Implement Streaming Parser, Redaction, And Fixtures

**Depends On:** Phase 2 acceptance packet

**Execution:** sub-agent lane: Parser/cache; parallel with none initially; checkpoint parser tests

**Files:**
- Modify: `src/shared/contracts.ts`, `src/shared/redaction.ts`
- Create: `src/backend/rollout/jsonlStream.ts`, `src/backend/rollout/parseRollout.ts`
- Test: `tests/unit/parseRollout.test.ts`, `tests/unit/redaction.test.ts`

**Service Wiring Rows Covered:**
- Rollout parse/cache
- Redacted tool previews

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/parseRollout.test.ts tests/unit/redaction.test.ts`
- Expected result: parser handles known event variants, malformed lines, unknown events, joined call/output, token snapshots, spawn/wait, and secret-like previews.
- Evidence to collect: fixture list, test output, redaction cases covered.

**Test Mode Disclosure:**
- Automated tests: local JSONL fixtures and redaction fixtures
- Production/dev path exercised: yes, same parser/redaction code used by API
- Mock-only risk: future Codex private schema drift may add unknown fields
- Required real dependencies: local filesystem fixtures
- Blocking if unavailable: yes

- [ ] Step 1: Write failing parser/redaction fixtures for every design-listed event and secret class.
- [ ] Step 2: Run focused tests and confirm failures.
- [ ] Step 3: Implement streaming parse helpers and tolerant normalization.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: parse rollout timeline facts`

### Task 2: Add Rollout Cache And Timeline API

**Depends On:** Task 1

**Execution:** sub-agent lane: Parser/cache; parallel with Task 3 after fixture API contract exists; checkpoint cache/API tests

**Files:**
- Create: `src/backend/cache/rolloutCache.ts`, `src/backend/api/timeline.ts`
- Modify: `src/backend/server.ts`, `src/backend/api/sessions.ts`, `src/frontend/api/client.ts`
- Test: `tests/integration/rolloutCache.test.ts`, `tests/integration/timelineApi.test.ts`

**Service Wiring Rows Covered:**
- Timeline detail load
- Rollout parse/cache

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/rolloutCache.test.ts tests/integration/timelineApi.test.ts`
- Expected result: API resolves rollout path from DB, rejects traversal, cold parses, warm loads, invalidates on mtime/size/parser version, and returns typed warnings.
- Evidence to collect: cache artifact path in temp root and test output.

**Test Mode Disclosure:**
- Automated tests: real local temp SQLite + JSONL + cache filesystem
- Production/dev path exercised: yes, API -> state store -> rollout parser/cache
- Mock-only risk: real active writer lock behavior may differ from fixtures
- Required real dependencies: temp filesystem and SQLite package
- Blocking if unavailable: yes

- [ ] Step 1: Write failing API/cache tests for cold, warm, stale, corrupt cache, missing rollout, and traversal attempts.
- [ ] Step 2: Run focused tests and confirm failures.
- [ ] Step 3: Implement cache keys, atomic writes, API route, and typed partial warnings.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: add rollout cache api`

### Task 3: Build Real Timeline View

**Depends On:** Task 2

**Execution:** sub-agent lane: Timeline UI; parallel with Task 4 after timeline API exists; checkpoint Playwright Timeline flow

**Files:**
- Modify: `src/frontend/views/TimelineView.tsx`
- Create: `src/frontend/components/TimelineEventRow.tsx`, `src/frontend/components/ToolOutputPreview.tsx`, `src/frontend/components/TimelineScrubber.tsx`
- Modify: `src/frontend/styles/app.css`
- Test: `tests/e2e/timeline-detail.spec.ts`, `tests/unit/timelineComponents.test.tsx`

**Service Wiring Rows Covered:**
- Timeline detail load
- Redacted tool previews

**Agent-Run Acceptance:**
- Automation command: `npm run e2e -- --grep @timeline`
- Expected result: opening a row renders task/user/assistant/tool/token/agent/warning/parse-error events, joined tool output, >4KB collapse, scrubber with at least 20 ticks when available, and tab filters.
- Evidence to collect: Playwright trace/screenshots and DOM assertion output.

**Test Mode Disclosure:**
- Automated tests: real local API with temp SQLite and JSONL fixture
- Production/dev path exercised: yes, browser -> API -> parser/cache -> Timeline UI
- Mock-only risk: visual density on very large real rollouts needs Phase 5 hardening
- Required real dependencies: Playwright browser runtime
- Blocking if unavailable: yes

- [ ] Step 1: Write component/E2E tests for event rows, collapse/expand, scrubber tick count, tab filters, and redacted previews.
- [ ] Step 2: Run focused tests and confirm Timeline still uses fixture/placeholder behavior.
- [ ] Step 3: Implement Timeline UI against real API data with fixed layout and reduced-motion-safe live behavior.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: render parsed timeline`

### Task 4: Add Selected-Session Tail And Rollout Performance Guard

**Depends On:** Task 2, Task 3

**Execution:** phase-owner; parallel with none; checkpoint tail/perf tests

**Files:**
- Create: `src/backend/tail/liveTail.ts`
- Modify: `src/backend/api/timeline.ts`, `src/frontend/views/TimelineView.tsx`
- Create: `tests/integration/liveTail.test.ts`, `tests/perf/rolloutParse.test.ts`
- Modify: `package.json`

**Service Wiring Rows Covered:**
- Selected rollout tail
- Rollout parse/cache

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/liveTail.test.ts tests/perf/rolloutParse.test.ts && npm run perf:rollout`
- Expected result: append-only fixture returns complete new lines and next offset; large fixture streams without whole-file UI parsing; warm cache beats cold parse.
- Evidence to collect: timing output, memory note if captured, tail offset assertions.

**Test Mode Disclosure:**
- Automated tests: real local temp JSONL/cache filesystem
- Production/dev path exercised: yes, backend tail/cache and browser live mode when E2E runs
- Mock-only risk: OS watcher behavior may differ; polling fallback is acceptable
- Required real dependencies: temp filesystem
- Blocking if unavailable: yes

- [ ] Step 1: Write failing tests for byte-offset tail, incomplete trailing line handling, truncation rebuild, visible row cap, and warm/cold parse timing.
- [ ] Step 2: Run focused tests and confirm failures.
- [ ] Step 3: Implement tail-by-offset and perf script without adding logs DB/raw TUI behavior.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: tail selected rollout`

### Task 5: Integrate Phase 3 Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3, Task 4

**Execution:** phase-owner; parallel with none; checkpoint full Phase 3 command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-3.md`
- Modify: any Phase 3 files needed for integration fixes

**Service Wiring Rows Covered:**
- Timeline detail load
- Rollout parse/cache
- Redacted tool previews
- Selected rollout tail

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run e2e -- --grep @timeline && npm run perf:rollout`
- Expected result: Phase 3 checks pass, no JSONL reads happen on Sessions first paint, and packet records cold/warm cache evidence.
- Evidence to collect: command output, Playwright artifacts, cache paths, perf/tail evidence.

**Test Mode Disclosure:**
- Automated tests: real local temp SQLite + JSONL + cache filesystem
- Production/dev path exercised: yes, browser -> API -> state DB -> JSONL/cache -> Timeline
- Mock-only risk: optional validation against real private transcripts may be skipped
- Required real dependencies: local filesystem, SQLite package, Playwright
- Blocking if unavailable: yes

- [ ] Step 1: Create acceptance packet rows for every service-wiring flow.
- [ ] Step 2: Run full commands and capture failures.
- [ ] Step 3: Apply final integration fixes within Phase 3 scope.
- [ ] Step 4: Rerun full commands and update packet with evidence.
- [ ] Step 5: Commit this task. Suggested message: `docs: record phase 3 acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: parser/cache/API/UI contracts compile.
- Run: `npm run test -- --run`
  Expected: parser, redaction, cache, API, and tail tests pass.
- Run: `npm run e2e -- --grep @timeline`
  Expected: browser verifies row-to-Timeline detail through real local API and JSONL fixture.
- Run: `npm run perf:rollout`
  Expected: streaming and warm/cold cache evidence is recorded.

**Required Service Wiring Coverage:**
- Timeline detail load - E2E covers browser -> API -> state DB -> JSONL/cache.
- Rollout parse/cache - integration tests cover cold/warm/stale/corrupt paths.
- Redacted tool previews - unit and E2E tests cover secret-like previews before render.
- Selected rollout tail - integration and E2E tests cover byte-offset append behavior.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-3.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every applicable service-wiring row has evidence, and the acceptance packet exists with current commit evidence.
