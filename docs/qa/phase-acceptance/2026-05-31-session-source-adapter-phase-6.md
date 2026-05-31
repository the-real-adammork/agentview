# Session Source Adapter — Phase 6 Acceptance (Claude Code Live Tail)

**Date:** 2026-05-31
**Branch:** `feat/session-source-adapter`
**Plan:** `docs/plans/2026-05-31-session-source-adapter-phase-6-cc-live-tail.md`
**Overview / locked contracts:** `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md`

## Scope delivered

`ClaudeCodeSource.tail` (the last unimplemented method of the locked `SessionSource`
interface for CC) plus the live subscription path threaded by `sourceId` so a CC
session streams appended turns over the SSE `timeline` channel exactly like Codex.
Codex live behavior is byte-identical (the Codex live specs pass with **no edits**).

- New: `src/backend/sources/claudeCode/claudeTail.ts` — `tailClaudeTranscript({ path,
  sessionId, fromByte, fromLine })`, the CC analog of `tail/liveTail.ts::tailRolloutFile`.
  Byte-offset incremental read that feeds only newly-appended **complete** lines
  through the Phase 4 `parseClaudeSessionLines` (no forked parser), with the same
  partial-line / truncation mechanics. Also exports `countLinesBefore`.
- Modified: `src/backend/sources/claudeCode/ClaudeCodeSource.ts` — implements the public
  locked `tail(resolved, fromByte): Promise<SourceTailResult>` (self-derives `fromLine`
  via `countLinesBefore`, exposes only the three locked fields) and the source-internal
  `tailLive(resolved, fromByte, fromLine): Promise<LiveTailResult>` the live path uses.
- New capability: `src/backend/sources/SessionSource.ts` adds `LiveTailResult` +
  `LiveTailSource` (a source-internal capability mirroring `AgentGraphRowSource`, NOT on
  the locked `SessionSource`). `CodexSource` and `ClaudeCodeSource` both satisfy it, so
  `liveSources.ts` tails any source with **no `if (codex)` branch**.
- Modified: `src/backend/sources/codex/CodexSource.ts` — adds `tailLive` (wraps the
  existing `tailRolloutFile`/`tailRaw`; byte-identical to the pre-Phase-6 direct call).
- Modified: `src/backend/live/liveSources.ts` — constructed from a `SourceRegistry`
  (legacy `codexHome`-only construction still builds a Codex-only registry internally so
  the timeline path stays byte-identical for Codex). `subscribe` resolves the active
  session via `registry.get(source).resolveSession(threadId)`, watches `resolved.rawLogPath`
  under the unchanged `rollout:<threadId>` key, and tails via `source.tailLive(...)`.
  `LiveSubscribeRequest` gained `source?: SourceId` (default `"codex"`).
- Modified: `src/backend/live/liveRuntime.ts` — builds the shared default registry
  (`createDefaultRegistry()`, the same Codex + CC composition the HTTP handlers use) and
  passes it to `createLiveSources`; `resetLiveRuntime` closes it.
- `src/backend/api/stream.ts` — already parsed `sourceId` (Phase 2) and passes `source`
  onto subscribe; unchanged this phase.
- Tests: `tests/unit/claudeCodeTail.test.ts` (8), `tests/integration/ccLiveTail.test.ts` (4).
- `tests/integration/claudeDiscovery.test.ts` — the Phase 3 placeholder "tail still throws
  (Phase 6)" assertion is flipped to "tail returns a `SourceTailResult` (Phase 6)" (this is
  the CC-discovery test whose stated expectation Phase 6 lands; not a Codex live spec).

## Acceptance commands (real output)

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — `tsc --noEmit` both tsconfigs, no errors. |
| `npm run lint` | **PASS** — `eslint . --max-warnings=0`, zero warnings. |
| `npm run test -- --run` | **PASS** — 73 files, **523 tests passed**. |
| `npm run test -- --run tests/unit/claudeCodeTail.test.ts tests/integration/ccLiveTail.test.ts` | **PASS** — 2 files, **12 tests passed**. |
| `npm run privacy:check` | **PASS** — `privacy check passed`, 4 tests. |
| `npm run e2e -- --grep @timeline` | **PRE-EXISTING ENV FAILURE** (browser layer) — see below. Backend live evidence is the integration test. |

