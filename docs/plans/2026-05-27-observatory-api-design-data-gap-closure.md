# Observatory API Design Data Gap Closure Implementation Plan

**Goal:** Make the local API server expose the exact normalized data the WorkflowKit Evangelion design handoff expects from real Codex `state_5.sqlite`, rollout JSONL, `logs_2.sqlite`, and raw log sources.

**Phase Boundary:** This phase is a corrective vertical increment over the existing v0.1 dashboard. It does not add new product surfaces, Tauri packaging, export/sharing, editor launch, source mutation, or multi-root support; it tightens the API/server normalization so the already-designed Sessions, Timeline, Agent Graph, Tokens, and Diagnostics views can rely on real data instead of fixture-shaped assumptions.

**Verification:** `npm run typecheck`, `npm run test -- --run`, `npm run e2e -- timeline-detail.spec.ts graph-tokens.spec.ts diagnostics-ui.spec.ts`, `npm run privacy:check`

**Smoke-Testable Outcome:** With temp Codex fixtures shaped like the observed design docs, the app loads Sessions, opens Timeline with joined tool outputs and spawn-child links, renders Tokens with full token metadata, renders Agent Graph with child metadata, and serves Diagnostics from the observed `logs_2.sqlite` schema.

**Phase Acceptance:** The phase is accepted when API integration tests prove the observed Codex schemas are supported, Playwright proves the five view paths consume the enriched API payloads, and `docs/qa/phase-acceptance/2026-05-27-observatory-api-design-data-gap-closure.md` records the commands and evidence.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded parser, logs, or UI-consumption lanes, but the phase owner remains responsible for contract sequencing, integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Keep this phase scoped to API/data availability gaps identified against `docs/design/workflowkit-evangelion/Engineering Handoff.html`.
- Preserve read-only behavior for all Codex-owned sources.
- Approve shared contract changes before parser, logs, graph, tokens, or UI tasks consume them.
- Ensure all runtime payloads remain preview-redacted by default and do not expose base instructions unless an explicit future raw reveal path is designed.
- Update tests and fixtures to use observed `event_msg` / `response_item` envelopes and the observed `logs_2.sqlite` column names.
- Block only for allowed escalations.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Contract baseline | Task 1 | phase-owner | None | `src/shared/contracts.ts`, fixture builders, API client types | Typecheck plus contract/unit tests before other lanes start |
| Rollout parser | Task 2 | one sub-agent after Task 1 | Task 3 after contracts are committed | `src/backend/rollout/parseRollout.ts`, rollout cache tests | Parser/cache/timeline integration tests |
| Logs schema adapter | Task 3 | one sub-agent after Task 1 | Task 2 after contracts are committed | `src/backend/sqlite/logStore.ts`, diagnostics API tests | Logs/diagnostics integration tests |
| Graph/tokens API enrichment | Task 4 | serial sub-agent after Tasks 2-3 | None | `src/backend/api/agentGraph.ts`, `src/backend/api/tokens.ts`, shared normalized facts | Graph/tokens API tests |
| UI consumption and E2E | Task 5 | one sub-agent after Tasks 2-4 | None | frontend views/components and Playwright files | Focused Playwright smoke |
| Acceptance | Task 6 | phase-owner | None | all changed files and acceptance packet | Full phase command set |

**Long-Running Handoff:**
- Handoff path: `docs/implementation-runs/<run-id>/handoffs/2026-05-27-observatory-api-design-data-gap-closure-handoff.md`
- Required contents: current task status, branch/worktree, contract changes, parser/log-store fixture coverage, API route evidence, Playwright evidence, acceptance packet status, blockers/escalations, and exact restart instructions.

## Implementation Execution Handoff

This phase is intended to be run by `$implementation-execution` after planning approval.

- Run state: `docs/implementation-runs/<run-id>/run.yaml`
- Phase state: `docs/implementation-runs/<run-id>/phases/observatory-api-design-data-gap-closure.yaml`
- Worker result YAML: `docs/implementation-runs/<run-id>/workers/<lane>-<timestamp>.yaml`
- Acceptance packet: `docs/qa/phase-acceptance/2026-05-27-observatory-api-design-data-gap-closure.md`
- QA artifacts: `docs/qa/artifacts/observatory-api-design-data-gap-closure/`

