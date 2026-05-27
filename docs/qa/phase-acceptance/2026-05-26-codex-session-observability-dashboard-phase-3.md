# Phase 3 Acceptance - Timeline Cache

Phase plan: `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-3-timeline-cache.md`

Phase branch: `impl/phase-3-timeline-cache`

## Outcome

Phase 3 makes selected session Timeline detail real. The app resolves `threads.rollout_path` through the read-only state DB, parses rollout JSONL through tolerant streaming helpers, writes derived cache facts under `.observatory/cache/v1`, redacts previews before render/cache use, collapses large tool output, renders scrubber ticks and filters, and supports selected-session byte-offset tailing.

Sessions first-paint behavior remains separate from rollout parsing; Timeline parsing starts only when the Timeline route requests `/api/timeline`.

## Commits

Implementation commits are on `impl/phase-3-timeline-cache`; the final commit is recorded in phase state after this packet is committed.

## Service Wiring

| Flow | Evidence | Result |
| --- | --- | --- |
| Timeline detail load | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/e2e-timeline.txt` | Browser opens selected session and receives real API payload from temp `state_5.sqlite` plus rollout JSONL/cache. |
| Rollout parse/cache | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/vitest.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/perf-rollout.txt` | Parser/cache tests cover cold, warm, stale, corrupt cache fallback; perf shows warm cache faster than cold parse. |
| Redacted tool previews | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/vitest.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/e2e-timeline.txt` | Unit/integration/browser checks prove secret-like values are redacted before render and raw output is hidden behind explicit expansion. |
| Selected rollout tail | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/vitest.txt`, `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/e2e-timeline.txt` | Tail tests cover byte offsets, incomplete lines, truncation rebuild, and browser append updates without replacing existing rows. |

## Commands

| Command | Result | Artifact |
| --- | --- | --- |
| `npm run typecheck` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/typecheck.txt` |
| `npm run test -- --run` | Pass, 44 tests | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/vitest.txt` |
| `npm run e2e -- --grep @timeline` | Pass, 1 Playwright test | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/e2e-timeline.txt` |
| `npm run perf:rollout` | Pass, 2500 events, cold 21ms, warm 1ms | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/perf-rollout.txt` |
| `npm run lint` | Pass | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/lint.txt` |
| Mock/fixture audit scan from `qa-acceptance.md` | Pass, reviewed | `docs/qa/artifacts/2026-05-26-codex-session-observability-dashboard-phase-3/mock-fixture-audit.txt` |

## Mock/Fixture Ledger

| ID | Kind | Scope | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| `mf-phase3-001` | Fixture | Temp rollout JSONL files in unit/integration/E2E tests | `test-only` | `vitest.txt`, `e2e-timeline.txt` |
| `mf-phase3-002` | Fixture | Temp `state_5.sqlite` rows used by API/E2E harnesses | `test-only` | `vitest.txt`, `e2e-timeline.txt` |
| `mf-phase3-003` | Fixture | Existing fixture shell/client fallback and not-yet-real non-Timeline views | `intentional-phase-boundary` | Phase 1/2 acceptance packets; Phase 3 E2E proves Timeline real path independently. |
| `mf-phase3-004` | Generated test data | Rollout perf JSONL data | `test-only` | `perf-rollout.txt`, `vitest.txt` |

Audit review: runtime-relevant fixture matches are the pre-existing fixture shell, API fixture handler, and frontend fixture fallback retained from Phases 1-2. They do not satisfy Phase 3 service wiring. Phase 3 Timeline evidence exercises browser -> real API -> temp state DB -> rollout JSONL -> derived cache. Test matches under `tests/**`, `playwright.config.ts`, and `scripts/perf/**` are tracked above. Documentation matches and package-lock dependency names are not runtime service-wiring fakes.

## Secrets

No secret material was generated or changed. Redaction tests use synthetic secret-like strings only.

## Escalations

None. Private local transcript validation was not run; the phase plan permits generated representative JSONL fixtures unless the user requires private real transcripts.

## Downstream Assumptions

- Phase 4 can consume `CachedRolloutFacts.events`, `toolCalls`, and `tokenSnapshots` instead of reparsing rollout JSONL.
- Cache invalidation is keyed by parser version, rollout path, source mtime, and source size.
- Timeline payloads expose `nextByteOffset`; live append consumers should request `/api/timeline?threadId=<id>&fromByte=<offset>`.
- Unknown rollout events become warning timeline rows instead of breaking parsing.
