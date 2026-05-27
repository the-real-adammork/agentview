# Observatory API Design Data Gap Closure Acceptance

Phase plan: `docs/plans/2026-05-27-observatory-api-design-data-gap-closure.md`

Phase: `observatory-api-design-data-gap-closure`

Branch: `impl/observatory-api-design-data-gap-closure`

## Outcome

The local API and frontend now consume observed Codex source shapes for rollout JSONL envelopes, rollout cache facts, `state_5.sqlite` graph metadata, token snapshots, observed `logs_2.sqlite` rows, and diagnostics failed-command summaries. The browser E2E flow proves Sessions, Timeline, Agent Graph, Tokens, and Diagnostics use the enriched payloads through the real local API against generated temp Codex source fixtures.

## Implementation Commits

| Task | Commit | Summary |
| --- | --- | --- |
| 1 | `d947721` | Enriched shared contracts and observed fixture builders. |
| 2 | `fccad47` | Integrated observed rollout envelope parsing and cache/tail/timeline facts. |
| 3 | `568b50c` | Integrated observed `logs_2.sqlite` schema support. |
| 4 | `ccfd310` | Integrated graph node metadata, token metadata, and diagnostics fallback coverage. |
| 5 | `7005a2d` | Integrated frontend consumption E2E proof. |

## Service Wiring Matrix

| Flow | Evidence | Status |
| --- | --- | --- |
| Observed rollout timeline | `docs/qa/artifacts/observatory-api-design-data-gap-closure/ui-consumption-integration.txt` | Covered browser -> API -> rollout JSONL/cache. |
| Spawn child navigation data | `docs/qa/artifacts/observatory-api-design-data-gap-closure/graph-tokens-api-integration.txt`, `docs/qa/artifacts/observatory-api-design-data-gap-closure/ui-consumption-integration.txt` | Covered graph/timeline child metadata and navigation target. |
| Full token metadata | `docs/qa/artifacts/observatory-api-design-data-gap-closure/graph-tokens-api-integration.txt`, `docs/qa/artifacts/observatory-api-design-data-gap-closure/ui-consumption-integration.txt` | Covered token API and Tokens UI fields. |
| Observed diagnostics logs | `docs/qa/artifacts/observatory-api-design-data-gap-closure/logs-schema-adapter-integration.txt`, `docs/qa/artifacts/observatory-api-design-data-gap-closure/ui-consumption-integration.txt` | Covered observed `ts`, `ts_nanos`, `feedback_log_body`, `estimated_bytes` schema. |
| Failed command summaries | `docs/qa/artifacts/observatory-api-design-data-gap-closure/graph-tokens-api-integration.txt`, `docs/qa/artifacts/observatory-api-design-data-gap-closure/ui-consumption-integration.txt` | Covered rollout-cache failed command facts when logs lack derived command columns. |
| Cache and live tail facts | `docs/qa/artifacts/observatory-api-design-data-gap-closure/rollout-parser-integration.txt` | Covered warm cache shape, append tail complete-line reads, offsets. |

## Commands