## Codex Efficiency Rules

- Serialize Task 1 before all behavior work because it changes shared contracts consumed by every lane.
- Parser and logs schema work can run in parallel only after Task 1 is committed; they must not both edit shared contracts.
- Keep cross-cutting cache shape, API route envelope, and acceptance packet edits with the phase owner.
- Do not introduce new fixture-only runtime behavior. Fixtures in this phase are test-only and must exercise the production/dev API code paths.

## Autonomy And Escalation

| Escalation | Needed By | Agent-Owned Attempt First | Escalate Only If | Blocking Behavior |
| --- | --- | --- | --- | --- |
| Private real Codex source validation | Task 6 | Generate temp `$CODEX_HOME` with observed schemas and run against local `$CODEX_HOME` when it is present and readable. | The user requires validation against private real Codex files that are unavailable or intentionally withheld. | Complete against generated observed-schema fixtures and record local real-data validation as pass or skipped with exact reason. |
| Product decision for raw unredacted reveals | None in this phase | Keep all new API fields preview-redacted and raw reveal out of scope. | A requested implementation tries to expose raw transcript/log/base-instruction content by default. | Block that raw reveal work and continue with preview-only fields. |

---

## File Map

- Modify: `src/shared/contracts.ts` - add enriched Timeline, Token, Agent Graph, Diagnostics, and cached rollout fact fields required by the handoff.
- Modify: `src/fixtures/observatoryFixtures.ts`, `tests/fixtures/codexHome.ts`, `tests/fixtures/diagnostics.ts` - replace fixture-only shapes with observed `event_msg` / `response_item` and `logs_2.sqlite` fixtures.
- Modify: `src/backend/rollout/parseRollout.ts`, `src/backend/rollout/jsonlStream.ts`, `src/backend/cache/rolloutCache.ts`, `src/backend/tail/liveTail.ts` - parse observed rollout envelopes, compute joined facts, emit turn/cache summary data, and support append/tail metadata.
- Modify: `src/backend/api/timeline.ts` - return enriched timeline payloads and tail payloads without losing joined facts.
- Modify: `src/backend/sqlite/logStore.ts`, `src/backend/api/diagnostics.ts` - support the observed `logs_2.sqlite` schema and derive warning summaries from logs plus failed commands from rollout cache.
- Modify: `src/backend/sqlite/stateStore.ts`, `src/backend/api/agentGraph.ts`, `src/backend/api/tokens.ts` - expose graph updated timestamps, stable child metadata, and full token snapshot metadata.
- Modify: `src/frontend/api/client.ts`, `src/frontend/views/TimelineView.tsx`, `src/frontend/components/TimelineEventRow.tsx`, `src/frontend/components/TimelineScrubber.tsx`, `src/frontend/views/TokensView.tsx`, `src/frontend/views/AgentGraphView.tsx`, `src/frontend/views/DiagnosticsView.tsx` - consume the enriched API fields enough to prove availability through the app surface.
- Test: `tests/unit/contracts.test.ts`, `tests/unit/parseRollout.test.ts`, `tests/privacy/privacyPreviews.test.ts`, `tests/integration/timelineApi.test.ts`, `tests/integration/rolloutCache.test.ts`, `tests/integration/liveTail.test.ts`, `tests/unit/tokenSeries.test.ts`, `tests/unit/agentGraph.test.ts`, `tests/integration/graphTokensApi.test.ts`, `tests/integration/logStore.test.ts`, `tests/integration/diagnosticsApi.test.ts`, `tests/integration/sourceErrors.test.ts`.
- Test: `tests/e2e/timeline-detail.spec.ts`, `tests/e2e/graph-tokens.spec.ts`, `tests/e2e/diagnostics-ui.spec.ts`.
- Create: `docs/qa/phase-acceptance/2026-05-27-observatory-api-design-data-gap-closure.md`.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Observed rollout timeline | Timeline view selected session | `getTimeline`, `parseRolloutFile`, rollout cache | rollout JSONL cache under `.observatory/cache/v1` | None | temp `$CODEX_HOME/sessions/**/*.jsonl` with `event_msg` and `response_item` lines | Parser/unit, timeline API integration, and Playwright prove event kinds, turn grouping, joined tool rows, redaction, and cache reuse. |
| Spawn child navigation data | Timeline row and Agent Graph | timeline API plus graph API | `thread_spawn_edges`, rollout JSONL | None | temp state DB and rollout fixtures with `spawn_agent` / `wait_agent` | Integration and E2E prove child thread IDs, nickname/role/task previews, open-child status, and Timeline navigation target availability. |
| Full token metadata | Tokens view and Timeline token strip | `getTokenSeries`, rollout parser token facts | rollout JSONL cache | None | token_count fixture with exact handoff field names | Unit/integration/E2E prove `last_input_tokens`, `last_output_tokens`, `model_context_window`, rate-limit fields, reset time, and `plan_type` are available or produce explicit empty-state reasons. |
| Observed diagnostics logs | Diagnostics view filters and Sessions badges | `queryLogs`, `getDiagnosticsSummary` | observed `logs_2.sqlite.logs` schema: `ts`, `ts_nanos`, `feedback_log_body`, `estimated_bytes` | None | temp SQLite DB matching the design spec | Log-store and diagnostics API tests prove schema compatibility, level/target/thread filters, cursor paging, warning counts, and target summaries. |
| Failed command summaries | Diagnostics failed-command panel and Sessions failed badge | diagnostics summary plus rollout cache failed-tool facts | rollout JSONL cache and logs DB when available | None | temp rollout fixture with nonzero shell output wrapper | Integration/E2E prove failed commands derive from `function_call_output.output` when logs DB lacks derived command columns. |
| Cache and live tail facts | Timeline refresh/tail action | `getTimeline(fromByte)`, cache invalidation | rollout JSONL file and cache file | None | append-only temp rollout file | Integration tests prove tail reads complete appended lines, preserves byte offsets, updates derived facts, and avoids re-reading bulk content for append-only growth. |

