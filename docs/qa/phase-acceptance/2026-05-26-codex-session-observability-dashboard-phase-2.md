# Phase 2 Acceptance - Sessions Index

Phase plan: `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-2-sessions-index.md`

Phase state: `docs/implementation-runs/2026-05-26-codex-session-observability-dashboard/phases/2026-05-26-codex-session-observability-dashboard-phase-2.yaml`

Phase branch: `impl/phase-2-sessions-index`

## Smoke-Testable Outcome

Phase 2 replaces the Sessions view with a real read-only `state_5.sqlite` index through the local API. The app resolves safe `CODEX_HOME` paths, checks schema availability, lists sessions sorted by `updated_at_ms` descending, composes filters, shows child/open counts, supports row selection for placeholder detail views, and records a 500-row first-paint performance guard without rollout JSONL reads on the list path.

Timeline, Agent Graph, Tokens, and Diagnostics remain fixture-backed placeholders per the phase boundary.

## Commits

| Task | Commit | Summary |
| --- | --- | --- |
| Task 1 | `2d2ea03` | Integrate read-only Codex state store |
| Task 2 | `cb59ad5` | Integrate health, sessions, and thread API routes |
| Task 3 | `c566f27` | Wire Sessions view to state DB API |
| Task 4 | `fdad1dc` | Add sessions first-paint guard |
| Task 5 | `6758a23` | Acceptance packet and final evidence |

## Service Wiring

| Flow | Evidence | Result |
| --- | --- | --- |
| Health and source availability | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/task-2-implementation-focused-test.txt` | API health reports real state DB schema, read-only support, missing DB, and unsupported schema errors. |
| Sessions first paint | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/task-4-implementation-focused-test.txt` | Browser renders 500 SQLite-backed rows in 201ms under the 3500ms threshold; newest session appears first. |
| Session lookup | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/task-3-implementation-focused-test.txt` | Playwright row click selects a real session row and preserves the placeholder Timeline detail route. |
| Filter composition | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/task-3-implementation-focused-test.txt` | Unit and browser tests cover serialized query params and composed search/source/role/model/archive/token filters through the API. |

## Acceptance Commands

| Command | Result | Artifact |
| --- | --- | --- |
| `npm run typecheck` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/task-5-full-commands.txt` |
| `npm run test -- --run` | Pass, 7 files and 29 tests | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/task-5-full-commands.txt` |
| `npm run e2e -- --grep @sessions` | Pass, 3 Playwright tests | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/task-5-full-commands.txt` |
| `npm run perf:sessions` | Pass, 500 rows in 201ms | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/task-5-full-commands.txt` |
| Mock/fixture audit scan | Pass, reviewed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-2/mock-fixture-audit.txt` |

## Mock/Fixture Ledger

| ID | Kind | Scope | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| `mf-phase2-001` | Fixture | Test-only temp Codex home SQLite fixture | `test-only` | `task-1-integration-focused-test.txt` |
| `mf-phase2-002` | Fixture | Test-only sessions API SQLite fixtures | `test-only` | `task-2-implementation-focused-test.txt` |
| `mf-phase2-003` | Fixture | Test-only JSONL read trap preloader | `test-only` | `task-2-implementation-focused-test.txt` |
| `mf-phase2-004` | Fixture | Test-only Playwright state DB fixture | `test-only` | `task-3-implementation-focused-test.txt` |
| `mf-phase2-005` | Fixture | Test-only 500-row performance fixture | `test-only` | `task-4-implementation-focused-test.txt` |

Audit review: runtime-relevant fixture matches are expected phase boundaries. `src/backend/api/fixtures.ts`, `src/fixtures/observatoryFixtures.ts`, fixture source tags, and fixture-backed client fallbacks remain for Timeline, Agent Graph, Tokens, Diagnostics, and jsdom/local fallback behavior. The Sessions runtime path is covered by `state-db` API evidence and Playwright/perf evidence. Test fixture matches under `tests/**`, `playwright.config.ts`, and `scripts/perf/**` are tracked above. Documentation and design-prototype matches are not runtime service wiring.

## Real Data

Private local `~/.codex` validation was not run. The phase plan permits completion with generated temp `state_5.sqlite` fixtures unless the user requires private real-data validation.

## Residual Risks

- Warning and failed-tool counts remain placeholder statuses until later rollout/log source phases.
- Private Codex schema drift may differ from generated fixtures; unsupported schemas return typed errors instead of falling back to fixture Sessions.

## Lessons

No repo lessons were promoted during this phase.

## Downstream Assumptions

- Later phases may use real `SessionSummary`, `getThread`, safe source path validation, and `thread_spawn_edges` child/open counts.
- Later views can keep using fixture placeholders until their own phases replace Timeline, Agent Graph, Tokens, and Diagnostics data sources.
