# Phase 4 Acceptance: Claude Code Timeline Parse

Phase plan: `docs/plans/2026-05-31-session-source-adapter-phase-4-cc-timeline-parse.md`

Overview / locked contracts: `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md`

Phase: `2026-05-31-session-source-adapter-phase-4`

Branch: `feat/session-source-adapter`

## Outcome

Phase 4 makes ONE Claude Code (CC) session render end-to-end through the existing
timeline UI. A new CC transcript parser (`parseClaudeSessionLines`) mirrors the Codex
`parseRolloutLines` and emits the **identical** `CachedRolloutFacts` output type; a
`toolMap` adapts CC tool blocks into the `(command, output)` / `(toolName, args)` shapes
the existing `classifyExecOutput` / `classifyCall` classifiers already understand.
`ClaudeCodeSource.parse` reads the JSONL with the existing `readJsonlLines` and calls the
new parser, and `timeline.ts` dispatches `?sourceId=claude-code` so a CC session draws
through the EXISTING renderers with **zero renderer / contract / frontend change**.

`CLAUDE_PARSER_VERSION = 1` is defined and used as the CC cache-key discriminator
(distinct from `ROLLOUT_PARSER_VERSION`); `getRolloutFactsWithCache` gained an optional
`parserVersion` param (default `ROLLOUT_PARSER_VERSION`) so CC and Codex caches never
read each other's entries as fresh and the Codex path stays byte-identical.

### Files added

- `src/backend/sources/claudeCode/parseClaudeSession.ts` — `parseClaudeSessionLines(lines, options): CachedRolloutFacts`
  + `CLAUDE_PARSER_VERSION`. Owns §A line/block classification (user/assistant text,
  `thinking` → `reasoning` without the signature, `tool_use` → `tool_call`/`agent_launch`/
  `skill_invoke`, `tool_result`), §C `parentUuid` turn reconstruction, §D `message.usage` →
  `TokenSnapshot`, the `tool_use.id` ↔ `tool_use_id` call↔result join (reusing the
  `deriveFacts` shape + `classifyExecOutput`/`fillCallCounts`/`fillToolSearch`), and
  `.warnings`/`.summary` population. Every preview routes through `maskPreviewSecrets`.
- `src/backend/sources/claudeCode/toolMap.ts` — `mapClaudeTool(block)` (§B) + `normalizeResultText`
  (string | block-list → redacted, capped). Builds `DiffOutputRender` directly for
  `Edit`/`Write`/`MultiEdit` (CC blocks lack Codex's `*** Begin Patch` envelope that
  `classifyPatch` requires); delegates `Read`/`Grep`/`Glob`/`WebFetch`/`WebSearch`/`ToolSearch`
  to `classifyCall`; routes `Agent`/`Task` → `agent_launch`, `Skill` → `skill_invoke`,
  unknown → generic `tool_call` (still classify-at-join via `classifyExecOutput`).
- `tests/fixtures/claude-code/plain-session.jsonl` — one hand-redacted CC transcript (user
  text, assistant `thinking`+`text`+`usage`, a `Bash` call+result, a `Read` call+result, an
  `Edit`, an `Agent` launch; carries a planted `API_KEY=` and a `thinking.signature`).
- `tests/unit/parseClaudeSession.test.ts` — golden `CachedRolloutFacts` assertions (kind
  sequence, redaction, signature suppression, §D token mapping, exec/read/diff renders,
  agent_launch, §C shared turnId, empty warnings, stripped carry-fields).
- `tests/unit/claudeToolMap.test.ts` — per-§B-row mapping + `normalizeResultText` cases.
- `tests/integration/claudeTimeline.test.ts` — real API server: `GET /api/timeline?threadId=<uuid>&sourceId=claude-code`
  against a temp `CLAUDE_PROJECTS_DIR` returns a CC `TimelinePayload` (cold + warm cache,
  redaction, status/diff renders); a 404 for an unknown CC id.

### Files modified

- `src/backend/sources/claudeCode/ClaudeCodeSource.ts` — `parse(resolved)` now reads the
  transcript (`stat` + `readJsonlLines`) and calls `parseClaudeSessionLines`. Replaces the
  Phase-3 "not implemented" stub. `listChildren` (Phase 5) and `tail` (Phase 6) still throw.
- `src/backend/api/timeline.ts` — adds a `sourceId === "claude-code"` dispatch branch:
  resolve via the cross-source `SessionSource`, cache by `CLAUDE_PARSER_VERSION` through
  `getRolloutFactsWithCache`, return the same `TimelinePayload` shape. 404 on unknown id.
  The Codex branch is byte-for-byte unchanged. (`subtree`/`+SUBS` returns the single
  transcript this phase — Phase 5; live tail — Phase 6.)
- `src/backend/cache/rolloutCache.ts` — `getRolloutFactsWithCache` accepts an optional
  `parserVersion` (default `ROLLOUT_PARSER_VERSION`); freshness now matches that version.
  Zero behavior change for Codex.
- `tests/fixtures/claudeProjects.ts` — adds a reusable `claudeLine(...)` helper + per-session
  `rawLines` support so the timeline tests drive a real multi-tool transcript.
- `tests/integration/claudeDiscovery.test.ts` — the Phase-3 "`parse` throws" assertion is
  updated to assert Phase-4 reality: `parse` returns `CachedRolloutFacts`; `listChildren`/`tail`
  remain deferred stubs.
- `tests/e2e/observedSourceFixture.ts` — adds `writeClaudeTimelineFixture` /
  `removeClaudeTimelineFixture` + `e2eClaudeProjectsDir` so the `@timeline` CC arm can seed
  and clean up one CC transcript in the e2e `CLAUDE_PROJECTS_DIR`.