## E2E Harness Readiness

Reuse the existing Playwright harness. This phase must extend temp `$CODEX_HOME` fixture setup so browser tests run against the real local API server with observed SQLite/JSONL/log shapes rather than fixture API responses.

### Task 1: Establish Enriched Shared Contracts And Observed-Shape Fixtures

**Depends On:** None

**Execution:** phase-owner; parallel with none; checkpoint `npm run typecheck` and focused contract tests

**Owner-Only Justification:** Contract and fixture scaffolding establishes shared boundaries for later worker lanes and does not implement runtime behavior.

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/fixtures/observatoryFixtures.ts`
- Modify: `tests/fixtures/codexHome.ts`, `tests/fixtures/diagnostics.ts`
- Test: `tests/unit/contracts.test.ts`

**Service Wiring Rows Covered:**
- None - contract and fixture foundation

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run tests/unit/contracts.test.ts`
- Expected result: shared types compile and fixture builders can create observed rollout/log/state source records without using production/dev mock payload shapes.
- Evidence to collect: typecheck output and contract test output.

**Test Mode Disclosure:**
- Automated tests: test-only fixture builders
- Production/dev path exercised: no, this task only defines contracts and source fixtures
- Mock-only risk: field names may still need adjustment if future Codex versions drift
- Required real dependencies: local TypeScript/Vitest runtime
- Blocking if unavailable: yes

**TDD Approval Gate:** not applicable because this is phase-owner contract and fixture scaffolding.

