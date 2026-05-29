# Design brief — Timeline event rendering

**For:** the designer
**Context:** AgentView Observatory — a read-only local dashboard for inspecting Codex
agent sessions. The **Timeline** view is the per-session event stream (center column),
with the Agent Tree + Turn Vitals in the left sidebar. Visual language is industrial
instrumentation: dense, monospace, hazard-tape framing, one high-saturation accent,
depth tones (orange root · amber sub · cyan sub-sub).

This brief asks for designs for **how each event row renders**, with a deep dive on
**`exec_command` output** (render the output by *type* — diff, tests, status, table —
instead of one gray blob).

---

## 1. What a timeline row is today

Each row = one event in a session's rollout. Current generic treatment:

```
HH:MM:SS  ▸ WHO-LABEL   call_id …   [exit N · 1.2s]      meta
          $ <command or arguments>
          <pre> preview text </pre>
          ┌ STDOUT · 4,096 bytes ───────────────────────
          │ <collapsed output preview, expandable>
          └──────────────────────────────────────────────
```

- Left **timestamp** gutter; a colored left border + dot by kind.
- A **who-label** (e.g. `▸ TASK_STARTED`, `USER`, `▸ EXEC_COMMAND`, `TOKEN_COUNT`).
- Optional chips: `call_id`, `exit N · duration`, `Δ +N since last`, `failed`, `↗ open child`.
- For tool calls: a `$ command` line + a collapsible **output** block (byte size shown).
- In **+SUBS** scope, a left **origin rail** (depth bars + agent name, depth-toned).

The weakness this brief targets: **every output is the same gray pre block**, and
high-value outputs (diffs, test results, status, query results) aren't legible at a glance.

---

## 2. Data available per event (what designs can rely on)

Each event carries (fields may be absent):

| Field | Meaning |
|---|---|
| `kind` | one of the 15 types in §3 |
| `severity` | `info` \| `warning` \| `error` |
| `timestamp` | ISO time (rendered HH:MM:SS) |
| `previewText` | short human text for the row |
| `toolName` | e.g. `exec_command`, `apply_patch`, `web_search` |
| `commandPreview` | extracted shell command (cmd, `bash -lc` unwrapped) |
| `argumentsPreview` | redacted JSON args (when not a shell cmd) |
| `outputPreview` / `outputBytes` | redacted output text + total size |
| `exitCode` / `durationMs` | command result + wall time |
| `agentNickname` / `agentRole` / `childThreadId` | for spawn/wait + origin rail |
| `tokenSnapshot` | token totals/meters (token rows) |
| `isCollapsedByDefault` / `hasRawAvailable` | large output → collapsed; raw expandable |

**New (proposed) field for this work:** `outputRender` — server-parsed structured
output, one of `{ kind: "diff" | "tests" | "status" | "table" | "plain", … }` (see §4).
Designs should assume this clean structured data is available; the UI just renders it.

### Architecture boundary — structured JSON (server) ⇄ reusable components (frontend)

- **Server emits data only.** The rollout parser classifies each `exec_command` output and
  produces a typed `outputRender` **JSON object** (no markup, no HTML) — e.g.
  `{ kind:"diff", files:[{ path, additions, deletions, hunks:[…] }] }`,
  `{ kind:"tests", passed, failed, skipped, durationMs, failures:[name] }`,
  `{ kind:"status", files:[{ path, code }] }`,
  `{ kind:"table", columns:[…], rows:[[…]] }`. Parsed once, cached, shape-validated.
- **Frontend owns the UI.** Each `kind` maps to a small **reusable presentational
  component** (`<DiffView>`, `<TestSummary>`, `<FileStatusList>`, `<OutputTable>`, plain
  fallback) that takes the structured JSON as props. These live in the component library and
  are not tied to the timeline — they can be reused elsewhere (e.g. the modal, future views).
