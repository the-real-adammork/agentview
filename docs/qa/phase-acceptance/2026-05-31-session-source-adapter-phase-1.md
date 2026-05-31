# Phase 1 Acceptance: Codex Source Extraction

Phase plan: `docs/plans/2026-05-31-session-source-adapter-phase-1-codex-source-extraction.md`

Overview / locked contracts: `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md`

Phase: `2026-05-31-session-source-adapter-phase-1`

## Outcome

Phase 1 introduces the `SessionSource` adapter seam with **zero behavior change**:

- `src/backend/sources/SessionSource.ts` — the locked `SessionSource` interface plus
  `ResolvedSession`, `SourceHealth`, `SourceTailResult`, copied verbatim from the
  overview's locked contracts. `SourceId = "codex" | "claude-code"` is declared
  inline here (NOT added to `src/shared/contracts.ts`) per locked decision #2;
  Phase 2 relocates it to contracts with the same union, no rename.
- `src/backend/sources/codex/CodexSource.ts` — `createCodexSource({ codexHome })`,
  a pure delegating wrapper over `openStateStore` / `getRolloutFactsWithCache` /
  `parseRolloutFile` / `tailRolloutFile`, with a replicated traversal-guarded
  `resolveRolloutPath` (identical logic to the timeline handler's, copied to avoid
  an import cycle once the handler imports `CodexSource`).
- The four Codex API consumers (`health`, `sessions`, `timeline`, `agentGraph`)
  now obtain every Codex primitive through a per-request `CodexSource` instance
  (1:1 swap for the old `openStateStore` open/close, closed in the same `finally`).

Codex behavior is byte-identical: every pre-existing unit/integration test passes
unmodified, and the full e2e pass/fail set is identical with the refactor reverted
(see `e2e-baseline-comparison.txt`). Private real `~/.codex` validation was not run;
the phase plan permits generated temp fixtures unless the user requires private
real-data validation.

## Task Commits

- Task 1, SessionSource interface + adapter types: `d7ceebc`
- Task 2, CodexSource delegating wrapper: `5cac5dd`
- Task 3, re-point health/sessions/timeline/agentGraph through CodexSource: `351b275`
- Task 4, acceptance packet: this commit

## Service Wiring

| Flow | Status | Evidence |
| --- | --- | --- |
| Health and source availability | Passed | `artifacts/.../focused-tests.txt` (codexSource getHealth/stateDbSchema), `artifacts/.../vitest.txt` (sourceErrors.test.ts 503 path), `artifacts/.../direct-api-proof.txt` (/api/health) |
| Sessions list + lookup | Passed | `artifacts/.../focused-tests.txt` (codexSource listSessions/getSession deep-equal), `artifacts/.../vitest.txt` (sessionsApi.test.ts) |
| Timeline (cold/warm/stale + tail) | Passed | `artifacts/.../focused-tests.txt` (codexSource parse/tail equivalence), `artifacts/.../vitest.txt` (timelineApi.test.ts, liveTail.test.ts), `artifacts/.../direct-api-proof.txt` (/api/timeline ok:true) |
| Timeline +Subs subtree | Passed | `artifacts/.../focused-tests.txt` (codexSource listChildren matches subtree computation), `artifacts/.../vitest.txt` (timelineApi.test.ts subtree spec) |
| Agent graph | Passed | `artifacts/.../vitest.txt` (graphTokensApi.test.ts, agentGraph.test.ts unchanged via CodexSource.getAgentGraphRows accessor) |

## Commands

| Command | Result | Artifact |
| --- | --- | --- |
| `npm run typecheck` | Pass | `artifacts/2026-05-31-session-source-adapter-phase-1/typecheck.txt` |
| `npm run lint` | Pass (0 warnings) | `artifacts/2026-05-31-session-source-adapter-phase-1/lint.txt` |
| `npm run test -- --run tests/unit/sessionSourceContract.test.ts tests/integration/codexSource.test.ts` | Pass (13 tests) | `artifacts/2026-05-31-session-source-adapter-phase-1/focused-tests.txt` |
| `npm run test -- --run` | Pass (413 tests, 57 files) | `artifacts/2026-05-31-session-source-adapter-phase-1/vitest.txt` |
| `npm run privacy:check` | Pass | `artifacts/2026-05-31-session-source-adapter-phase-1/privacy-check.txt` |
| `npm run e2e --grep "@sessions\|@timeline\|@graph-tokens"` | 7 pass / 3 fail (pre-existing) | `artifacts/2026-05-31-session-source-adapter-phase-1/e2e-tagged-branch.txt` |
| e2e baseline-vs-branch comparison | Identical pass/fail set | `artifacts/2026-05-31-session-source-adapter-phase-1/e2e-baseline-comparison.txt` |

## Codex method equivalence (CodexSource integration test)

`tests/integration/codexSource.test.ts` asserts each `CodexSource` method against the
existing direct primitive over a temp `createCodexHomeFixture`:

- `id` → `"codex"`.
- `getHealth()` → `{ source: "codex", available: true }` (no `detail`) for a supported
  store; `{ available: false, detail: "Unsupported state_5.sqlite schema…" }` for an
  unsupported one (structural assertion).
- `listSessions(filter, page)` → **deep-equal** to `StateStore.listSessions` for a
  search + archived + token-bound filter and a paged window.