- [ ] Step 1: Update `TokenSnapshot` to include `lastInput`, `lastOutput`, `modelContextWindow`, `planType`, and raw percent fields in addition to current normalized fields.
- [ ] Step 2: Add `TurnSummary`, `AgentLaunchFact`, `AgentWaitFact`, `RolloutSummary`, and enriched `CachedToolCall` fields: `durationMs`, `resultEventId`, `failureReasonPreview`, `commandPreview`, and `outputTokenCount`.
- [ ] Step 3: Add Timeline event fields needed by the handoff: `phase`, `childThreadId`, `agentNickname`, `agentRole`, `agentTaskPreview`, `joinedOutputPreview`, `joinedExitCode`, `joinedDurationMs`, and `tokenSnapshot`.
- [ ] Step 4: Add graph node fields `updatedAt`, `createdAt`, and `sourceEdgeStatus`; add diagnostics support for observed logs without derived command columns.
- [ ] Step 5: Update fixture builders to create `event_msg.payload.type`, `response_item.payload.type`, and observed `logs` table records.
- [ ] Step 6: Run focused verification.
- [ ] Step 7: Commit this task. Suggested message: `chore: define observatory enriched api contracts`

### Task 2: Parse Observed Rollout Envelopes Into Joined Timeline, Turn, Token, Agent, And Summary Facts

**Depends On:** Task 1

**Execution:** sub-agent lane: Rollout parser; parallel with Task 3 after Task 1 is committed; checkpoint parser/cache/timeline tests

**Files:**
- Modify: `src/backend/rollout/parseRollout.ts`, `src/backend/rollout/jsonlStream.ts`
- Modify: `src/backend/cache/rolloutCache.ts`, `src/backend/tail/liveTail.ts`, `src/backend/api/timeline.ts`
- Test: `tests/unit/parseRollout.test.ts`, `tests/integration/rolloutCache.test.ts`, `tests/integration/timelineApi.test.ts`, `tests/integration/liveTail.test.ts`, `tests/privacy/privacyPreviews.test.ts`

**Service Wiring Rows Covered:**
- Observed rollout timeline
- Spawn child navigation data
- Full token metadata
- Failed command summaries
- Cache and live tail facts

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/parseRollout.test.ts tests/integration/rolloutCache.test.ts tests/integration/timelineApi.test.ts tests/integration/liveTail.test.ts tests/privacy/privacyPreviews.test.ts`
- Expected result: observed rollout JSONL lines produce the event kinds and derived facts the design expects, cache files include turns/tokens/edges/summary, and previews are redacted.
- Evidence to collect: test output and fixture names covering each observed envelope.

**Test Mode Disclosure:**
- Automated tests: temp rollout JSONL fixtures using observed event shapes
- Production/dev path exercised: yes, rollout stream/parser/cache/timeline API
- Mock-only risk: real tool output wrappers may include additional exit-code formats
- Required real dependencies: local filesystem and Vitest runtime
- Blocking if unavailable: yes

**TDD Approval Gate:** required for delegated behavior work.
- Worker writes or updates tests first.
- Worker runs focused tests and records the expected failure.
- Worker returns test intent, covered requirements, command, expected failure, and affected files to the phase owner.
- Phase owner approves that the tests satisfy the task requirements before implementation starts.
- Worker implements only after approval, then reruns the approved tests until green.

- [ ] Step 1: Write failing tests for top-level `event_msg` with nested `payload.type`, top-level `response_item` with nested `payload.type`, `message.content` arrays, `task_started`, `task_complete.last_agent_message`, `token_count`, `function_call`, `function_call_output`, `spawn_agent`, `wait_agent`, malformed lines, unknown events, and secret redaction.
- [ ] Step 2: Write failing tests for joining `function_call` and `function_call_output` by `call_id`, computing `durationMs` from timestamps, extracting nonzero shell exit codes from output wrappers, and marking failed tool summaries.
- [ ] Step 3: Write failing tests for cache shape containing `turns`, `events`, `tokenSnapshots`, rollout agent edges, and `summary`.
- [ ] Step 4: Run focused tests and confirm the expected failures.
- [ ] Step 5: Implement envelope-aware parsing:

```ts
const payloadType = isRecord(record.payload) ? stringValue(record.payload.type) : undefined;
const normalizedType = payloadType ?? stringValue(record.type, record.kind, record.event, record.name);
```

- [ ] Step 6: Implement payload-aware accessors for call IDs, tool names, arguments, content, output, token payloads, and sub-agent metadata.
- [ ] Step 7: Implement a second pass that annotates call events with joined output, exit code, duration, and failed-command previews while preserving separate result events.
- [ ] Step 8: Implement turn summaries from `turn_id`, task start/complete timestamps, TTFT when present, model/effort/sandbox/approval from `turn_context`, and last agent report fields.
- [ ] Step 9: Implement append-tail parsing that returns only complete appended lines, updates cache-derived summary facts when appropriate, and preserves byte offsets.
- [ ] Step 10: Run focused verification.
- [ ] Step 11: Commit this task. Suggested message: `fix: parse observed codex rollout events`

### Task 3: Support The Observed `logs_2.sqlite` Schema In Diagnostics

**Depends On:** Task 1

**Execution:** sub-agent lane: Logs schema adapter; parallel with Task 2 after Task 1 is committed; checkpoint diagnostics integration tests

**Files:**
- Modify: `src/backend/sqlite/logStore.ts`, `src/backend/api/diagnostics.ts`
- Modify: `tests/fixtures/diagnostics.ts`
- Test: `tests/integration/logStore.test.ts`, `tests/integration/diagnosticsApi.test.ts`, `tests/integration/sourceErrors.test.ts`

**Service Wiring Rows Covered:**
- Observed diagnostics logs
- Failed command summaries

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/logStore.test.ts tests/integration/diagnosticsApi.test.ts tests/integration/sourceErrors.test.ts`
- Expected result: diagnostics works against a temp DB with `ts`, `ts_nanos`, `feedback_log_body`, `estimated_bytes`, and no derived command columns.
- Evidence to collect: test output proving observed schema compatibility and unsupported-schema behavior.

