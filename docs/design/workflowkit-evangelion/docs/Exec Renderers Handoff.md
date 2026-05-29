# Handoff — `exec_command` Output Renderers

**Status:** shipped (design + reference impl) · v0.3
**Audience:** ① server engineer (define `outputRender` payloads) · ② frontend engineer (wire components)
**Reference impl:** `exec-renderers.jsx` (shared by `Observatory.html` + `Exec Renderers.html`)
**Live component library:** `Exec Renderers.html` — every renderer × every state

---

## 0. The contract in one line

> The server parses each `exec_command` result **once**, server-side, into a small
> structured `outputRender` JSON object. The frontend picks a renderer component by
> `outputRender.kind` and draws it — **no client-side parsing, no async, no per-scroll work.**

Pipeline: `command runs → server parses stdout → outputRender JSON → renderer component → inline preview → (expand) modal`

If the server can't classify an output, it omits `outputRender` (or sends `{kind:"plain"}`)
and the UI falls back to the existing `<pre>` block. **Graceful degradation is mandatory** —
every renderer must survive missing/short fields.

---

## 1. Where `outputRender` lives

It attaches to the **tool_output** event that the UI joins to its `tool_call` by `call_id`:

```jsonc
{
  "kind": "tool_output",
  "call_id": "c13",
  "exit": 0,
  "fail": false,
  "output": "diff --git a/… (raw text, still sent for the RAW escape hatch)",
  "outputRender": { "kind": "diff", "...": "..." }   // ← NEW, optional
}
```

- `output` (raw text) is **still required** — it powers the modal's **RAW** toggle and the
  plain fallback. `outputRender` is additive.
- `exit` / `fail` drive the exit-code chip (quiet green on success, loud warn on failure).
- The owning `tool_call` carries `command_preview` (the unwrapped shell command, e.g.
  `bash -lc "git diff"` → `git diff`) — used as the modal header.

---

## 2. `outputRender` payload schemas (server engineer)

8 kinds. Field names are the contract; the reference impl reads exactly these.

### 2.1 `diff` — `git diff` / `git show`
```jsonc
{
  "kind": "diff",
  "files": [{
    "path": "dashboard/timeline.tsx",
    "added": 38, "removed": 9,
    "hunks": [{
      "header": "@@ -14,9 +14,16 @@ function TimelineView() {",
      "lines": [
        { "t": "ctx", "text": "  const [filter, setFilter] = useState(\"all\");" },
        { "t": "del", "text": "  const events = TIMELINES[id];" },
        { "t": "add", "text": "  const [scope, setScope] = useState(\"this\");" }
      ]
    }]
  }]
}
```
- `t` ∈ `"add" | "del" | "ctx"`. Single-column (unified) diff — no split/side-by-side.
- Pre-split into hunks/lines; the UI does not parse `@@` headers.

### 2.2 `tests` — `pytest` / `cargo test` / `vitest` / `go test`
```jsonc
{ "kind": "tests", "passed": 42, "failed": 3, "skipped": 1,
  "durationMs": 6200, "failing": ["tests/test_parser.py::test_lazy_resume", "..."] }
```
- `failing` = fully-qualified names. Empty array when all pass (UI reads quiet).

### 2.3 `status` — `git status --short`
```jsonc
{ "kind": "status", "files": [
  { "code": "M",  "path": "dashboard/app.tsx" },
  { "code": "R",  "path": "old.tsx → new.tsx" },
  { "code": "??", "path": "scratch/notes.md" }
] }
```
- `code` ∈ `M | A | D | R | ??` (extend as needed; unknown → faint glyph). `files: []` = clean tree.

### 2.4 `table` — `sqlite3 -column` / columnar output
```jsonc
{ "kind": "table", "columns": ["target","warnings"],
  "rows": [["codex_otel.log_only","254011"], ["log","22014"]],
  "totalRows": 12 }
```
- `rows` may be a truncated slice of `totalRows` (server caps to a sane max). Cells are strings.

### 2.5 `file` — `nl` / `cat` / `sed -n` / `head`
```jsonc
{ "kind": "file", "path": "src/db.rs", "startLine": 40, "totalLines": 218,
  "lines": [ { "n": 40, "text": "pub fn open_readonly(...) {" }, { "n": 41, "text": "..." } ] }
```
- `n` = the real source line number (so `sed -n '40,46p'` shows 40–46). `startLine`/`totalLines`
  optional (header range). Cap the `lines` array to a sane max server-side.

### 2.6 `matches` — `rg` / `grep`
```jsonc
{ "kind": "matches", "files": [{
  "path": "dashboard/EventRow.tsx",
  "matches": [
    { "n": 88, "text": "  if (e.outputRender?.kind === \"diff\") …", "col": [9, 21] }
  ]
}] }
```
- Grouped by file. `n` = line number. `col` = `[start, end]` char offsets to emphasize within
  `text`; omit `col` to show the line with no highlight.

