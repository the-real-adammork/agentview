# Skill Invocation Events + Skills Tab

**Status:** shipped · v0.3
**Files:** `mock.js` (timeline data), `app.jsx` (`TimelineView` tabs + filter, `EventRow`), `styles.css`

## Summary

Skill invocations are now a **first-class event type** in the timeline, distinct
from generic tool calls. A new **Skills** tab sits between **Tools** and
**Agent Ops** in the timeline's kind-filter row, and skill events render with
their own treatment in the All Events stream.

## Event type: `skill_invoke`

A skill invocation is a timeline event with `kind: "skill_invoke"`:

```js
{
  kind: "skill_invoke",
  name: "read_pdf",          // skill name
  call_id: "sk01",           // correlation id
  summary: "extract the entity model from ~/.codex/observatory-spec.pdf (12 pp)",
  status: "ok",              // "ok" | "fail"
  ts: Date,                  // event time (added by the timeline builder)
}
```

It is deliberately a **separate kind** from `tool_call` so that:
- the **Tools** tab counts only `tool_call` events (skills are no longer mixed in), and
- the **Skills** tab can isolate `skill_invoke` cleanly.

> In the real ingest, skills surface as a distinguished tool invocation (e.g.
> `invoke_skill`). Map those to `kind: "skill_invoke"` with `name` = the skill,
> `summary` = a one-line description/args digest, and `status` from the result.

## Skills tab

In `TimelineView`, the kind-filter tab list is, in order:

```
All Events · Messages · Tools · Skills · Agent Ops · Tokens · Warnings
```

Tab definition + filter predicate:
```js
["skill", "Skills", events.filter((e) => e.kind === "skill_invoke").length],
// …
if (filter === "skill") return e.kind === "skill_invoke";
```

The tab honors the same `events` pool as every other tab, so it respects the
**scope toggle** (`THIS` / `+SUBS`) and the **time window** — switching to
`+SUBS` pulls in sub-agent skill invocations and bumps the Skills count.

## Rendering (`EventRow`)

A dedicated branch renders skill events:
```jsx
if (e.kind === "skill_invoke") {
  return (
    <div className="ev skill">
      <div className="ts num">{fmtTimeMs(e.ts).slice(0, 12)}</div>
      <div className="body" style={{ borderColor: "var(--skill)" }}>
        <div className="head">
          <span className="who skill">✦ SKILL · {e.name}</span>
          {e.call_id && <span>call_id {e.call_id}</span>}
          {e.status && <span className={e.status === "ok" ? "chip good" : "chip warn"}>{e.status}</span>}
        </div>
        {e.summary && <div className="args">{e.summary}</div>}
      </div>
    </div>
  );
}
```

- Glyph: `✦`, label `SKILL · <name>`.
- Status chip: green `ok` / red `fail`.
- Appears inline in **All Events** as well as under the Skills tab.

## Color token: `--skill`

A new accent was added to the palette for skills (distinct from the
orange/amber/red/cyan/green already in use):

```css
--skill: #b388ff;   /* phosphor violet */
```

Used by:
- `.ev.skill::before` — the left timeline dot (`background` + glow).
- `.ev .head .who.skill` — the event label color.
- The **scrubber rail** dot color mapping for `skill_invoke`.

## Mock data

`mock.js` seeds skill events so the tab/stream are populated:
- Root session: `read_pdf` (~12s in) and `web_search` (~126s in).
- Sub-agent (ARCHIMEDES): a `web_search` skill event — so `+SUBS` shows a
  higher Skills count and the event carries its depth gutter (amber).

## Integration notes

- When wiring real data, emit `skill_invoke` from the ingest layer rather than
  reusing `tool_call`, to preserve the Tools/Skills separation.
- `status` drives the chip; if a skill is still running, omit `status` (no chip)
  or add a `"running"` value and extend the chip mapping.
- The scrubber, scope toggle, time window, and live-tail enter animation all
  already handle `skill_invoke` via the shared `events` pool — no extra wiring
  needed for those.