**Test Mode Disclosure:**
- Automated tests: real temp SQLite DB matching the observed docs
- Production/dev path exercised: yes, `logStore` and diagnostics API routes
- Mock-only risk: real logs may contain targets and body formats not represented by fixtures
- Required real dependencies: Node SQLite runtime
- Blocking if unavailable: yes

**TDD Approval Gate:** required for delegated behavior work.
- Worker writes or updates tests first.
- Worker runs focused tests and records the expected failure.
- Worker returns test intent, covered requirements, command, expected failure, and affected files to the phase owner.
- Phase owner approves that the tests satisfy the task requirements before implementation starts.
- Worker implements only after approval, then reruns the approved tests until green.

- [ ] Step 1: Write failing tests that create observed-schema `logs` rows with `ts`, `ts_nanos`, `level`, `target`, `feedback_log_body`, `module_path`, `file`, `line`, `thread_id`, `process_uuid`, and `estimated_bytes`.
- [ ] Step 2: Write failing tests for level/target/thread filters, cursor pagination ordered by `ts`, `ts_nanos`, `id`, warning counts by thread, loudest targets, and redacted body previews.
- [ ] Step 3: Write failing tests proving derived command columns are not required and failed-command summaries fall back to rollout cache facts.
- [ ] Step 4: Run focused tests and confirm failures.
- [ ] Step 5: Implement schema detection for observed logs columns and normalize `timestampMs` from `ts` plus `ts_nanos`.
- [ ] Step 6: Replace required derived command columns with compatibility adapters; keep command summaries sourced from rollout cache unless logs contain compatible derived data in a future schema.
- [ ] Step 7: Implement cursor encoding/decoding using `ts`, `ts_nanos`, and `id` so pagination is stable for rows sharing the same millisecond.
- [ ] Step 8: Run focused verification.
- [ ] Step 9: Commit this task. Suggested message: `fix: support observed codex logs schema`

### Task 4: Enrich Agent Graph And Token API Responses From Normalized Facts

**Depends On:** Task 2, Task 3

**Execution:** sub-agent lane: Graph/tokens API; parallel with none because it consumes parser and logs outputs; checkpoint graph/tokens integration tests

**Owner-Only Justification:** not applicable

