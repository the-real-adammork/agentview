# Timeline fidelity pass — 2-column restructure (2026-05-28)

Branch: `feat/timeline-improvements`

## What changed

The timeline body was restructured from a **3-column** layout (left session-meta
panel · center stream · right vitals) to the **2-column** layout specified by the
authoritative `app.jsx` mock and `Engineering Handoff.html`:

- **Left sidebar (320px)** — full Agent Tree on top, then `Turn 01 · Vitals`
  (Σ tokens, context/primary/secondary meters, Tool Usage, Spawned Agents,
  Open Agent Graph). Stacks above the stream below 960px.
- **Right (1fr)** — filter tabs + window/tail controls, scrubber, event stream.

The dedicated session-meta panel was removed (the handoff keeps session identity in
the top app-bar: REPOS button + SessionSquare). The fields that were unique to that
panel — model · effort · sandbox · branch/sha — are now carried on the
`task_started` event row so no real data is lost.

## Screenshots

- `timeline-before-3col.png` — prior 3-column layout (from 2026-05-27 fidelity pass)
- `timeline-after.png` — restructured 2-column layout (1440×900)

## Verification

- `npm run typecheck` · `eslint` · `npm run tokens:check` — clean
- Unit suite: 40 files / 190 tests pass (incl. `app-shell`, `timelineEventRow`, `timelineFilters`)
- `tests/integration/timelineApi.test.ts` — 4 pass
- `tests/e2e/timeline-detail.spec.ts` — 2 pass

## Rollout parser fixes (real Codex data)

The 2-column layout exposed that the event **rows** were rendering raw JSON on
real sessions (fixtures had been too clean to catch it). Fixed in
`src/backend/rollout/parseRollout.ts` (parser version bumped 2 → 3 to invalidate
stale cache):

- `token_count` usage is read from `payload.info.total_token_usage` and
  `rate_limits.primary/secondary.used_percent` (was dumping raw JSON + wrong meters)
- `reasoning` shows summary text or `(reasoning summary withheld)` — never the
  encrypted blob
- `thread_goal_updated`, `patch_apply_*`, `web_search_*`, `context_compacted`,
  `session_meta`, `turn_aborted` are recognized (no more `▲ Unknown rollout event`)
- `custom_tool_call` (apply_patch) reads `input`; `*_output` events classify as
  results, not calls
- string `agent_message` payloads render their text
- shell tool calls render the extracted command (`$ curl ...`) via a new
  `commandPreview` field on `TimelineEvent`, not the raw args JSON

`timeline-after-realdata.png` shows the result against a live `~/.codex` session.
Covered by 6 new parser/row tests; full suite 196 pass.

## +SUBS scope — agent depth in the event list

Ported the handoff's `THIS / +SUBS` scope toggle and per-event origin rail:

- A scope toggle appears in the tabs row only when the active thread has descendants.
- In `+SUBS`, the App fetches each descendant thread's timeline
  (`realApiClient.getTimeline` per descendant) and passes them as `subEvents`;
  `TimelineView` merges them with the primary stream (sorted by created-at).
- Each row gets a left `ev-src-rail` — depth bars + the source agent's name,
  toned by tree depth (orange root · amber sub · cyan sub-sub), derived from the
  event's own `threadId` via the session index (no fabricated data).
- Token Δ chips are computed per source thread so merged snapshots don't subtract
  across agents.

`timeline-subs-realdata.png` shows it on a real 9-sub-agent session (5,701 merged
rows; root + amber sub rails). Covered by new `TimelineView` and `TimelineEventRow`
tests; full suite 200 pass.

## Known residual gap (not addressed here)

- `thread_goal_updated` fires very frequently, so the same goal objective now
  repeats as many `TURN CONTEXT` rows. Recognized and readable (not raw), but a
  future pass could de-duplicate or collapse consecutive identical goal updates.


The mock's `THIS / +SUBS` **scope toggle** and the per-event sub-agent origin rail
(`ev-src-rail`) are not implemented — that is a cross-thread event-merging feature,
not a styling tweak, so it's left for a separate decision rather than folded into
this layout pass.
