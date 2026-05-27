# Phase 4 Acceptance - Agent Graph And Tokens

Phase plan: `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-4-graph-tokens.md`  
Phase state: `docs/implementation-runs/2026-05-26-codex-session-observability-dashboard/phases/2026-05-26-codex-session-observability-dashboard-phase-4.yaml`  
Phase branch: `impl/phase-4-graph-tokens`  
Commit range: `7413754..HEAD`

## Smoke-Testable Outcome

A selected session now loads real Agent Graph and Tokens views through local API routes. The graph renders depth-limited `thread_spawn_edges` with node selection, status styling, missing-metadata placeholders, and Timeline navigation. The Tokens view renders rollout-cache token snapshots, aggregate bars, token curve, rate-limit meters, cached-ratio empty-state reasons, and top-session drill-down.

## Task Commits

| Task | Commit | Outcome |
| --- | --- | --- |
| Task 1 | `70dcac7`, merged by `59727cd` | Added graph derivation, state-store edge traversal, `/api/agent-graph`, and unit/integration coverage. |
| Task 2 | `15910b6`, merged by `541bb19` | Added token series derivation, `/api/tokens`, and rollout-cache integration coverage. |
| Task 3 | `524b251` | Added real graph/token React views, components, app API wiring, unit component tests, and `@graph-tokens` E2E. |
| Task 4 | `2d4f1e8` | Acceptance evidence, mock/fixture reconciliation, and packet. |

## Service Wiring Matrix

| Flow | Evidence | Result |
| --- | --- | --- |
| Agent graph render | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/tasks-1-2-integration-focused-test.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/phase-4-acceptance-e2e-graph-tokens.txt` | Pass. Browser and integration tests exercise UI -> API -> temp `state_5.sqlite.thread_spawn_edges`/`threads`, depth 1/2, status summary, missing child metadata, inspector, and Timeline navigation. |
| Token series render | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/tasks-1-2-integration-focused-test.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/phase-4-acceptance-e2e-graph-tokens.txt` | Pass. Browser and integration tests exercise UI -> `/api/tokens` -> Phase 3 rollout parser/cache -> temp JSONL, aggregate totals, token curve, rate meters, cached-ratio guard, and empty-state reasons. |
| Cross-view navigation | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/task-3-e2e-graph-tokens.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/phase-4-acceptance-e2e-graph-tokens.txt` | Pass. Playwright double-clicks a graph node and clicks a Tokens top-session row, both routing to Timeline. |

## Acceptance Commands

| Command | Result | Artifact |
| --- | --- | --- |
| `npm run typecheck` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/phase-4-acceptance-typecheck.txt` |
| `npm run test -- --run` | Pass, 16 files / 56 tests | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/phase-4-acceptance-vitest.txt` |
| `npm run e2e -- --grep @graph-tokens` | Pass, 1 browser test | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/phase-4-acceptance-e2e-graph-tokens.txt` |
| Mock/fixture audit scan from `qa-acceptance.md` | Pass, reviewed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-4/mock-fixture-audit.txt` |

## Mock/Fixture Ledger

| ID | Kind | Paths | Disposition | Reason |
| --- | --- | --- | --- | --- |
| `mf-phase4-graph-sqlite` | Fixture | `tests/fixtures/codexHome.ts`, `tests/integration/graphTokensApi.test.ts`, `playwright.config.ts` | `test-only` | Creates real temporary `state_5.sqlite` databases and exercises production graph API/state-store code. Runtime code still reads `CODEX_HOME/state_5.sqlite`. |
| `mf-phase4-token-jsonl` | Fixture | `tests/integration/graphTokensApi.test.ts`, `tests/e2e/graph-tokens.spec.ts`, `playwright.config.ts` | `test-only` | Writes real temporary rollout JSONL and uses the Phase 3 parser/cache path. Runtime code still resolves rollout paths from selected real session metadata. |

Audit review: relevant Phase 4 matches are the temp SQLite/JSONL fixtures above, the Playwright fixture setup, unit/component tests, and retained fixture fallback data from Phase 1 for offline shell behavior. None of those fakes satisfy service wiring by themselves; acceptance evidence uses local browser/API flows against generated temp `CODEX_HOME` data and production API handlers. Historical docs/design matches and package-lock dependency names are not runtime service-wiring fakes.

## Secrets

No secret material was generated, changed, or committed. Existing parser/redaction tests still cover secret-like rollout previews.

## Escalations

None. Optional private real deep graph validation was not run; the phase plan permits generated temp edge fixtures unless the user requires private local validation.

## Downstream Assumptions

Phase 5 can rely on `getAgentGraph(rootThreadId, { maxDepth })`, `getTokenSeries(threadId)`, shared graph/token contracts, graph/token app navigation, and the `@graph-tokens` Playwright fixture pattern. Diagnostics, warning badge hydration, logs DB, raw TUI log access, and broader source-hardening remain Phase 5 scope.