**Files:**
- Modify: `src/backend/sqlite/stateStore.ts`, `src/backend/api/agentGraph.ts`, `src/backend/api/tokens.ts`, `src/backend/api/diagnostics.ts`
- Test: `tests/unit/tokenSeries.test.ts`, `tests/unit/agentGraph.test.ts`, `tests/integration/graphTokensApi.test.ts`, `tests/integration/diagnosticsApi.test.ts`

**Service Wiring Rows Covered:**
- Spawn child navigation data
- Full token metadata
- Failed command summaries

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/tokenSeries.test.ts tests/unit/agentGraph.test.ts tests/integration/graphTokensApi.test.ts tests/integration/diagnosticsApi.test.ts`
- Expected result: graph nodes include the handoff-needed metadata, token series carries full token_count metadata, and diagnostics summary uses rollout-derived failed tools when logs only provide runtime messages.
- Evidence to collect: focused test output and API sample payload snippets in the worker result.

**Test Mode Disclosure:**
- Automated tests: temp state DB, rollout JSONL, and observed logs DB fixtures
- Production/dev path exercised: yes, graph/tokens/diagnostics APIs
- Mock-only risk: final sub-agent report extraction may need future tuning for new Codex event formats
- Required real dependencies: local SQLite/filesystem
- Blocking if unavailable: yes

**TDD Approval Gate:** required for delegated behavior work.
- Worker writes or updates tests first.
- Worker runs focused tests and records the expected failure.
- Worker returns test intent, covered requirements, command, expected failure, and affected files to the phase owner.
- Phase owner approves that the tests satisfy the task requirements before implementation starts.
- Worker implements only after approval, then reruns the approved tests until green.

- [ ] Step 1: Add failing token-series tests for `last_input_tokens`, `last_output_tokens`, `model_context_window`, `plan_type`, context utilization, primary/secondary rate-limit percent, reset time, and empty-state reasons when ratio inputs are missing.
- [ ] Step 2: Add failing graph tests for `updatedAt`, `createdAt`, child sorting by `created_at_ms`, open/closed status, depth truncation, and child metadata fallback when the child thread row is missing.
- [ ] Step 3: Add failing diagnostics summary tests for failed-tool counts from rollout facts even when observed logs schema has no command columns.
- [ ] Step 4: Run focused tests and confirm failures.
- [ ] Step 5: Implement token series derivation from the enriched `TokenSnapshot` shape without synthesizing cached ratio data.
- [ ] Step 6: Update state graph query to select `created_at_ms` and `updated_at_ms`, preserve deterministic child order, and expose those fields through `AgentNode`.
- [ ] Step 7: Update diagnostics summary merging so warning counts come from logs and failed tool counts come from rollout facts for requested thread IDs.
- [ ] Step 8: Run focused verification.
- [ ] Step 9: Commit this task. Suggested message: `fix: enrich graph token diagnostics payloads`

### Task 5: Prove The Frontend Can Consume The Enriched API Data

**Depends On:** Task 2, Task 3, Task 4

**Execution:** sub-agent lane: UI consumption and E2E; parallel with none; checkpoint focused Playwright smoke

**Files:**
- Modify: `src/frontend/api/client.ts`, `src/frontend/views/TimelineView.tsx`, `src/frontend/components/TimelineEventRow.tsx`, `src/frontend/components/TimelineScrubber.tsx`
- Modify: `src/frontend/views/TokensView.tsx`, `src/frontend/views/AgentGraphView.tsx`, `src/frontend/views/DiagnosticsView.tsx`
- Test: `tests/e2e/timeline-detail.spec.ts`, `tests/e2e/graph-tokens.spec.ts`, `tests/e2e/diagnostics-ui.spec.ts`

**Service Wiring Rows Covered:**
- Observed rollout timeline
- Spawn child navigation data
- Full token metadata
- Observed diagnostics logs
- Failed command summaries

**Agent-Run Acceptance:**
- Automation command: `npm run e2e -- timeline-detail.spec.ts graph-tokens.spec.ts diagnostics-ui.spec.ts`
- Expected result: browser tests prove enriched payloads are visible or actionable in the existing views without adding new product scope.
- Evidence to collect: Playwright output and screenshots/traces for Timeline, Tokens, Graph, and Diagnostics.

**Test Mode Disclosure:**
- Automated tests: real local API server with generated temp Codex fixtures
- Production/dev path exercised: yes, browser -> API -> local source fixtures
- Mock-only risk: visual polish of newly exposed fields may need a later design pass
- Required real dependencies: Playwright browser runtime
- Blocking if unavailable: yes

**TDD Approval Gate:** required for delegated behavior work.
- Worker writes or updates tests first.
- Worker runs focused tests and records the expected failure.
- Worker returns test intent, covered requirements, command, expected failure, and affected files to the phase owner.
- Phase owner approves that the tests satisfy the task requirements before implementation starts.
- Worker implements only after approval, then reruns the approved tests until green.

- [ ] Step 1: Update Playwright fixtures to start the real API with observed source fixtures.
- [ ] Step 2: Add failing Timeline E2E assertions for all expected event groups, joined tool output, exit code, duration, token strip data, agent report row, and spawn-child action target.
- [ ] Step 3: Add failing Tokens E2E assertions for cached-ratio empty state, last input/output, context window, plan type, rate limit, and reset display.
- [ ] Step 4: Add failing Graph E2E assertions for open-child status, depth truncation, selected inspector metadata, and Timeline drill-down target.
- [ ] Step 5: Add failing Diagnostics E2E assertions for observed logs filters, loudest target navigation, warning badges, and rollout-derived failed-command summaries.
- [ ] Step 6: Add failing Sessions E2E assertions that the Sessions list badges reflect diagnostics warning counts and rollout-derived failed-command counts for the selected observed-schema fixture.
- [ ] Step 7: Run focused E2E and confirm failures.
- [ ] Step 8: Wire the UI to consume existing enriched API fields using existing view layout patterns; avoid new feature surfaces beyond proving the handoff-required data is present.
- [ ] Step 9: Run focused verification.
- [ ] Step 10: Commit this task. Suggested message: `test: prove observatory enriched api consumption`

### Task 6: Complete Integration, Regression, And Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3, Task 4, Task 5

**Execution:** phase-owner; parallel with none; checkpoint full phase command set

**Owner-Only Justification:** Final integration verification, acceptance packet creation, and evidence reconciliation are phase-owner responsibilities rather than substantial feature implementation.

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-27-observatory-api-design-data-gap-closure.md`
- Modify: any files from earlier tasks only for integration fixes required by the full gate