- **One component, two surfaces.** The **same** component renders the inline **preview** and
  the **modal** — driven by a prop (e.g. `variant="preview" | "full"` or a `limit`) — so
  preview and expanded views never drift. The modal is a generic reusable shell that hosts
  whichever renderer the event needs.

Implication for design: deliver each renderer as a **self-contained component spec**
(props in = the JSON above; preview + full variants), plus the shared modal shell — not
one-off timeline layouts.

---

## 3. Event-type catalog (render each distinctly)

15 kinds. For each: what it is, key data, and the design goal.

1. **task_started** — turn begins. Data: model, effort, sandbox, branch (on the row meta).
   Goal: a quiet header marker; show run config compactly.
2. **task_complete** — turn ends. Data: duration, TTFT, last message. Goal: closing
   marker (good/green); summarize outcome.
3. **turn_context** — metadata (cwd/model, goal updates). Goal: low-emphasis context chip;
   today repeats often (thread_goal_updated) — consider collapsing consecutive identical ones.
4. **user_message** — the human prompt. Goal: distinct (cyan), readable prose, possibly
   markdown.
5. **assistant_message** — model reply. Goal: prose/markdown, readable.
6. **agent_message / AGENT REPORT** — a sub-agent's report back. Goal: distinct (green),
   often long — collapsible.
7. **reasoning** — model thinking; usually **encrypted/withheld** (shows
   "(reasoning summary withheld)"). Goal: de-emphasized, clearly "hidden".
8. **tool_call** — the big one. `toolName` + `commandPreview`/`argumentsPreview` + inlined
   output (exit/duration). **Deep dive in §4.**
9. **tool_result** — standalone result (usually inlined onto its call; rarely shown alone).
10. **token_snapshot** — per-turn token usage. Data: `tokenSnapshot` (total, cached, input,
    output, context %, rate limits). Already has a composition bar; **hidden by default**
    behind a "Tokens" toggle. Goal: keep the rich meter when shown.
11. **agent_launch / ⊕ SPAWN_AGENT** — spawns a sub-agent. Data: nickname, role, task,
    childThreadId (+ "↗ open child"). Goal: prominent, depth-toned, navigable.
12. **agent_wait / ◌ WAIT_AGENT** — awaits a child; status open/closed/failed. Goal: status
    chip; link to child.
13. **warning** — recognized warning. Goal: warn tone, scannable.
14. **parse_error** — malformed rollout line. Goal: warn/error tone.
15. *(reasoning/turn_context noise)* — high-frequency low-value rows; design should help
    them recede (grouping/dimming) so the signal events stand out.

---

## 4. Deep dive — `exec_command` output renderers

`exec_command` is by far the most common tool call (≈71k calls across logs; top types:
`sed`, `rg`, `git status`, `git diff`, `nl`, `find`, `pytest`, `ls`, `git add`, `sqlite3`,
`node`, `docker compose`, `npm`, `curl`, `cat`, …). The command is available as
`commandPreview`; the output is parsed server-side into one of these structured forms.
Design a treatment for each. Each must degrade gracefully to **plain** when parsing misses.

### 4a. `git diff` / `git show` → **diff view**
Structured data: per-file hunks with added/removed/context lines.
Design goals: green additions / red deletions, +/- gutter, per-file headers with
add/del counts. Inline shows a **preview** (first hunk / N lines); when the formatted
diff is long it gets an **expand** affordance that opens the **full diff in a modal** (§4f).

### 4b. tests (`pytest`, `npm test`, `cargo test`, `go test`, `vitest`) → **pass/fail summary**
Structured data: counts (passed / failed / skipped), duration, list of failing test names.
Design goals: a headline status (e.g. `✓ 42 passed · ✗ 3 failed · 1.2s`), failing names
listed, full log collapsible. Failure state should read loud; all-pass should read quiet.

