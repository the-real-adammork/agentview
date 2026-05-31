# Session Source Adapter Phase 6 — Claude Code Live Tail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This phase consumes the LOCKED contracts from `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md` — use those names/signatures verbatim; never rename. In particular: the live discriminator travels on the wire as **`sourceId`** (NOT `source`), and `SessionSource.tail(resolved, fromByte)` returns `SourceTailResult { events, nextByte, nextLine }`.

**Goal:** Make Claude Code (CC) sessions stream live exactly like Codex does today. Implement `ClaudeCodeSource.tail(resolved, fromByte): Promise<SourceTailResult>` as an incremental byte-offset read of the CC `.jsonl` transcript that mirrors `tailRolloutFile`, feeding only newly-appended complete lines through the Phase 4 CC line parser (`parseClaudeSessionLines`) to emit `TimelineEvent[]`, and returning `{ events, nextByte, nextLine }`. Then wire the live subscription path (`stream.ts` → `liveSources.ts` → watch manager) to dispatch by `sourceId` so a CC session id subscribes through `ClaudeCodeSource.tail` and the SSE `timeline` channel delivers appended CC events. **Codex live behavior stays byte-identical.**

**Phase Boundary:** This phase adds `ClaudeCodeSource.tail` (the last unimplemented method of the locked `SessionSource` interface for CC) and threads `sourceId` through the live subscription path so live dispatch is source-generic. It tails the **primary CC transcript only**; child-agent (`subagents/*.jsonl`) live tail is handled by the existing `+SUBS` live-merge if present, and is otherwise recorded as an explicit, scoped follow-up in Task 3 — **not silently skipped**. This phase does NOT add new renderers, does NOT change the normalized model, does NOT change Codex tail behavior, and does NOT introduce a canonical on-disk store. `ClaudeCodeSource` (discovery, metadata, `resolveSession`, `parse`, `listChildren`) and the registry/dispatch seam are assumed to exist from Phases 3–5; see the Phase-Dependency note below.

**Why this phase matters:** It closes the last live-parity gap. After Phases 3–5 a CC session lists, renders its timeline, and shows its agent graph, but the timeline is static — appended CC turns do not stream. This phase makes CC sessions feel live in the dashboard, completing the adapter so a user watching a running CC session sees new turns arrive over SSE, identical to the Codex experience.

**Verification:** `npm run typecheck`, `npm run test -- --run`, focused `npm run test -- --run tests/unit/claudeCodeTail.test.ts tests/integration/ccLiveTail.test.ts`, `npm run e2e -- --grep @timeline`, `npm run lint`, `npm run privacy:check`.

**Smoke-Testable Outcome:** With a temp `CLAUDE_PROJECTS_DIR` fixture (via `createClaudeProjectsFixture`) containing one CC session transcript, opening `GET /api/stream?threadId=<ccSessionId>&sourceId=claude-code` yields a `ready` frame with a baseline `nextByteOffset`, and appending a new complete CC turn line to the transcript pushes a `timeline` frame containing exactly the new `TimelineEvent[]` (and nothing already loaded), with a `nextByteOffset` advanced past the baseline. A Codex stream over the same endpoint without `sourceId` (default `"codex"`) behaves exactly as before.

**Phase Acceptance:** Vitest unit + integration drive the four tail cases and the subscribe→append→SSE delivery against a generated temp `CLAUDE_PROJECTS_DIR`, and `npm run e2e -- --grep @timeline` confirms no Codex live-tail regression. Records `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-6.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks (T1, T2), but the phase owner remains responsible for sequencing, the live-path integration, verification, the acceptance packet, and the child-agent follow-up decision (T3).

**Phase Owner Responsibilities:**
- Keep Codex live tail byte-identical: any diff in `liveSources.test.ts` / `streamApi.test.ts` / `@timeline` tail assertions is a hard failure, not an expected change. The `sourceId`-less path MUST resolve to Codex and behave as it does today.
- Confine all CC-vs-Codex branching to `src/backend/sources/` and the single dispatch point in `liveSources.ts` (which already dispatches by id in Phase 2 for the non-live handlers; this phase extends the *live* path to do the same). No `if (codex)` leaks elsewhere.
- Reuse the Phase 4 CC line parser (`parseClaudeSessionLines`) verbatim for appended lines — do not fork a second CC parser for the tail. The tail must produce the *same* `TimelineEvent` shapes the cold parse produces, so a tailed event is indistinguishable from a cold-loaded one.
- Reuse the `tailRolloutFile` partial-line / truncation mechanics (byte-offset read to `lastIndexOf("\n")`, hold incomplete trailing lines, restart at byte 0 on `fromByte > size`). Confirm the existing behavior and mirror it; do not invent new partial-line handling.
- Keep `npm run privacy:check` green every commit — tailed CC content normalizes into the same redacted previews; raw CC content never leaves the server.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| CC tail core | Task 1 | one sub-agent | Task 2 stubs after `tail` signature is confirmed (it is locked) | `src/backend/sources/claudeCode/ClaudeCodeSource.ts`, `src/backend/sources/claudeCode/claudeTail.ts` | `npm run test -- --run tests/unit/claudeCodeTail.test.ts` |
| Live dispatch | Task 2 | phase-owner only (Codex-parity integration risk) | none (depends on Task 1) | `src/backend/live/liveSources.ts`, `src/backend/live/liveRuntime.ts`, `src/backend/api/stream.ts` | `npm run test -- --run tests/integration/ccLiveTail.test.ts && npm run e2e -- --grep @timeline` |
| Child-agent decision + acceptance | Task 3 | phase-owner only | none | acceptance packet, follow-up note | full Phase 6 command set |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-31-session-source-adapter-phase-6-handoff.md`
- Required contents: current task status, branch/worktree, sub-agent results, verification evidence (typecheck + unit + integration + e2e + lint + privacy), service-wiring coverage, the recorded child-agent live-tail decision, acceptance packet status, blockers/escalations, and exact restart instructions.