**Service Wiring Rows Covered:**
- Observed rollout timeline
- Spawn child navigation data
- Full token metadata
- Observed diagnostics logs
- Failed command summaries
- Cache and live tail facts

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run e2e -- timeline-detail.spec.ts graph-tokens.spec.ts diagnostics-ui.spec.ts && npm run privacy:check`
- Expected result: all focused and regression commands pass; acceptance packet records exact command output, artifacts, source fixture coverage, best-effort local `$CODEX_HOME` validation pass/skip reason, and residual risks.
- Evidence to collect: command output, Playwright artifacts, API sample payloads, fixture schema summary, local `$CODEX_HOME` validation result or skip reason, and final git status.

**Test Mode Disclosure:**
- Automated tests: real local API with temp state DB, rollout JSONL, logs DB, raw log, and cache fixtures
- Production/dev path exercised: yes, API server and browser paths use production/dev code against generated local sources
- Mock-only risk: private real Codex source validation may be skipped unless available locally
- Required real dependencies: local Node, SQLite, filesystem, Playwright browsers
- Blocking if unavailable: yes

**TDD Approval Gate:** not applicable because this is integration and acceptance packet work.

- [ ] Step 1: Run full focused command set and fix integration regressions only inside this phase scope.
- [ ] Step 2: Run privacy checks to confirm new preview fields do not leak secrets or base instructions by default.
- [ ] Step 3: If `$CODEX_HOME` is set or the default local Codex home is present and readable, run the app/API against that local source in read-only mode and verify Sessions, Timeline, Tokens, Agent Graph, and Diagnostics endpoints respond without source mutation. If unavailable or unreadable, record the exact skip reason.
- [ ] Step 4: Record acceptance evidence in `docs/qa/phase-acceptance/2026-05-27-observatory-api-design-data-gap-closure.md`, including the local `$CODEX_HOME` validation pass/skip result.
- [ ] Step 5: Include a fixture ledger section with disposition `test-only` for generated Codex source fixtures and no production/dev mock path remaining.
- [ ] Step 6: Record downstream assumptions: observed logs schema supported, observed rollout envelopes supported, enriched token/graph/timeline facts available, and raw/unredacted reveal remains out of scope.
- [ ] Step 7: Commit this task. Suggested message: `docs: record observatory api gap closure acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: TypeScript passes for browser and Node projects with enriched contracts.
- Run: `npm run test -- --run`
  Expected: Unit and integration tests pass, including observed rollout/log fixtures.