- `getSession(id)` → **deep-equal** to `StateStore.getThread`; missing id → `null`.
- `resolveSession(id)` → `{ source, sessionId, rawLogPath }` with the absolute path the
  timeline handler resolves today; rejects traversal (`RolloutPathTraversalError`) and
  missing-file (`RolloutNotFoundError`) the same way (structural assertion).
- `parse(resolved)` → **deep-equal** to `getRolloutFactsWithCache(...).facts` (isolated
  `AGENTVIEW_CACHE_ROOT` per call).
- `listChildren(rootId, scanDepth)` → **deep-equal** to the unique non-root descendant
  `SessionSummary[]` the timeline subtree branch computes today.
- `tail(resolved, fromByte)` → `events` equal `tailRolloutFile(...).payload.events`,
  `nextByte` equals `payload.nextByteOffset`, `nextLine` equals `sourceLine + linesRead`
  (structural assertion).
- `close()` disposes the store and a later call lazily reopens; the DB file mtime is
  unchanged (read-only).

## Decisions recorded for downstream phases

1. **Per-request `CodexSource` lifecycle (locked decision #5).** Each handler creates
   `createCodexSource({ codexHome })` and `close()`s it in the existing `finally`, a 1:1
   swap for the old per-request `openStateStore`/`close`. The overlay/connection caching
   already lives in `stateStore.ts`, so a process-wide instance was deliberately deferred
   to Phase 2's registry — changing lifecycle here would be behavior-affecting.

2. **Timeline `parse` vs `cacheStatus`+warnings split.** The locked `SessionSource.parse`
   returns only `CachedRolloutFacts`, but the timeline cold path needs `cacheStatus` and
   the cache `warnings`. Decision: `CodexSource` exposes a **Codex-internal accessor**
   `parseWithCache(resolved): Promise<RolloutCacheResult>` (returns `{ facts, status,
   warnings, cachePath }`) used by the handler, while the locked cross-source `parse`
   returns `.facts`. This keeps `cacheStatus` and warnings ordering byte-identical without
   widening the locked method. Same pattern blessed by the plan for the agent-graph rows.

3. **Tail warnings/truncation.** The locked `SourceTailResult` has no `warnings` field, so
   tail truncation/parse warnings cannot travel through it. Decision: `CodexSource` exposes
   a Codex-internal `tailRaw(resolved, fromByte, sourceLine): Promise<TailRolloutResult>`
   returning the full `{ payload, truncated, warnings, linesRead }`; the timeline tail
   branch uses it so `warnings` order (`[...cached.warnings, ...tail.warnings]`) and the
   `tail` `cacheStatus` stay byte-identical. The locked cross-source `tail` (which derives
   `sourceLine` internally via `parse`) is still implemented and covered by the integration
   test, ready for cross-source callers in later phases.

4. **AgentGraph internal accessor (per Task 3 step 4).** `deriveAgentGraph` consumes
   `AgentGraphRow[]`, which is richer than the cross-source `SessionSummary[]`. The
   `agentGraph` handler uses a Codex-internal `CodexSource.getAgentGraphRows(rootId,
   scanDepth)` accessor (delegates to `StateStore.getAgentGraphRows`) so `deriveAgentGraph`
   input is unchanged. Phase 5 generalizes graph derivation for CC; not now.

5. **`resolveRolloutPath` replication.** `CodexSource.resolveSession` replicates the timeline
   handler's `resolveRolloutPath` verbatim (same traversal guard, same `RolloutPathTraversalError`
   / `RolloutNotFoundError` names) rather than importing it, because Phase 1 has the handler
   import `CodexSource` — importing the handler back would create a cycle. The handler keeps
   its own exported `resolveRolloutPath` for the out-of-scope consumers (`timelineRaw`, `tokens`,
   `diagnostics`, `liveSources`), which are re-pointed in Phase 2.

## Out-of-scope (deferred), confirmed untouched this phase

`src/backend/api/timelineRaw.ts`, `tokens.ts`, `diagnostics.ts`, `src/backend/live/liveSources.ts`,
`src/backend/live/liveRuntime.ts`, `src/shared/contracts.ts`, the frontend, `EdgeSource`, the
registry, the `sourceId` wire param, and any second source. These are Phase 2+.

## Mock And Fixture Ledger

All Phase 1 test data is test-only temp fixtures:

- `mf-phase1-001`: `createCodexHomeFixture` temp `state_5.sqlite` (threads + edges) for every
  `CodexSource` method equivalence assertion.
- `mf-phase1-002`: `createUnsupportedCodexHomeFixture` temp DB for the `getHealth` unavailable path.
- `mf-phase1-003`: in-test rollout JSONL written under `sessions/*.jsonl` for `parse`/`tail`/
  `resolveSession` coverage, with isolated `AGENTVIEW_CACHE_ROOT` temp dirs.

No production code path uses a mock; `CodexSource` is the exact module the handlers import.

## Pre-existing e2e failures (not introduced by Phase 1)

The local e2e suite has 6 failing specs (3 of them tagged `@timeline`/`@graph-tokens`) that
reproduce identically with the Phase 1 handler changes reverted (Task 3 stashed at baseline
`5cac5dd`). They are UI-visibility timeouts in this local environment, not API regressions.
API-level byte-identity is proven by the unmodified integration suite and `direct-api-proof.txt`.
See `artifacts/2026-05-31-session-source-adapter-phase-1/e2e-baseline-comparison.txt`.