## Phase-Dependency Note

This phase consumes:
- `src/backend/sources/SessionSource.ts` (Phase 1) — the locked `SessionSource` interface, `ResolvedSession`, `SourceTailResult`.
- `src/backend/sources/registry.ts` (Phase 2) — `createSourceRegistry`/`SourceRegistry`, and the `parseSourceId` dispatch helper (`src/backend/sources/sourceQuery.ts`).
- `src/backend/sources/claudeCode/ClaudeCodeSource.ts` (Phases 3–5) — `createClaudeCodeSource(...)` with `resolveSession` already returning a `ResolvedSession { source: "claude-code", sessionId, rawLogPath, extra: { subagentsDir } }`, plus `parse`/`listChildren`.
- `src/backend/sources/claudeCode/parseClaudeSession.ts` (Phase 4) — must export a **line-level** function `parseClaudeSessionLines(lines: string[], options): { events: TimelineEvent[]; warnings: string[] }` (the same primitive the Phase 4 cold parse uses internally over the full file). The tail reuses this for appended lines.

If any of these is not present at kickoff, STOP and confirm the prior phases are landed first. **Phase-4 parser-shape contract check (do this first, Task 1 Step 0):** run `grep -n "parseClaudeSessionLines" src/backend/sources/claudeCode/parseClaudeSession.ts`. If only a file-level parser exists (e.g. `parseClaudeSessionFile`) and there is no exported line-level function, the tail cannot reuse it. In that case the minimal in-scope fix is to extract the existing line-parsing body of the Phase 4 file parser into an exported `parseClaudeSessionLines(lines, options)` and have the file parser call it — a behavior-preserving refactor guarded by the Phase 4 parser tests (`npm run test -- --run tests/unit/parseClaudeSession.test.ts`). Do this extraction in Task 1 only if needed; record it in the acceptance packet. Do not fork a second CC parser.

## Live Dispatch — READ BEFORE TOUCHING `liveSources.ts`

Today the live path is **Codex-only and hard-wired**:
- `src/backend/live/liveRuntime.ts` builds `createLiveSources({ codexHome, hub, watchManager })`.
- `src/backend/live/liveSources.ts::subscribe` resolves the active thread's rollout via `StateStore.getThread(threadId)` + `resolveRolloutPath(codexHome, thread.rolloutPath)`, then `pushTimelineAndTokens` calls `tailRolloutFile({ path, threadId, fromByte, sourceLine })` directly.
- `src/backend/api/stream.ts` calls `runtime.sources.subscribe({ connection, threadId, filter, page, fromByte, logCursorId })` — there is **no `sourceId`** on the wire today.