- Run: `npm run e2e -- timeline-detail.spec.ts graph-tokens.spec.ts diagnostics-ui.spec.ts`
  Expected: Browser flows consume enriched API data through Timeline, Tokens, Agent Graph, and Diagnostics.
- Run: `npm run privacy:check`
  Expected: Preview redaction still applies to new fields and raw/base-instruction content is not shipped by default.

**Required Service Wiring Coverage:**
- Observed rollout timeline - `tests/unit/parseRollout.test.ts`, `tests/integration/timelineApi.test.ts`, and `tests/e2e/timeline-detail.spec.ts`.
- Spawn child navigation data - `tests/integration/timelineApi.test.ts`, `tests/integration/graphTokensApi.test.ts`, and `tests/e2e/timeline-detail.spec.ts`.
- Full token metadata - `tests/unit/tokenSeries.test.ts`, `tests/integration/graphTokensApi.test.ts`, and `tests/e2e/graph-tokens.spec.ts`.
- Observed diagnostics logs - `tests/integration/logStore.test.ts`, `tests/integration/diagnosticsApi.test.ts`, and `tests/e2e/diagnostics-ui.spec.ts`.
- Failed command summaries - `tests/unit/parseRollout.test.ts`, `tests/integration/diagnosticsApi.test.ts`, and `tests/e2e/diagnostics-ui.spec.ts`.
- Cache and live tail facts - `tests/integration/rolloutCache.test.ts`, `tests/integration/liveTail.test.ts`, and `tests/integration/timelineApi.test.ts`.
- Best-effort local `$CODEX_HOME` validation - acceptance packet records endpoint validation against readable local sources, or the exact skip reason when unavailable.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-27-observatory-api-design-data-gap-closure.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every service-wiring row has evidence, and the acceptance packet exists with current commit evidence and mock/fixture ledger disposition.

## Mock And Fixture Ledger

| Mock/Fixture | Runtime Path Affected | Disposition | Conversion Requirement |
| --- | --- | --- | --- |
| Generated `state_5.sqlite` fixture | Tests only | test-only | No conversion; production/dev path uses local `$CODEX_HOME/state_5.sqlite`. |
| Generated rollout JSONL fixture | Tests only | test-only | No conversion; production/dev path streams selected local rollout files. |
| Generated observed `logs_2.sqlite` fixture | Tests only | test-only | No conversion; production/dev path opens local `$CODEX_HOME/logs_2.sqlite`. |
| Playwright temp `$CODEX_HOME` | Tests only | test-only | No conversion; it exists to prove local API wiring deterministically. |

## Downstream Assumptions After Completion

- The API contract represents observed Codex rollout envelopes, not only the prototype fixture shape.
- Diagnostics supports the observed `logs_2.sqlite` schema documented on 2026-05-26.
- Failed-tool and failed-command counts are derived from rollout facts when logs do not contain command-specific columns.
- Timeline consumers can depend on joined tool result fields and spawn-child metadata.
- Tokens consumers can depend on exact token_count fields being preserved or explicitly reported as unavailable.
- Agent Graph consumers can depend on created/updated timestamps and deterministic child ordering.