### 2.7 `http` — `curl` / `wget`
```jsonc
{ "kind": "http", "method": "GET", "url": "http://localhost:4317/v1/health",
  "status": 200, "statusText": "OK", "durationMs": 38, "size": "142 B",
  "contentType": "application/json", "json": true,
  "headers": [ { "k": "content-type", "v": "application/json" } ],
  "body": "{ \"status\": \"healthy\" }" }
```
- Status colored by class (2xx/3xx/4xx/5xx). `json: true` tints the body. `headers` is ordered;
  the UI caps to 3 inline, rest in modal. `body` is a string (pretty-print server-side).

### 2.8 `plain` — fallback
Omit `outputRender` entirely, or send `{ "kind": "plain" }`. UI renders `output` as `<pre>`.

---

## 3. Inline caps & overflow (shared rule)

Each renderer shows a **capped preview**; when the structured data exceeds the cap, the row
shows an **Expand** bar (and the whole row is clickable) that opens the **modal** with the full
output. Caps in the reference impl:

| kind | inline cap | overflow label |
|---|---|---|
| diff | 6 lines (across hunks) | `+N more lines` |
| file | 8 lines | `+N more lines` |
| matches | 6 matches (across files) | `+N more matches` |
| tests | 2 failing names | `+N more failures` |
| status | 5 files | `+N more files` |
| table | 6 rows | `+N more rows` |
| http | 3 headers / 8 body lines | `headers + body` |
| plain | 8 lines | `+N more lines` |

These live in `execOverflow(out)` — single source of truth for "does this overflow?".

---

## 4. Frontend component contract (frontend engineer)

All components live in `exec-renderers.jsx` and take the same shape:

```jsx
<RendererView r={outputRender} full={boolean} />   // full=false → preview, full=true → modal
```

- **Dispatch:** `ExecOutput({ out, onExpand })` reads `out.outputRender.kind`, renders the right
  `*View` + the kind label + exit/fail chip, and shows the Expand bar when `execOverflow(out)`
  returns a label. `onExpand()` opens the modal.
- **Modal:** `ExecModal({ ev, out, onClose })` — centered, scrim, header = kind tag + `$ command`
  (`ev.command_preview`) + exit/duration chip + **RAW** toggle + ✕. Renders the same `*View` with
  `full`. Dismiss: Esc / scrim-click / ✕. RAW swaps to `PlainOut` (the raw `output` string).
- **Row wiring (in `EventRow`):** when a `tool_call`'s joined output has `outputRender` (or
  overflowing plain), the row is `expandable` — whole `.body` is `role="button"`, click/Enter
  opens the modal; `spawn_agent` rows are exempt (they keep `↗ open child`).

**To add a new kind:** add a `*View`, a branch in `ExecOutput` + `ExecModal` body dispatch, a
case in `execOverflow`, a label entry, and a `.xr-kind[data-kind="…"]` color. That's the whole
surface area.

---

## 5. Cross-cutting constraints (both engineers)

- **Parse once, cache.** All classification is server-side and cached on the event. The UI never
  re-parses on scroll/expand.
- **Bounded.** Stream renders ~1000 most-recent rows. Inline previews are capped (§3). The modal
  shows the full *parsed* output, itself bounded to a sane max with the **RAW** escape hatch for
  anything beyond.
- **Redaction.** Secrets are masked **upstream** (`OPENAI_API_KEY=[REDACTED]`). Renderers display
  whatever they're given — never imply raw secrets are shown. Keep `[REDACTED]` legible.
- **Tokens/aesthetic.** Reuse existing palette: single orange accent, depth tones (amber/cyan),
  `var(--good)`/`var(--warn)` for status. Kind accents already assigned: diff=cyan, tests=good,
  status=amber, table=primary, file=ink-strong, matches=good, http=cyan.
- **Depth rail.** In `+SUBS` scope each row carries a left origin rail (depth bars + agent name);
  renderers must fit alongside it (they render inside `.body`, rail is a sibling).
- **A11y / responsive.** Rows keyboard-navigable; modal is `role="dialog"` + Esc; timeline
  collapses sidebar below ~960px; modal is `min(680px, 92vw)` and clips its own overflow
  (`min-width:0` on the body — wide tables scroll inside, never bleed the modal).

---

## 6. Coverage vs. brief

Built (7 structured + plain): **diff · file · matches · http · tests · status · table · plain**.
Top commands from the brief these cover: `git diff/show`, `sed`/`nl`/`cat`/`head`, `rg`/`grep`,
`curl`/`wget`, `pytest`/`cargo test`, `git status`, `sqlite3`.

Not yet built (candidates, same pattern): **directory** (`ls`/`find` → tree/list), **build logs**
(`npm`/`node`/`docker compose` → step status), **edit-applied** (`apply_patch`/`git add` → write-side stat).

---

## 7. Open questions (from brief §7, for product/design)
- Compact one-line form for very high-volume reads (`sed`/`cat`/`nl`) to cut stream noise?
- Collapse consecutive identical `turn_context` / `reasoning` rows?
- Diff stays single-column (recommended for the dense, narrow stream).
