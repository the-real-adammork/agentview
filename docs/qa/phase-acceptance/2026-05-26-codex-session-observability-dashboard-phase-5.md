# Phase 5 Acceptance: Diagnostics Hardening

Phase plan: `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`

Phase: `2026-05-26-codex-session-observability-dashboard-phase-5`

## Outcome

Phase 5 completes the v0.1 read-only dashboard boundary. Diagnostics filters, failed-command summaries, warning badges, raw advanced tail, partial source errors, and final privacy/accessibility/performance gates are covered by automated evidence against the local API and temp local source files.

Private real Codex logs/raw TUI data validation was not run. The phase plan permits generated temp fixtures unless the user requires private real-data validation.

## Task Commits

- Task 1, diagnostics API: `a3bf119`
- Task 3, privacy/source hardening: `8bb44bb`
- Task 2, diagnostics UI/raw tail: `05a9625`
- Task 4, final quality gates: `f4b9b13`
- Task 5, acceptance integration: `27e1940`

## Service Wiring

| Flow | Status | Evidence |
| --- | --- | --- |
| Structured diagnostics | Passed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-1-integration-focused-test.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-2-diagnostics-e2e.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-e2e.txt` |
| Failed command summaries | Passed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-1-integration-focused-test.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-2-diagnostics-e2e.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-e2e.txt` |
| Sessions warning badges | Passed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-1-integration-focused-test.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-2-diagnostics-e2e.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-e2e.txt` |
| Raw advanced tail | Passed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-2-focused-tests.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-2-diagnostics-e2e.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-e2e.txt` |
| Partial error handling | Passed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-3-source-errors.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/task-4-hardening-e2e.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-e2e.txt` |
| Final privacy/a11y/performance | Passed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-privacy-check.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-a11y.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-perf-all.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-tokens-check.txt` |

## Commands

| Command | Result | Artifact |
| --- | --- | --- |
| `npm run typecheck` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-typecheck.txt` |
| `npm run test -- --run` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-vitest.txt` |
| `npm run e2e` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-e2e.txt` |
| `npm run a11y` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-a11y.txt` |
| `npm run perf:all` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-perf-all.txt` |
| `npm run privacy:check` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-privacy-check.txt` |
| `npm run tokens:check` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/phase-5-acceptance-tokens-check.txt` |
| `rg -n --hidden --glob '!node_modules' --glob '!.git' --glob '!docs/qa/artifacts/**' --glob '!docs/implementation-runs/**' 'mock\|fixture\|fake\|stub\|noop\|no-op\|placeholder\|TODO.*real\|temporary.*fake\|fixture-only\|disabled network' .` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-5/mock-fixture-audit.txt` |

## Mock And Fixture Ledger

All Phase 5 ledger entries are reconciled as test-only:

- `mf-phase5-001`: temp `logs_2.sqlite` diagnostics fixture for log-store and diagnostics API tests.
- `mf-phase5-002`: generated rollout-cache failed-tool fallback fixture for logs-missing summary coverage.
- `mf-phase5-003`: temp Codex home source-error fixtures for path guards and typed partial-error envelopes.
- `mf-phase5-004`: diagnostics E2E temp logs/raw/cache fixtures for browser-to-local-API coverage.

The mock/fixture audit also finds runtime fixture shell and fallback code in `src/backend/api/fixtures.ts`, `src/fixtures/observatoryFixtures.ts`, `src/frontend/api/client.ts`, and `src/frontend/App.tsx`. Those are pre-existing local demo/dev fallback boundaries from earlier phases and are not used as Phase 5 service-wiring proof. Phase 5 real-path evidence covers `state-db`, `rollout-cache`, `logs-db`, and `raw-log` API sources through integration and Playwright acceptance artifacts.

Test helper, perf, and Playwright fixture matches are test-only and do not invalidate acceptance.

## Secrets And Privacy

No credential, environment, or secret-bearing config was generated or changed. Privacy evidence passed through `npm run privacy:check`; raw and structured previews are redacted by default, and raw tail remains hidden behind the advanced control.

No `gitleaks` config or scanner is present in this repo. Secret handling verification used git status review plus the repo privacy gate.

## Escalations

None.

## Downstream Assumptions

- v0.1 remains read-only: no Tauri packaging, export/sharing, editor launch, command execution, source mutation, or multi-root selector was added.
- Browser E2E runs with one worker because tests share a generated temp `CODEX_HOME` local source tree.
- Later phases may rely on the Diagnostics route, warning badges, raw advanced tail, privacy check, a11y command, perf command, and full E2E gate as the accepted Phase 5 baseline.

## Lessons

No cross-phase lesson was promoted.