- `tests/e2e/timeline-detail.spec.ts` — adds a `@timeline` CC arm: seed a CC transcript,
  isolate it via the Sessions search box, select it, assert the rows draw through the
  unchanged renderers (and the planted secret/signature never reach the DOM), then remove
  the transcript so the `@sessions` exact-count spec stays green.
- `tests/privacy/privacyPreviews.test.ts` — adds a CC case (planted `OPENAI_API_KEY=`, a
  credentialed URL, a `<base_instructions>` block, a `thinking.signature`) asserting every
  emitted preview shows `[REDACTED]` and never the raw secret/signature.

## Acceptance commands

All run from `/Users/adam/Projects/agentview`.

### `npm run typecheck` — PASS

```
> tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json
(no errors)
```

### `npm run test -- --run` — PASS

```
 Test Files  67 passed (67)
      Tests  502 passed (502)
```

Focused CC suites:

```
 ✓ tests/unit/claudeToolMap.test.ts (17 tests)
 ✓ tests/unit/parseClaudeSession.test.ts (9 tests)
 ✓ tests/integration/claudeTimeline.test.ts (2 tests)
 Test Files  3 passed (3)
      Tests  28 passed (28)
```

### `npm run lint` — PASS

```
> eslint . --max-warnings=0
(zero warnings)
```

### `npm run privacy:check` — PASS

```
> npm run test -- --run tests/privacy/privacyPreviews.test.ts && node scripts/check-privacy.mjs
 ✓ tests/privacy/privacyPreviews.test.ts (4 tests)
privacy check passed
```

### `npm run e2e -- --grep @timeline` — NOT GREEN IN THIS SANDBOX (pre-existing, environmental)

All three `@timeline` specs fail in this sandbox — including the two **pre-existing**
Codex specs this phase never touched (`renders parsed rollout rows…` and `surfaces
enriched observed rollout facts…`). The first pre-existing spec fails with
`Error: Channel closed` and the timeline event rows never appearing in the browser
(`getByLabel('Timeline events').getByText('Timeline task started')` times out), i.e. the
headless browser / dev-server layer is unstable here, not the backend. The CC arm times
out at the same `waitForResponse` stage for the same reason.

Backend evidence that the timeline path is sound (real API server, real HTTP):

- `tests/integration/timelineApi.test.ts` (Codex) — 5 passed.
- `tests/integration/claudeTimeline.test.ts` (CC, `?sourceId=claude-code`) — 2 passed,
  asserting the CC `TimelinePayload`, the `Bash`→`status` and `Edit`→`diff` renders, cold→warm
  cache by `CLAUDE_PARSER_VERSION`, redaction, and a 404 for an unknown CC id.

The `@timeline` e2e arm is committed and ready; it should pass in a stable e2e environment.

## Service Wiring coverage

| Flow | Evidence | Status |
| --- | --- | --- |
| CC line → normalized events | `tests/unit/parseClaudeSession.test.ts` — golden kind sequence `[user_message, reasoning, assistant_message, token_snapshot, tool_call, tool_result, …, agent_launch]`, §C shared `turnId`, §D usage mapping, empty warnings | PASS |
| CC tool render parity | `tests/unit/claudeToolMap.test.ts` + `parseClaudeSession.test.ts` — `Bash`→`outputRender` (status/diff via `classifyExecOutput`), `Read`/`Grep`/`Glob`→`callRender`, `Edit`/`MultiEdit`/`Write`→`diff` (built directly), `Agent`/`Task`→`agent_launch`, `Skill`→`skill_invoke`, unknown→generic | PASS |
| CC timeline dispatch | `tests/integration/claudeTimeline.test.ts` — `?sourceId=claude-code` returns a `TimelinePayload`; Codex parity preserved (`tests/integration/sourceDispatch.test.ts`, `timelineApi.test.ts`) | PASS |
| CC end-to-end render | `@timeline` CC arm in `tests/e2e/timeline-detail.spec.ts` (committed; browser layer unstable in this sandbox — see above) | BLOCKED (env) |
| CC redaction | `tests/privacy/privacyPreviews.test.ts` CC case + `npm run privacy:check` | PASS |

## Notes / deviations

1. **`Edit`/`Write`/`MultiEdit` build `DiffOutputRender` directly** (not `classifyPatch`) — CC
   blocks carry `old_string`/`new_string`/`content`, never Codex's `*** Begin Patch` envelope
   that `classifyPatch` hard-requires. Same contract type; no renderer change. (Plan deviation 1.)
2. **`Agent` (real fleet) maps alongside `Task` (spec) → `agent_launch`.** (Plan deviation 2.)
3. **`Skill` → first-class `skill_invoke`** mirroring the Codex parser. (Plan deviation 3.)
4. **`getRolloutFactsWithCache` gained an optional `parserVersion`** (smallest change consistent
   with the locked plan's `parserVersion: CLAUDE_PARSER_VERSION` call). Default
   `ROLLOUT_PARSER_VERSION`; Codex unchanged.
5. **`@timeline` e2e is environmentally blocked in this sandbox** — the failure reproduces on the
   pre-existing, untouched Codex specs (browser "Channel closed" / timeline rows not rendering),
   so it is not a regression. The CC backend path is proven green by the real-server integration
   tests.

## Commits

| Hash | Subject |
| --- | --- |
| `b0ec77c` | feat(sources): add CC transcript parser (parseClaudeSessionLines) |
| `104ce3e` | feat(sources): map CC tool blocks to normalized render inputs |
| `2dae8be` | feat(api): render CC sessions via timeline dispatch (sourceId=claude-code) |
| (this) | docs: record session-source-adapter phase 4 acceptance |