This phase makes the live path source-generic by routing rollout resolution and tail through the registry (mirroring how Phases 1–2 routed the non-live handlers). **`sourceId` is the wire param** (default `"codex"`); the contract fields keep their locked names. Concretely:
1. `stream.ts` parses `sourceId` (via the Phase 2 `parseSourceId`), and passes `source` onto the subscribe request (an unknown value returns the same typed `400` the non-live handlers use — but note `/api/stream` falls through to 404 today on guard failures, so for an *unknown* source the stream simply does not open; record the exact chosen behavior in the packet).
2. `LiveSubscribeRequest` gains `source: SourceId` (default `"codex"` when omitted, for back-compat with any caller that doesn't send it).
3. `liveSources.ts` is constructed with the `SourceRegistry` (not bare `codexHome`); `subscribe` calls `registry.get(request.source)` and uses `source.resolveSession(threadId)` to get the `rawLogPath`, then `source.tail(resolved, fromByte)` in `pushTimelineAndTokens` instead of `tailRolloutFile` directly. The watch key stays `rollout:<threadId>` and the watched path is `resolved.rawLogPath` (the primary CC transcript for CC, the rollout for Codex) — both are plain JSONL files the existing `WatchManager` already handles.
4. The `sessions`/`diagnostics`/`tokens` snapshot pushes stay Codex-backed for now exactly as today (the merged sessions snapshot and Codex logs DB are out of this phase's scope; CC has no logs DB). Record this explicitly: **only the `timeline` live channel becomes source-generic in Phase 6**; `sessions`/`diagnostics` live snapshots remain Codex-sourced (a noted follow-up, not a regression — they were Codex-only before too).

> **Codex parity guard:** with `source: "codex"` (the default), the registry returns `CodexSource`, whose `.tail()` (Phase 1) wraps `tailRolloutFile`. So routing Codex through `source.tail` must produce the identical `events` / `nextByteOffset` / `truncated` the direct `tailRolloutFile` call produces today. `liveSources.test.ts` and `streamApi.test.ts` must stay green **without edits**.

---

## Source of Truth: Locked `tail` Contract (from the overview — implement verbatim)

```ts
// src/backend/sources/SessionSource.ts  (already exists from Phase 1)
export interface SourceTailResult {
  events: import("../../shared/contracts").TimelineEvent[];
  nextByte: number;
  nextLine: number;
}

export interface SessionSource {
  // ...
  tail(resolved: ResolvedSession, fromByte: number): Promise<SourceTailResult>;
}
```

`ClaudeCodeSource.tail` MUST return this exact shape. `nextByte` is the byte offset of the end of the last complete line consumed (resume point for the next tail). `nextLine` is the running source-line counter advanced past the consumed lines, so streamed CC events keep ascending `sourceLine` values and sort newest-last (the same invariant the Codex `liveTail` `linesRead`/`sourceLine` mechanism preserves — see `tests/integration/liveTail.test.ts` "continues sourceLine numbering across tails").

## Exact `tail` Behavior — the four cases (NO placeholders)

`ClaudeCodeSource.tail(resolved, fromByte)` reads the primary CC transcript at `resolved.rawLogPath`. Let `size = (await stat(path)).size` and `safeFromByte = Number.isSafeInteger(fromByte) && fromByte >= 0 ? fromByte : 0`. It mirrors `tailRolloutFile` mechanics, substituting the CC line parser. The caller (live path) tracks the running `sourceLine` and passes it as `fromLine` (see signature note below); the cold-start baseline derives it from the lines already in `parse(resolved).facts.events`.

**Signature detail:** the locked interface method is `tail(resolved, fromByte)`. To carry the running line counter (as Codex's `tailRolloutFile` does via its `sourceLine` arg), `ClaudeCodeSource` exposes an internal `tailFrom({ path, sessionId, fromByte, fromLine })` helper that the public `tail` delegates to with `fromLine` derived from `resolved.extra` / a parse when not supplied. The live path computes `fromLine` itself and calls the internal helper (mirroring how `liveSources.ts` computes `nextSourceLine` for Codex via `countLinesBefore`). The public `tail(resolved, fromByte)` defaults `fromLine` to `1 + countLinesBefore(path, fromByte)` so a bare call is self-consistent.

1. **Cold start — `fromByte === 0`:** read the entire file `[0, size)`. Find `lastNewline = chunk.lastIndexOf("\n")`. If `lastNewline < 0` (no complete line yet — a single partial line): return `{ events: [], nextByte: 0, nextLine: fromLine }`. Otherwise parse all complete lines `chunk.slice(0, lastNewline).split(/\r?\n/)` through `parseClaudeSessionLines(lines, { sessionId, startingLine: fromLine })`. Return `{ events, nextByte: byteLengthOf(chunk.slice(0, lastNewline + 1)), nextLine: fromLine + lines.length }`. (A complete cold transcript therefore yields all its events on the first tail; a half-written final line is excluded and waits for its newline.)

2. **Incremental — `fromByte === N` (0 < N ≤ size):** read only `[N, size)`. Behave exactly as cold start but offset by `N`: parse complete appended lines, return `nextByte = N + byteLengthOf(consumed-bytes-through-last-newline)` and `nextLine = fromLine + lines.length`. **Emits only the newly-appended events**, never re-emits lines before `N`. This is the load-bearing case for live streaming.

3. **No new bytes — `fromByte === size` (or the read window contains no newline):** `length = max(0, size - N) === 0` → return `{ events: [], nextByte: size, nextLine: fromLine }` immediately (no file open needed). Offsets are unchanged from the input baseline; the live path sends no `timeline` frame (it only sends when `events.length > 0` or on reset). Idempotent: calling `tail` repeatedly with `fromByte === nextByte` keeps yielding empty.

4. **Partial trailing line — appended bytes end without a newline:** read `[N, size)`; the last bytes form an incomplete JSON line. `chunk.lastIndexOf("\n")` points before the partial fragment, so only complete lines up to that newline are parsed and emitted; `nextByte` stops at that last newline (the partial fragment's bytes are **not** consumed). A half-written JSON line is therefore **never** emitted — it is re-read in full on the next tail once its terminating newline lands, exactly as `tailRolloutFile` does (verified by `tests/integration/liveTail.test.ts` "holds incomplete trailing lines until a newline is present" and "tails only complete observed envelope rows and preserves byte offsets across partial appends"). If the window has bytes but no newline at all (`lastNewline < 0`), return `{ events: [], nextByte: N, nextLine: fromLine }` — offset does not advance.

**Truncation guard (shared with Codex):** if `safeFromByte > size`, the file shrank/rotated. Restart at byte 0: read `[0, size)`, emit all complete lines, and attach a `warnings` entry (`"Claude Code transcript was truncated; tail restarted from byte 0."`). The live path surfaces this as `reset: true` on the `timeline` frame so the client re-baselines (mirroring Codex `truncated` → `reset`). `nextLine` restarts at `1 + lines.length`. (CC append-only transcripts rarely truncate, but rotation/clear must not corrupt the client — handle it identically to Codex.)

`tail` MUST NOT throw on a malformed JSON line: `parseClaudeSessionLines` already tolerates unparseable lines by recording a warning and skipping (Phase 4 contract). The tail surfaces those warnings via the live `timeline` frame's `warnings` array, unchanged.

---

## File Map

- Modify: `src/backend/sources/claudeCode/ClaudeCodeSource.ts` — implement `tail(resolved, fromByte): Promise<SourceTailResult>` plus the internal `tailFrom({ path, sessionId, fromByte, fromLine })` helper. Reuse `parseClaudeSessionLines` from `parseClaudeSession.ts`.
- Create: `src/backend/sources/claudeCode/claudeTail.ts` — the byte-offset incremental read mechanism for CC transcripts (a CC analog of `src/backend/tail/liveTail.ts::tailRolloutFile`), exporting `tailClaudeTranscript({ path, sessionId, fromByte, fromLine })` returning `{ events, nextByte, nextLine, truncated, warnings }`. `ClaudeCodeSource.tail` maps this to the locked `SourceTailResult` (dropping `truncated`/`warnings` into the live-frame mapping at the call site, exactly as `CodexSource.tail` does). Keeping the mechanics in a standalone module mirrors the Codex split (`tail/liveTail.ts` separate from `CodexSource`) and keeps `ClaudeCodeSource` a thin adapter.
- Modify: `src/backend/live/liveSources.ts` — construct from a `SourceRegistry` (in addition to / replacing the bare `codexHome` wiring); add `source: SourceId` to `LiveSubscribeRequest` (default `"codex"`); resolve the active session via `registry.get(request.source).resolveSession(threadId)` and tail via `source.tail(resolved, nextByteOffset)` in `pushTimelineAndTokens`. Keep the Codex `tokens`/`sessions`/`diagnostics` pushes unchanged.
- Modify: `src/backend/live/liveRuntime.ts` — build the registry (`createSourceRegistry([createCodexSource(...), createClaudeCodeSource(...)])`) and pass it to `createLiveSources`. Reuse the same registry composition Phase 2 added for the HTTP handlers (extract a shared `getSourceRegistry()` accessor if Phase 2 created one; otherwise compose identically so live and HTTP agree on registered sources).
- Modify: `src/backend/api/stream.ts` — parse `sourceId` (default `"codex"`) via `parseSourceId(url)` and pass `source` onto the subscribe request. Preserve the existing kill-switch / method-guard 404 fall-through.
- Create/Reuse: `tests/fixtures/claudeProjects.ts` — `createClaudeProjectsFixture` builder (from Phase 3). Extend (if needed) with an `appendTurn(sessionId, line)` helper so tests can grow a transcript mid-stream.
- Test: `tests/unit/claudeCodeTail.test.ts` — the four `tail` cases + truncation + partial-line + `nextByte`/`nextLine` correctness against a temp CC transcript.
- Test: `tests/integration/ccLiveTail.test.ts` — `liveSources.subscribe` for a CC session: `ready` baseline → append a turn → `timeline` frame carries exactly the new events with advanced `nextByteOffset`; plus a Codex-parity case proving the `sourceId`-less / `source: "codex"` path is unchanged.
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-6.md` — acceptance evidence packet.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| CC live timeline tail | Timeline view, live SSE | `stream.ts` → `liveSources.subscribe(source:"claude-code")` → `ClaudeCodeSource.tail` | CC `.jsonl` transcript (read-only, byte-offset) | fs watch on `rollout:<id>` → primary transcript path | Temp `CLAUDE_PROJECTS_DIR` | `tests/integration/ccLiveTail.test.ts`: append turn → `timeline` frame with exactly the new events, advanced `nextByteOffset`. |
| CC tail offset/partial-line correctness | (server-internal) | `ClaudeCodeSource.tail` / `tailClaudeTranscript` | CC `.jsonl` | None | Temp transcript file | `tests/unit/claudeCodeTail.test.ts`: cold/incremental/no-new/partial-line/truncation cases assert exact `events`, `nextByte`, `nextLine`. |
| Codex live parity | Timeline view, live SSE | `stream.ts` (no `sourceId`) → `liveSources.subscribe(source:"codex")` → `CodexSource.tail` | rollout JSONL | fs watch on `rollout:<id>` | Temp `$CODEX_HOME` | `liveSources.test.ts` + `streamApi.test.ts` + `@timeline` tail e2e pass **unchanged**. |
| Source-generic live dispatch | SSE subscribe | `stream.ts` `parseSourceId` → `registry.get(source)` | n/a | n/a | n/a | Integration: `?sourceId=claude-code` resolves CC tail; default resolves Codex; unknown source does not open a live timeline (records exact 400/404 behavior). |
| Child-agent live tail (decision) | Timeline `+SUBS` live | (see Task 3 decision) | `subagents/*.jsonl` | n/a | Temp `CLAUDE_PROJECTS_DIR` with a subagent | Task 3 records whether `+SUBS` live-merge already covers it or it is a scoped follow-up; not silently skipped. |

## E2E Harness Readiness

Reuse the existing Playwright config and the `@timeline` spec (`tests/e2e/timeline-detail.spec.ts`), whose first test already asserts **"tail updates"** for Codex — that is the live-tail e2e guard. There is no separate `@live`/`@stream` tag (verified: only `@timeline`, `@sessions`, `@graph` exist). For Codex parity, `npm run e2e -- --grep @timeline` must pass unchanged. A CC live-tail e2e is **not** added in this phase (it would require a temp `CLAUDE_PROJECTS_DIR` Playwright web-server fixture, which Phase 3 stood up for the CC list; if that fixture already drives a CC timeline e2e, extend it with a mid-test append assertion — otherwise the integration test `ccLiveTail.test.ts` is the authoritative CC live evidence and the e2e remains Codex-parity only). Record which path was taken in the packet.

---

### Task 1: `ClaudeCodeSource.tail` — incremental byte-offset read + CC parser reuse + offset/partial-line unit tests

**Depends On:** Phases 3–5 (`ClaudeCodeSource` with `resolveSession`/`parse`; `parseClaudeSessionLines` from Phase 4).

**Execution:** sub-agent lane: CC tail core; parallel with Task 2 stubbing after the (locked) `tail` signature is confirmed; checkpoint `npm run test -- --run tests/unit/claudeCodeTail.test.ts`.

**Files:**
- Create: `src/backend/sources/claudeCode/claudeTail.ts`
- Modify: `src/backend/sources/claudeCode/ClaudeCodeSource.ts`
- Reuse/Extend: `tests/fixtures/claudeProjects.ts`
- Test: `tests/unit/claudeCodeTail.test.ts`

**Service Wiring Rows Covered:**
- CC tail offset/partial-line correctness

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run tests/unit/claudeCodeTail.test.ts`
- Expected result: all four cases plus truncation produce exact `events`, `nextByte`, `nextLine`; a half-written trailing line is never emitted; appended events deep-equal the events the Phase 4 cold parse produces for the same lines.
- Evidence to collect: focused test output; a note confirming `tail` reuses `parseClaudeSessionLines` (no second parser).

**Test Mode Disclosure:**
- Automated tests: real local temp CC `.jsonl` transcript written/appended on disk.
- Production/dev path exercised: yes — `ClaudeCodeSource.tail` is the same module the live path calls in Task 2.
- Mock-only risk: real CC transcript line shapes may drift from the redacted fixture; mitigated by reusing the Phase 4 parser and the Phase 4 sample transcripts under `tests/fixtures/claude-code/`.
- Required real dependencies: temp filesystem.
- Blocking if unavailable: yes for the CC live phase.

- [ ] Step 0: Confirm the Phase 4 parser exposes a line-level function: `grep -n "parseClaudeSessionLines" src/backend/sources/claudeCode/parseClaudeSession.ts`. If absent, extract the existing line-parsing body into an exported `parseClaudeSessionLines(lines, options)` (behavior-preserving; have the file parser call it) and confirm `npm run test -- --run tests/unit/parseClaudeSession.test.ts` stays green. Record the extraction in the packet if performed.
- [ ] Step 1: Write `tests/unit/claudeCodeTail.test.ts` (mirror `tests/integration/liveTail.test.ts` structure) against a temp CC transcript built from `tests/fixtures/claude-code/` sample lines:
  - **Cold start (`fromByte: 0`):** write two complete CC turn lines (e.g. a `user` line and an `assistant` line with a `text` block); assert `tail(resolved, 0)` returns both events (kinds matching the Phase 4 golden), `nextLine === 1 + 2`, and `nextByte === byteLengthOfFile`.
  - **Incremental (`fromByte: N`):** baseline `N = size`, append one assistant turn line; assert `tail(resolved, N)` returns exactly that one event, `nextByte > N`, `nextLine === fromLine + 1`, and that no earlier event is re-emitted.
  - **No new bytes (`fromByte: size`):** assert `tail` returns `{ events: [], nextByte: size, nextLine: fromLine }` (offsets unchanged) and is idempotent across repeated calls.
  - **Partial trailing line:** append a complete line followed by a half-written JSON fragment (no trailing newline); assert `tail` emits only the complete line, `nextByte` stops at that line's terminating newline (the fragment's bytes are not consumed). Then append `"\n"` (completing the fragment) and assert the next `tail` from the prior `nextByte` emits exactly the previously-partial event with the next `sourceLine`.
  - **Truncation (`fromByte` > size):** assert `tail` restarts at byte 0, emits all lines, `truncated`/warning is surfaced, and `nextLine` restarts at `1 + lines.length`.
  - **Parser-equivalence:** assert the events a tail produces for a set of lines deep-equal the events the Phase 4 cold parse (`parse(resolved).facts.events`) produces for the same lines (proving a tailed event is indistinguishable from a cold-loaded one).
  Confirm the suite fails (module missing).
- [ ] Step 2: Run `npm run test -- --run tests/unit/claudeCodeTail.test.ts` and confirm failures are the missing `claudeTail` module / unimplemented `tail`.
- [ ] Step 3: Implement `src/backend/sources/claudeCode/claudeTail.ts`:
  - `export const tailClaudeTranscript = async ({ path, sessionId, fromByte, fromLine = 1 }): Promise<{ events: TimelineEvent[]; nextByte: number; nextLine: number; truncated: boolean; warnings: string[] }>`.
  - Copy the `tailRolloutFile` mechanics verbatim in structure: `stat(path)` → `safeFromByte` clamp → `truncated = safeFromByte > size` → `offset = truncated ? 0 : safeFromByte` → `length = max(0, size - offset)`. If `length === 0` return `{ events: [], nextByte: size, nextLine: fromLine, truncated, warnings: truncated ? [<msg>] : [] }`. Open the file, read `[offset, offset+length)`, `lastNewline = chunk.lastIndexOf("\n")`; if `< 0` return empty with `nextByte: offset`. Otherwise parse `chunk.slice(0, lastNewline).split(/\r?\n/)` via `parseClaudeSessionLines(lines, { sessionId, startingLine: fromLine })`, compute `nextByte = offset + Buffer.byteLength(chunk.slice(0, lastNewline + 1), "utf8")`, `nextLine = fromLine + lines.length`, and return `{ events, nextByte, nextLine, truncated, warnings: [...(truncated ? [<msg>] : []), ...parser.warnings] }`.
  - Use the CC truncation message `"Claude Code transcript was truncated; tail restarted from byte 0."`.
- [ ] Step 4: Implement `ClaudeCodeSource.tail(resolved, fromByte)`: derive `fromLine` (default `1 + countLinesBefore(resolved.rawLogPath, fromByte)`), call `tailClaudeTranscript({ path: resolved.rawLogPath, sessionId: resolved.sessionId, fromByte, fromLine })`, and return the locked `SourceTailResult { events, nextByte, nextLine }` (drop `truncated`/`warnings` from the public shape — the live caller reads them via the internal helper; the public `tail` exposes only the locked three fields). Add a tiny exported `countLinesBefore` (or reuse a shared util) so cold and live paths agree on the line baseline.
- [ ] Step 5: Run `npm run typecheck && npm run test -- --run tests/unit/claudeCodeTail.test.ts` and confirm green.
- [ ] Step 6: Commit this task. Suggested message:

  ```
  feat(sources): implement ClaudeCodeSource.tail incremental CC transcript tail

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

### Task 2: Wire the live subscription path to dispatch by `sourceId` (CC streams; Codex unchanged)

**Depends On:** Task 1

**Execution:** phase-owner only (Codex-parity integration risk); parallel with none; checkpoint `npm run test -- --run tests/integration/ccLiveTail.test.ts && npm run e2e -- --grep @timeline`.

**Files:**
- Modify: `src/backend/live/liveSources.ts`, `src/backend/live/liveRuntime.ts`, `src/backend/api/stream.ts`
- Test (must stay green unchanged): `tests/integration/liveSources.test.ts`, `tests/integration/streamApi.test.ts`, `tests/e2e/timeline-detail.spec.ts`
- Test (new): `tests/integration/ccLiveTail.test.ts`

**Service Wiring Rows Covered:**
- CC live timeline tail
- Codex live parity
- Source-generic live dispatch

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/ccLiveTail.test.ts tests/integration/liveSources.test.ts tests/integration/streamApi.test.ts && npm run e2e -- --grep @timeline`
- Expected result: a CC subscription delivers appended CC events over the `timeline` channel with advanced `nextByteOffset`; the Codex live specs pass without edits; the `@timeline` tail e2e is unchanged.
- Evidence to collect: integration output, Codex-parity confirmation (no spec edits), e2e summary.

**Test Mode Disclosure:**
- Automated tests: real local temp `CLAUDE_PROJECTS_DIR` (CC) + temp `$CODEX_HOME` (Codex parity) fixtures, real fs append + watch signals (fake watch double for unit-level liveSources, real fs.watch via `streamApi`-style harness for the SSE path).
- Production/dev path exercised: yes — `stream.ts` → `liveSources.subscribe` → registry → `ClaudeCodeSource.tail` / `CodexSource.tail`.
- Mock-only risk: the watch signal in the unit-level `liveSources` test is fired manually (fake watch), matching the existing `liveSources.test.ts` pattern; the SSE-level test uses real fs.watch.
- Required real dependencies: temp filesystem, local HTTP runtime for the SSE path.
- Blocking if unavailable: yes.

- [ ] Step 1: Write `tests/integration/ccLiveTail.test.ts` (mirror `tests/integration/liveSources.test.ts` with the fake-watch double):
  - Build a temp `CLAUDE_PROJECTS_DIR` with one CC session transcript via `createClaudeProjectsFixture`.
  - Construct `createLiveSources({ registry, hub, watchManager })` where `registry` includes a real `ClaudeCodeSource` (and a `CodexSource` for the parity sub-case).
  - `subscribe({ connection, threadId: <ccId>, source: "claude-code", filter, page, fromByte: null, logCursorId: null })`; assert a `ready` frame with `nextByteOffset > 0` (the baseline at current EOF).
  - `appendFile` a new complete assistant turn line to the CC transcript; `fire("rollout:<ccId>")`; `vi.waitFor` a `timeline` frame; assert `events` has length 1, the preview matches the appended turn, `nextByteOffset` advanced past baseline, and `reset === false`.
  - **Codex parity sub-case:** repeat with a temp `$CODEX_HOME` + `source: "codex"` (and a separate case with `source` omitted, asserting it defaults to `"codex"`), asserting the existing Codex delta behavior is identical.
  - **Partial-line safety:** append a half-written line, fire, assert **no** `timeline` frame is sent (events empty → no push); then append the completing `"\n"`, fire, assert the now-complete event is delivered.
  Confirm failures (subscribe doesn't accept `source` / doesn't dispatch).
- [ ] Step 2: Run `npm run test -- --run tests/integration/ccLiveTail.test.ts` and confirm failures.
- [ ] Step 3: Modify `src/backend/live/liveSources.ts`:
  - Add `source: SourceId` to `LiveSubscribeRequest` (optional with default `"codex"` for back-compat).
  - Change `LiveSourcesOptions` to accept a `registry: SourceRegistry` (keep `codexHome` only where the Codex `sessions`/`diagnostics`/`tokens` snapshots still need it — those stay Codex-backed this phase). In `subscribe`, resolve the active session via `const source = registry.get(request.source); const resolved = await source.resolveSession(threadId);` and use `resolved.rawLogPath` as the watched path and `source.tail(resolved, nextByteOffset)` inside `pushTimelineAndTokens` (replacing the direct `tailRolloutFile`). Map the source's `SourceTailResult` (`events`/`nextByte`/`nextLine`) — and the internal helper's `truncated`/`warnings` — onto the existing `timeline` frame (`events`, `nextByteOffset: nextByte`, `reset: truncated`, `warnings`). Keep the `nextSourceLine` continuation logic: baseline via the source's line-count helper (Codex `countLinesBefore`; CC `countLinesBefore` from Task 1), advance by the tail's consumed lines.
  - **Codex tokens push:** keep the existing `getRolloutFactsWithCache` + `deriveTokenSeries` tokens push for Codex unchanged. For CC, gate the tokens push to a no-op (or derive from `source.parse` if cheap) — record the choice; CC has no Codex tokens DB and the cold facts already carry token snapshots. The minimal in-scope behavior: only the `timeline` channel is source-generic this phase; the `tokens` push stays Codex-only and is skipped for CC (noted follow-up).
- [ ] Step 4: Modify `src/backend/live/liveRuntime.ts` to build the registry (`createSourceRegistry([createCodexSource({ codexHome }), createClaudeCodeSource({ claudeProjectsDir })])`, reusing the Phase 2/Phase 3 composition) and pass it to `createLiveSources`. Resolve `claudeProjectsDir` via the Phase 3 `claudePaths` resolver. Update `resetLiveRuntime` to `await registry.close()` as needed.
- [ ] Step 5: Modify `src/backend/api/stream.ts` to `parseSourceId(url)` (default `"codex"`) and pass `source` onto `runtime.sources.subscribe({ ..., source })`. Preserve the existing `liveEnabled()`/method 404 fall-through. Decide and record the unknown-`sourceId` behavior for the stream (either return `false`→404 like the other guards, or write the typed 400 the HTTP handlers use — pick the one consistent with how the client's `EventSource` degrades; document it).
- [ ] Step 6: Run `npm run test -- --run tests/integration/ccLiveTail.test.ts tests/integration/liveSources.test.ts tests/integration/streamApi.test.ts && npm run typecheck && npm run lint` and confirm green with **no edits** to the Codex live specs.
- [ ] Step 7: Run `npm run e2e -- --grep @timeline && npm run privacy:check` and confirm green (Codex tail e2e unchanged; raw CC content never leaves the server).
- [ ] Step 8: Commit this task. Suggested message:

  ```
  feat(live): dispatch live timeline tail by sourceId so CC sessions stream

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

### Task 3: Child-agent live-tail decision + Phase 6 acceptance packet

**Depends On:** Task 1, Task 2

**Execution:** phase-owner only; parallel with none; checkpoint full Phase 6 command set.

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-6.md`
- Modify: any Phase 6 file needed for integration fixes (no contract changes)

**Service Wiring Rows Covered:**
- Child-agent live tail (decision)
- All other rows (final verification)

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run lint && npm run test -- --run && npm run e2e -- --grep @timeline && npm run privacy:check`
- Expected result: the full suite passes; the packet records the child-agent live-tail decision and the CC live evidence.
- Evidence to collect: full command output, e2e summary, the recorded child-agent decision, the parser-extraction note (if Task 1 Step 0 extracted `parseClaudeSessionLines`), and the unknown-`sourceId` stream behavior.

**Test Mode Disclosure:**
- Automated tests: real local temp `CLAUDE_PROJECTS_DIR` + `$CODEX_HOME` fixtures + Playwright.
- Production/dev path exercised: yes — browser/SSE → `stream.ts` → registry → source tail.
- Mock-only risk: child-agent live tail may be deferred (decision recorded), not tested live this phase.
- Required real dependencies: temp filesystem, Playwright runtime.
- Blocking if unavailable: yes, except optional private real-data validation.

- [ ] Step 1: **Make the child-agent live-tail decision and record it (do not silently skip).** A CC session can append to BOTH the primary transcript and `subagents/*.jsonl`. This phase tails the primary transcript only. Determine whether child-agent live updates are already covered:
  - Inspect how `+SUBS` works for CC after Phase 5: the timeline `subtree` merge folds each child's events into the unified stream on each *fetch*. Check whether the **live** path re-fetches/re-tails children. Today the Codex live path watches only the active thread's rollout (`rollout:<threadId>`), not descendants — so descendant rollouts do **not** live-stream for Codex either; `+SUBS` live freshness comes from the periodic re-fetch on the next subscribe/poll, not a per-child watch.
  - **Decision to record:** CC child-agent (`subagents/*.jsonl`) live tail is **NOT covered by a per-child watch in this phase**, mirroring the existing Codex behavior (the live path watches only the primary transcript; `+SUBS` reflects child growth on the next timeline fetch). This is an explicit, scoped **follow-up**, not a silent skip: a future phase can watch `extra.subagentsDir/*.jsonl` and tail each child via the same `tailClaudeTranscript` mechanism, merging into the `timeline` frame under the `+SUBS` scope. Write this decision (with the Codex-parity rationale) into the packet and, if a `docs/handoffs/...` exists, into the handoff. Verify the claim by confirming the live path watches only `rollout:<threadId>` (grep `liveSources.ts` for `watchManager.watch(\`rollout:`); if Phase 5 added descendant watches, update the decision to match reality instead.
- [ ] Step 2: Create the acceptance packet with one Service-Wiring row per matrix flow, each citing the command + test that proves it, plus a Commits table (Tasks 1–3) and a "Decisions" section recording: the child-agent live-tail follow-up, the CC `tokens`-push skip, the unknown-`sourceId` stream behavior, and the parser-extraction note (if any).
- [ ] Step 3: Run the full command set; fix any integration failures within Phase 6 scope only (no contract/behavior changes to Codex).
- [ ] Step 4: Re-run the full command set and attach evidence (command output, e2e artifacts, the CC subscribe→append→delta capture from `ccLiveTail.test.ts`).
- [ ] Step 5: Commit this task. Suggested message:

  ```
  docs: record session-source-adapter phase 6 acceptance

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: `claudeTail.ts`, the `ClaudeCodeSource.tail` impl, and the live-path changes compile across both tsconfigs.
- Run: `npm run lint`
  Expected: eslint passes with zero warnings.
- Run: `npm run test -- --run`
  Expected: unit + integration pass, including new `claudeCodeTail` and `ccLiveTail` specs and every unchanged Codex live spec (`liveSources`, `streamApi`, `liveTail`).
- Run: `npm run e2e -- --grep @timeline`
  Expected: Codex live-tail ("tail updates") flow passes unchanged.
- Run: `npm run privacy:check`
  Expected: redaction guard stays green — tailed CC content normalizes into the same redacted previews; raw CC content never leaves the server.

**Required Service Wiring Coverage:**
- CC live timeline tail — `ccLiveTail` integration covers subscribe→append→`timeline` delta with exact new events + advanced offset.
- CC tail offset/partial-line correctness — `claudeCodeTail` unit covers cold/incremental/no-new/partial-line/truncation with exact `nextByte`/`nextLine`.
- Codex live parity — `liveSources` + `streamApi` + `@timeline` e2e pass with no spec edits.
- Source-generic live dispatch — `ccLiveTail` covers `source: "claude-code"` dispatch and the `source`-omitted default-to-Codex path.
- Child-agent live tail (decision) — packet records the explicit follow-up decision (primary-only this phase, mirroring Codex), not a silent skip.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-6.md`

**Completion Rule:** The phase cannot be marked complete until every acceptance command passes with **no Codex live spec modified to accommodate the change**, the four `tail` cases (cold / incremental / no-new / partial-line) plus truncation are covered with exact-offset assertions, a CC session demonstrably streams an appended turn over SSE, the `tail` reuses the Phase 4 `parseClaudeSessionLines` (no forked parser), the child-agent live-tail follow-up decision is recorded, and the acceptance packet exists with current commit evidence.