### `npm run e2e -- --grep @timeline` — NOT GREEN IN THIS SANDBOX (pre-existing, environmental)

All three `@timeline` specs fail in this sandbox, **including the two pre-existing Codex
specs Phase 6 never touched** (`renders parsed rollout rows … and tail updates` at
`timeline-detail.spec.ts:19` and `surfaces enriched observed rollout facts …` at `:98`).
The first Codex spec fails at `expect(getByLabel('Timeline events').getByText('Timeline
task started')).toBeVisible()` (line 33) — the timeline event rows never render in the
headless browser, while the page shell (banner/nav) renders fine. The CC arm (`:198`)
times out at the same `waitForResponse` stage for the same reason.

**Proof it is not a Phase 6 regression:** the first Codex `@timeline` spec was run at the
**Task 1 commit (`97b2736`)** — which does NOT touch the live path at all — and it fails
**identically** (`Timeline task started` not visible). This is the exact pre-existing
browser-layer instability Phase 4's and Phase 5's acceptance packets already recorded
(`docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-4.md` §"`@timeline`
e2e is environmentally blocked"). The Codex live "tail updates" assertion lives inside
that environmentally-blocked spec.

**Backend live evidence the tail path is sound (real fs, real watch double, real append):**
`tests/integration/ccLiveTail.test.ts` (4 passed) drives subscribe → `ready` baseline →
`appendFile` a complete CC turn → fire `rollout:<id>` → `timeline` frame carrying exactly
the new event with an advanced `nextByteOffset` and `reset:false`, plus the partial-line
safety case and both Codex-parity cases. `tests/integration/liveSources.test.ts` (3) and
`tests/integration/streamApi.test.ts` (2) — the Codex live specs — pass **unchanged**.

## Service-Wiring coverage

| Flow | Evidence (command + test) | Status |
| --- | --- | --- |
| CC live timeline tail | `tests/integration/ccLiveTail.test.ts` › "subscribes a CC session and streams an appended turn over the timeline channel" — `ready` baseline at EOF, append → `timeline` frame with exactly 1 new `assistant_message`, `nextByteOffset` advanced, `reset:false`. | PASS |
| CC tail offset/partial-line correctness | `tests/unit/claudeCodeTail.test.ts` — cold (events + `nextByte===size` + `nextLine===1+lines`), incremental (only new event, `nextLine===fromLine+1`), no-new (empty, idempotent), partial-trailing (complete line only, fragment bytes not consumed; completes on next newline), no-newline-window (offset does not advance), truncation (`fromByte>size` restarts at 0, warns, `nextLine===1+lines`), and **parser-equivalence** (tail events `.toEqual` the Phase 4 cold-parse events). | PASS |
| Codex live parity | `tests/integration/liveSources.test.ts` (3) + `tests/integration/streamApi.test.ts` (2) pass with **no spec edits**; `@timeline` "tail updates" e2e is the pre-existing env-blocked browser spec (same failure at Task 1 HEAD, untouched Codex specs). | PASS (unit/integration); e2e ENV-BLOCKED |
| Source-generic live dispatch | `tests/integration/ccLiveTail.test.ts` — `source:"claude-code"` resolves the CC tail; "Codex parity: source 'codex'" and "Codex parity: an omitted source defaults to codex" cases prove the `source`-omitted path resolves Codex. Unknown `sourceId` on `/api/stream` degrades to `"codex"` (see Decisions). | PASS |
| Child-agent live tail (decision) | Recorded below as an explicit scoped follow-up (primary transcript only this phase, mirroring Codex), not a silent skip. Verified the live path watches only `rollout:<threadId>` (grep of `liveSources.ts`). | RECORDED |

## Commits

| Commit | Task | Subject |
| --- | --- | --- |
| `97b2736` | Task 1 | feat(sources): implement ClaudeCodeSource.tail incremental CC transcript tail |
| `7d1665e` | Task 2 | feat(live): dispatch live timeline tail by sourceId so CC sessions stream |
| _(this commit)_ | Task 3 | docs: record session-source-adapter phase 6 acceptance |

## Decisions

1. **Child-agent (`subagents/*.jsonl`) live tail — explicit scoped follow-up, NOT silently
   skipped.** A CC session can append to both its primary transcript and its
   `subagents/*.jsonl` children. This phase tails the **primary transcript only**. The live
   path watches exactly one transcript key (`rollout:<threadId>`) — verified by grep of
   `src/backend/live/liveSources.ts` (no descendant/subagent watches). This **mirrors the
   existing Codex behavior**: the Codex live path also watches only the active thread's
   rollout, not descendant rollouts, so descendant growth does not live-stream for Codex
   either; `+SUBS` freshness comes from the periodic re-fetch on the next timeline
   fetch/subscribe (the `subtree` merge folds each child's events in on each fetch), not a
   per-child watch. **Follow-up:** a future phase can watch `extra.subagentsDir/*.jsonl` and
   tail each child via the same `tailClaudeTranscript` mechanism, merging into the `timeline`
   frame under the `+SUBS` scope.
2. **`tokens` live push stays Codex-only.** Only the `timeline` channel becomes
   source-generic in Phase 6. The `tokens` push (and the `sessions`/`diagnostics` snapshots)
   read the Codex state/logs SQLite DBs; CC has no Codex tokens DB and its cold facts already
   carry token snapshots. In `pushTimelineAndTokens` the tokens push is gated on
   `source === "codex" && codexHome`, so it is skipped for CC. `sessions`/`diagnostics` live
   snapshots remain Codex-sourced (they were Codex-only before too — a noted follow-up, not a
   regression). Confirmed by `ccLiveTail.test.ts`: the Codex parity case still asserts a
   `tokens` frame; the CC case asserts only the `timeline` frame.
3. **Unknown-`sourceId` behavior on `/api/stream`.** `stream.ts` parses `sourceId` via the
   Phase 2 `parseSourceId(url)` and **degrades an unknown value to the default `"codex"`**
   (it does not write a JSON 400 on the SSE path). This is the pre-existing Phase 2 behavior
   for the stream endpoint and is preferred because an `EventSource` cannot read a JSON 400
   body — degrading to the default keeps the stream openable rather than dropping the client
   to a confusing error. (The non-live HTTP handlers still return the typed 400 for an unknown
   `sourceId`.) No change to `stream.ts` was needed this phase.
4. **Parser-shape contract (Task 1 Step 0).** `grep -n "parseClaudeSessionLines"
   src/backend/sources/claudeCode/parseClaudeSession.ts` confirmed a **line-level** exported
   parser already exists (the Phase 4 cold parse calls it over the full file). **No extraction
   was needed**; the tail reuses `parseClaudeSessionLines` verbatim. Its real signature is
   `parseClaudeSessionLines(lines, { threadId, rolloutPath, sourceMtimeMs, sourceSizeBytes,
   startingLine })` (the plan's pseudocode `{ sessionId, startingLine }` was illustrative);
   `tailClaudeTranscript` maps `sessionId → threadId` and `fromLine → startingLine`.
5. **Public `tail` vs. internal `tailLive` split.** The locked `SessionSource.tail(resolved,
   fromByte)` returns only `{ events, nextByte, nextLine }`. The live path needs the running
   `fromLine` continuation plus `truncated`/`warnings`, so each source exposes a
   source-internal `tailLive(resolved, fromByte, fromLine): LiveTailResult` (the
   `LiveTailSource` capability). This mirrors the existing `CodexSource.tailRaw` /
   `tailRolloutFile` split and keeps the locked public shape unchanged.
6. **`createLiveSources` back-compat.** `LiveSourcesOptions` now accepts `registry?` and
   `codexHome?`. The pre-existing `tests/unit/liveSources.test.ts` and
   `tests/integration/liveSources.test.ts` construct it with `codexHome` only; that path
   builds a Codex-only registry internally, so those specs pass **unchanged**.

## Notes / phase-boundary confirmations

- No locked type or method renamed. `SourceId`, `SessionSource`, `ResolvedSession`,
  `SourceTailResult`, `SourceRegistry`, `parseSourceId` used verbatim.
- No new renderers, no normalized-model change, no canonical on-disk store.
- `npm run privacy:check` green — tailed CC content normalizes into the same redacted
  previews `maskPreviewSecrets` produces; raw CC content never leaves the server.
- The `@timeline` Codex e2e remains the live-tail e2e guard; it is environmentally blocked in
  this sandbox (browser rows do not render — reproduces on the untouched Codex specs and at
  the live-path-untouched Task 1 commit), so the authoritative CC live evidence is the
  `ccLiveTail.test.ts` integration test (real fs append → SSE `timeline` delta).
