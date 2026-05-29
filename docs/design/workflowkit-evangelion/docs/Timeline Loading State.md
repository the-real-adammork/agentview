# Timeline Loading State

**Status:** shipped · v0.3
**Files:** `app.jsx` (`TimelineView`), `styles.css`

## Summary

When a session's Timeline opens — or the user switches to a different session —
the event stream shows a **loading state** that stands in for fetching and
parsing that session's rollout JSONL. It clears once the data is "ready,"
revealing the real event stream and scrubber.

Two coordinated pieces:
1. **Stream skeleton** — shimmer placeholder rows in the event list.
2. **Scrubber loading** — a `LOADING ROLLOUT…` header with no dots and an
   indeterminate scan sweep.

## State

A single boolean in `TimelineView`, re-fired on every session change:

```js
const [loading, setLoading] = useState(true);
useEffect(() => {
  setLoading(true);
  const t = setTimeout(() => setLoading(false), 620); // simulated fetch+parse
  return () => clearTimeout(t);
}, [session.id]);
```

- Keyed on `session.id`, so navigating between threads (thread navigator, graph
  node, session row) re-triggers it.
- The cleanup `clearTimeout` prevents a stale timer from clearing the new
  session's load if the user switches again mid-load.

> **Real integration:** replace the `setTimeout` with the actual rollout
> fetch/parse promise — `setLoading(true)` before the request, `setLoading(false)`
> in its `.finally()`. Everything downstream already keys off `loading`.

## 1. Stream skeleton

While `loading`, the `.tl-stream` renders `.tl-skel` instead of the event list:

```jsx
{loading ? (
  <div className="tl-skel" aria-busy="true" aria-label="Loading rollout">
    {Array.from({ length: 7 }).map((_, i) => (
      <div key={i} className="tl-skel-row" style={{ animationDelay: `${i * 70}ms` }}>
        <span className="sk-ts shimmer"></span>
        <span className="sk-body">
          <span className="sk-head">
            <span className="sk-tag shimmer" style={{ width: 90 + (i % 3) * 34 }}></span>
            <span className="sk-meta shimmer" style={{ width: 54 }}></span>
          </span>
          <span className="sk-line shimmer" style={{ width: `${68 - (i % 4) * 12}%` }}></span>
          {i % 3 === 0 && <span className="sk-line shimmer" style={{ width: `${44 - (i % 2) * 10}%` }}></span>}
        </span>
      </div>
    ))}
  </div>
) : ( /* …real event rows… */ )}
```

Design notes:
- **7 rows**, each mirroring the real event-row grid (`80px` timestamp gutter +
  body with a left rule), so the swap to real content causes no layout shift.
- **Staggered entrance** — each row fades in with a `70ms * index`
  `animation-delay` (`skelFade`), giving a top-down cascade.
- **Varied widths** — tag/line widths are derived from the row index (`i % 3`,
  `i % 4`) so the skeleton looks like real, irregular content rather than a
  uniform block.
- `aria-busy="true"` + `aria-label` on the container for assistive tech.

### Shimmer

The `.shimmer` utility is a reusable sliding-gradient placeholder:

```css
.shimmer {
  display: inline-block;
  background: linear-gradient(90deg, var(--bg-2) 0%, var(--rule) 28%, var(--bg-2) 56%);
  background-size: 220% 100%;
  animation: shimmer 1.25s ease-in-out infinite;
}
@keyframes shimmer {
  0%   { background-position: 120% 0; }
  100% { background-position: -120% 0; }
}
```

Reusable anywhere a placeholder is needed (not Timeline-specific).

## 2. Scrubber loading

The scrubber reflects the same `loading` flag:

```jsx
<div className="tl-scrubber" data-loading={loading ? "true" : undefined}>
  <div className="hdr">
    <span><Reticle /> TURN 01 · {loading ? "LOADING ROLLOUT…" : (windowMs ? `LAST ${…}H` : "TASK_STARTED → TASK_COMPLETE")} · DUR {loading ? "—" : Math.round((tEnd - t0)/1000) + "s"}</span>
    <span>TTFT {session.ttft_ms}ms</span>
  </div>
  <div className="track">
    {!loading && scrubDots.map(…)}      {/* dots withheld while loading */}
    {/* axis ticks always render */}
  </div>
  {loading && <div className="tl-scan" aria-hidden="true"></div>}
</div>
```

- Header swaps to `LOADING ROLLOUT…` and duration to `—`.
- Event dots are **withheld** (`!loading && …`) so stale/abruptly-appearing dots
  never flash; axis ticks stay.
- An indeterminate **scan sweep** runs along the bottom of the scrubber:

```css
.tl-scan {
  position: absolute; left: 0; bottom: 0;
  height: 2px; width: 28%;
  background: linear-gradient(90deg, transparent, var(--primary), transparent);
  box-shadow: 0 0 8px var(--primary);
  animation: tlScan 1.1s ease-in-out infinite;
}
@keyframes tlScan { 0% { left: -28%; } 100% { left: 100%; } }
```

## Reduced motion

Under `prefers-reduced-motion: reduce`:
- `.shimmer` animation is disabled (static placeholder).
- `.tl-skel-row` entrance collapses to ~1ms.
- `.tl-scan` stops sweeping and becomes a static, dimmed full-width bar.

```css
@media (prefers-reduced-motion: reduce) {
  .shimmer { animation: none; }
  .tl-skel-row { animation-duration: 1ms; }
  .tl-scan { animation: none; left: 0; width: 100%; opacity: 0.4; }
}
```

## Timing reference

| Token | Value |
|---|---|
| Simulated load duration | 620ms (replace with real fetch) |
| Skeleton row stagger | 70ms × row index |
| Skeleton row fade-in (`skelFade`) | 240ms ease-out |
| Shimmer cycle | 1.25s ease-in-out, infinite |
| Scrubber scan (`tlScan`) | 1.1s ease-in-out, infinite |

## Notes

- The loading flag only affects the **center stream + scrubber**. The left
  sidebar (Thread Navigator + Vitals) stays interactive so the user can still
  switch threads while a load is in flight.
- Live-tail (`TAIL`/`LIVE`) is reset on session change alongside the load, so no
  synthetic events arrive during the skeleton phase.
