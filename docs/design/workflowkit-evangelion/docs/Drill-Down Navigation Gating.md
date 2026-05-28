# Drill-Down Navigation Gating

**Status:** shipped · v0.3
**Files:** `app.jsx` (App, header, `SessionsView`, `ReposView`, `SessionSquare`), `styles.css`

## Summary

Navigation enforces a strict **Repo → Session → views** drill-down so the user
always has an unambiguous context. The app boots on the **Repos** screen; the
session-dependent views stay locked until the user has chosen a repo and then a
session. Choosing a new repo wipes the previously selected session and re-locks
the views.

This keeps the mental model intact: you can never be looking at a Timeline /
Graph / Tokens / Diagnostics view without first having explicitly answered
"which repo?" and "which session?".

## State model

Three pieces of `App` state drive the gate:

| State | Type | Meaning |
|---|---|---|
| `view` | string | current view; **defaults to `"repos"`** (was `"sessions"`) |
| `repoFilter` | string \| null | the chosen repo's `cwd`; `null` until a repo is picked |
| `sessionChosen` | boolean | `false` until the user explicitly picks a session row |

`selected` (the session id) still exists and defaults to `SESSIONS[0]`, but it is
**not** treated as "chosen" until `sessionChosen` is true — the default is only a
fallback for rendering.

### Centralized transitions

All selection routing goes through two helpers in `App` so the gate can't be
bypassed:

```js
const pickRepo = (cwd) => {
  setRepoFilter(cwd);
  setSessionChosen(false);   // wipe any prior session
  setView("sessions");
};

const pickSession = (id) => {
  setSelected(id);
  setSessionChosen(true);    // unlock the session-dependent views
  setView("timeline");
};
```

- `ReposView` calls `onPickRepo(cwd)` from a repo card footer, and
  `onPickSession(id)` when a session row/chip inside a card is clicked.
- `SessionsView` calls `onPickSession(s.id)` on a table-row click.
- In-view selection (thread navigator, graph nodes, token-budget rows) keeps
  using plain `setSelected` — those only fire **after** `sessionChosen` is
  already true, so they don't need to re-gate.

## Gate states (what's enabled when)

| Stage | REPOS button | Session square | Timeline · Graph · Tokens · Diag |
|---|---|---|---|
| **No repo** (fresh load, Repos screen) | enabled | **disabled** — `— select a repo —` | **disabled** |
| **Repo chosen, no session** (Sessions list) | enabled (shows repo name) | enabled — prompts `▸ select a session` | **disabled** |
| **Repo + session chosen** | enabled | shows session identity (depth bars + name) | **enabled** |
| **New repo picked** | enabled | resets to `▸ select a session` | **disabled** again |

## Implementation hooks

### Header — nav buttons
```jsx
<button
  disabled={!sessionChosen}
  data-rail={sessionChosen && i <= activeIdx ? "on" : undefined}
  onClick={() => { if (sessionChosen) setView(v.key); }}
  title={!sessionChosen ? "Select a session first" : v.label}
>
```
- `disabled` natively blocks clicks; CSS dims to `opacity: 0.3` +
  `cursor: not-allowed`.
- The selection **rail** (`data-rail`) only paints once `sessionChosen` is true,
  so the continuous underline never appears while locked.

### Header — session square
`SessionSquare` takes two new props, `chosen` and `disabled`:
```jsx
<SessionSquare
  chosen={sessionChosen}
  disabled={!repoFilter}
  onClick={() => { if (repoFilter) setView("sessions"); }}
  active={view === "sessions"}
  railStart={view !== "repos" && (sessionChosen || view === "sessions")}
/>
```
When `disabled` or `!chosen` it renders a placeholder branch
(`data-empty="true"` / `data-disabled="true"`) instead of the full identity:
- **disabled** (no repo): dimmed, `— select a repo —`, not clickable.
- **empty** (repo but no session): clickable, orange `▸ select a session`.

### Header — REPOS button
`headerRepo` is now strictly `repoFilter` (previously fell back to the selected
session's root cwd, which leaked a repo name before selection). The button shows
the plain `REPOS` label until a repo is chosen.

### Sessions list
Row `active` highlight is gated so nothing looks pre-selected:
```js
const active = sessionChosen && s.id === selected;
```

## Edge cases / notes

- **Back-to-repos then same repo:** `pickRepo` always resets `sessionChosen`,
  even if the same repo is re-picked — intentional, the user re-confirms a
  session.
- **Deep links (future):** when restoring from a URL like
  `?repo=…&session=…`, set `repoFilter`, `selected`, and `sessionChosen=true`
  together so the gate opens in one shot.
- **Programmatic jumps within a session context** (e.g. thread navigator
  switching to a sub-agent) deliberately do **not** touch `sessionChosen` — you
  stay unlocked while hopping threads inside the same investigation.
- The gate is purely client-side UX; it does not change what data is fetched.