### 4c. `git status --short` → **file list**
Structured data: files with status codes (M / A / D / R / ??).
Design goals: tidy list, status marker glyph/tone per file (modified/added/deleted/
untracked), counts in the header.

### 4d. `sqlite3 -column` / columnar output → **table**
Structured data: header row + rows/cells.
Design goals: a real table (aligned columns, header emphasis), horizontal scroll for wide
results, row count in the header, truncate very large results.

### 4e. plain (everything else) → today's `<pre>` preview (keep), same preview→modal model.

### 4f. Preview → expand → modal (applies to ALL custom renderers)
Each custom-formatted output (diff, tests, status, table, and plain) renders **inline as a
capped preview** — enough to read the gist (e.g. first hunk, first ~10 rows, the test
headline). When the full formatted output exceeds the preview cap, the row shows a clear
**expand affordance** (e.g. "Expand · N more lines / rows"). Clicking it opens the event in
a **modal** that shows the **full formatted output, scrollable** — the same renderer
(diff/table/test/list), not raw text — with the event's header context (command, exit,
duration, agent/origin). The modal is dismissible (Esc / click-out / close), scroll-locked
to its own content, and large but bounded (the full parsed output, still capped to a sane
max with a "raw" escape hatch if needed). Inline rows therefore stay short and scannable;
depth/scrolling lives in the modal, not the stream.

---

## 5. Cross-cutting constraints (designs must respect)

- **Deterministic + performant.** Output is parsed **server-side, once, cached**; the UI
  renders structured data only. No client guesswork, no async, no per-scroll re-parsing.
- **Preview, then modal.** Every custom-formatted output renders inline as a **capped
  preview**; long output gets an **expand** affordance that opens the **full formatted
  output in a scrollable modal** (see §4f) — not an inline expansion. Inline rows stay
  short and scannable; scrolling depth lives in the modal.
- **Bounded size.** The stream renders the most recent **~1000 rows**. Inline previews are
  capped (first N lines/rows). The modal shows the full parsed output, itself bounded to a
  sane max with a "raw" escape hatch for anything beyond.
- **Redaction.** Secrets are masked upstream (e.g. `OPENAI_API_KEY=[REDACTED]`). Designs
  must never imply raw secrets are shown; keep the `[REDACTED]` treatment legible.
- **Aesthetic + tokens.** Reuse the existing palette/tokens (single accent + depth tones
  amber/cyan, hazard framing, monospace, `var(--good)`/`var(--warn)` for status). No new
  color systems.
- **Depth rail.** In +SUBS scope every row already carries a left origin rail (depth +
  agent name); new renderers must fit alongside it.
- **Status chips.** Exit code + duration already render as a chip; failed/​slow should be
  visually prominent, success quiet.
- **Accessibility & responsive.** Keyboard-navigable rows, sufficient contrast, graceful
  narrowing (the timeline collapses the sidebar below ~960px).

---

## 6. Deliverables requested from design

1. The **15 event-type rows** (§3) — refined treatments, emphasizing which recede vs stand out.
2. The **four exec output renderers** (§4) — diff, tests, status, table — each in its
   **inline preview** state and its **expanded modal** state (§4f), plus the plain fallback.
3. The **expand modal** itself (§4f): header context (command, exit, duration, origin),
   the full scrollable formatted output, dismiss controls, and the "raw" escape hatch.
4. **States** per renderer: success, failure (non-zero exit), empty, truncated/large
   (preview vs modal).
5. Consistency with the WorkflowKit "Evangelion" handoff aesthetic already in
   `docs/design/workflowkit-evangelion/`.

## 7. Open questions for design
- Should repetitive read commands (`sed`/`cat`/`nl`/`rg`) get a **compact one-line** form
  (no output block unless expanded) to cut noise, given their volume?
- Should consecutive identical `turn_context`/`reasoning` rows **group/collapse**?
- Diff: inline (single column) vs split (side-by-side)? (Single recommended for the dense
  stream + narrow column.)