| Command | Result | Artifact |
| --- | --- | --- |
| `npm run typecheck && npm run test -- --run tests/unit/contracts.test.ts` | Pass | `docs/qa/artifacts/observatory-api-design-data-gap-closure/task-1-contracts.txt` |
| `npm run test -- --run tests/unit/parseRollout.test.ts tests/integration/rolloutCache.test.ts tests/integration/timelineApi.test.ts tests/integration/liveTail.test.ts tests/privacy/privacyPreviews.test.ts` | Pass | `docs/qa/artifacts/observatory-api-design-data-gap-closure/rollout-parser-integration.txt` |
| `npm run test -- --run tests/integration/logStore.test.ts tests/integration/diagnosticsApi.test.ts tests/integration/sourceErrors.test.ts` | Pass | `docs/qa/artifacts/observatory-api-design-data-gap-closure/logs-schema-adapter-integration.txt` |
| `npm run test -- --run tests/unit/tokenSeries.test.ts tests/unit/agentGraph.test.ts tests/integration/graphTokensApi.test.ts tests/integration/diagnosticsApi.test.ts` | Pass | `docs/qa/artifacts/observatory-api-design-data-gap-closure/graph-tokens-api-integration.txt` |
| `npm run e2e -- timeline-detail.spec.ts graph-tokens.spec.ts diagnostics-ui.spec.ts` | Pass | `docs/qa/artifacts/observatory-api-design-data-gap-closure/ui-consumption-integration.txt` |
| `npm run typecheck && npm run test -- --run && npm run e2e -- timeline-detail.spec.ts graph-tokens.spec.ts diagnostics-ui.spec.ts && npm run privacy:check` | Pass | `docs/qa/artifacts/observatory-api-design-data-gap-closure/phase-acceptance-command-set.txt` |
| Mock/fixture audit scan from `qa-acceptance.md` | Pass, reviewed | `docs/qa/artifacts/observatory-api-design-data-gap-closure/mock-fixture-audit.txt` |
| Local `$CODEX_HOME` schema availability check | Pass | `docs/qa/artifacts/observatory-api-design-data-gap-closure/local-codex-home-validation.txt` |

## Mock And Fixture Ledger

| ID | Kind | Scope | Disposition | Why Acceptable |
| --- | --- | --- | --- | --- |
| `mf-task3-observed-logs-sqlite` | Fixture | Test-only observed logs SQLite rows | `test-only` | Exercises production log store and diagnostics API against temp SQLite. |
| `mf-task3-warm-rollout-cache` | Fixture | Test-only failed-command fallback data | `test-only` | Exercises diagnostics fallback behavior with deterministic cache facts. |
| `mf-task2-observed-rollout-jsonl` | Fixture | Test-only observed rollout JSONL | `test-only` | Exercises production parser, cache, tail, timeline API, and privacy paths. |
| `mf-task4-state-graph-fixture` | Fixture | Test-only state DB graph rows | `test-only` | Exercises StateStore and graph API against temp SQLite. |
| `mf-task4-rollout-token-fixture` | Fixture | Test-only rollout token/diagnostics facts | `test-only` | Exercises production token and diagnostics APIs with deterministic normalized facts. |
| `mf-task5-playwright-observed-codex-home` | Fixture | Test-only Playwright `CODEX_HOME` | `test-only` | Exercises browser -> real local API -> filesystem/SQLite paths with generated observed source data. |

Audit review: relevant runtime matches are the pre-existing fixture fallback API/client and typed fixture data retained for offline shell behavior, plus test-only generated SQLite/JSONL/cache fixtures tracked above. Acceptance evidence for this phase uses real local API handlers and production parser/store paths against generated temp source data; no service-wiring row is accepted from mock-only runtime behavior. Documentation, historical acceptance packets, design notes, and package-lock matches are not runtime service-wiring fakes.

## Privacy And Local Validation

`npm run privacy:check` passed in the full acceptance command set. New preview fields remain redacted by default, and no raw transcript/log/base-instruction reveal path was added.

Best-effort local `$CODEX_HOME` validation found readable `/Users/adam/.codex/state_5.sqlite`, `/Users/adam/.codex/logs_2.sqlite`, and sessions directory. The artifact records schema support only, without dumping private rows or transcript content.

## Escalations

None.

## Residual Risks

- `node:sqlite` still emits Node 24 experimental warnings during tests.
- Future Codex event names or shell output wrapper formats may need additional parser aliases.
- Private real transcript content was not enumerated in acceptance evidence; generated observed-schema fixtures remain the primary proof, with local schema availability checked separately.

## Downstream Assumptions

Later work may rely on enriched `TimelineEvent`, `CachedRolloutFacts`, `TokenSnapshot`, `AgentNode`, and observed diagnostics log support. The UI has visible proof paths for joined tool output/duration, token metadata, graph child metadata/navigation, diagnostics warning/failed command badges, and observed logs filtering.
