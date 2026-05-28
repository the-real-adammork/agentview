# Timeline scrubber rail (`.timeline-scrubber__track`)

Reference for how the timeline scrubber renders. Source:
`src/frontend/components/TimelineScrubber.tsx`, geometry in
`src/frontend/components/scrubberGeometry.ts`, styles in
`src/frontend/styles/app.css`.

## Structure

```
.tl-scrubber-wrap            grid-template-rows: auto 1fr; min-height: 64px
├─ .hdr                      auto row — "TURN 01 · …" + "TTFT … · next byte …"
└─ .timeline-scrubber        1fr row (margin-top: 6px; min-height: 28px)
   └─ .timeline-scrubber__track
      ├─ .timeline-scrubber__dot   one per event, absolute, left: X%
      └─ .timeline-scrubber__axis  ticks at 0/25/50/75/100%
```

## The track

```css
.timeline-scrubber__track {
  position: relative;                                        /* containing block for absolute children */
  height: 100%;                                              /* fills the 1fr scrubber row */
  min-height: 28px;                                          /* floor */
  border-left:  var(--border-width) solid var(--rule-soft);  /* left/right rails = session start/end */
  border-right: var(--border-width) solid var(--rule-soft);
}
```

- `position: relative` establishes the coordinate system: dots and ticks are
  `position: absolute; left: X%`, so the track's left/right edges map to session
  start/end.
- `height: 100%` makes the rail fill its `1fr` row (resolves against the
  stretched grid item) instead of leaving slack below a fixed-height rail;
  `min-height: 28px` is the floor.

## Dots (`scrubberDots`, `scrubberGeometry.ts`)

One `<span>` per event, positioned by **timestamp** (not index):

```
leftPct = ((time - t0) / span) * 100        // span = Math.max(1, tEnd - t0)
```

- `span = Math.max(1, tEnd - t0)` guards the single-event / identical-timestamp
  case (no ÷0 / NaN); non-finite timestamps fall back to `0%`.
- Because placement is by time, bursts of activity in a short window cluster and
  overlap by design — the scrubber shows temporal density, not even spacing.

Per-kind encoding:

| Kind                                   | Width | Height  | Color           |
|----------------------------------------|-------|---------|-----------------|
| `token_snapshot`                       | 2px   | `100%`  | `--primary`     |
| `warning` / `parse_error`              | 4px   | `22px`  | `--warn`        |
| `user_message`                         | 4px   | `14px`  | `--cyan`        |
| `tool_call` / `tool_result`            | 4px   | `14px`  | `--amber`       |
| `agent_message` / `agent_launch` / `agent_wait` | 4px | `14px` | `--good`   |
| `task_complete`                        | 4px   | `14px`  | `--ink-strong`  |
| everything else                        | 4px   | `14px`  | `--primary`     |

`token_snapshot` ticks use `height: 100%` so they span the full rail like axis
gridlines, regardless of the rail's resolved height. Dots are centered with
`top: 50%; transform: translate(-50%, -50%)` and glow via
`box-shadow: 0 0 6px currentColor`.

## Active / inactive state

Each dot carries `data-active`, set in `TimelineScrubber.tsx` from the current
filter (`filterTimelineEvents`). When `activeKind === "all"` every dot is active;
otherwise only dots whose event id is in the filtered set are active. Inactive
dots get `opacity: 0.28` and lose the glow (`app.css`).

## Axis ticks

`AXIS_TICKS = [0, 25, 50, 75, 100]` — drawn as `position: absolute; bottom: 0;
width: 1px; height: 6px; background: var(--rule-strong)` (bottom-anchored, not
centered like dots).
