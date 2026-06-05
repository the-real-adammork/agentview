# Changelog — Observatory Output Renderers

All notable changes to the Observatory's output-renderer surface (exec_command
renderers, light request/call renderers, and the subagent-notification renderer).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); newest first.

Each renderer family ships a reference impl (shared by `Observatory.html`) **and** a
live component library that shows every renderer × every state.

---

## [Unreleased]

### Added — `subagent_notification` renderer · v0.1 · 2026-06-05

A dedicated renderer for the `<subagent_notification>` block the host injects into a
parent's context when a child agent reports status.

- **Reference impl:** `subagent-renderer.jsx`
- **Component library:** `Subagent Notification.html`
- **Styles:** `sn-` block appended to `styles.css`

**What it does**

- Parses the `status` body (markdown findings report) **once** into sections —
  bold section headers, bulleted findings, a Contradictions/Open-Questions section,
  and a Source List.
- Renders a **summary band**: agent identity (`agent_path` / nickname / role), a
  status badge whose tone is driven by the status key (`completed` → green,
  `in_progress` → amber, `failed` → red, `blocked`/`waiting` → cyan), counts
  (findings · sources · open questions), and a confidence-distribution bar.
- **Finding cards** — each with a colour-coded confidence pill (parsed from the
  `**Confidence: …**` marker), prose with bold emphasis preserved, and deduped
  **citation chips** extracted from inline `([domain](url))` references.
- **Capped inline preview** (first 2 findings) → **Expand** bar → **modal** with every
  section, full citations, and a **RAW** escape hatch (original notification JSON).

**Notification shape**

```jsonc
{
  "agent_path": "019e9825-04ae-74e3-b315-388c93a24fad",
  "agent_nickname": "ARCHIMEDES",   // optional
  "agent_role": "researcher",       // optional
  "tokens": 84120,                  // optional (modal chip)
  "status": { "completed": "**Findings**\n\n- …**Confidence: High.** ([domain](url))" }
}
```

The `status` key is the state; its value is the markdown report. Graceful
degradation: a notification with no parseable findings falls back to the status note.

**Not yet wired:** live `agent_report` events in the Observatory timeline still render
as plain `<pre>`. Swapping them to `SubagentOutput` is a follow-up (requires the
timeline data to carry the structured notification payload).

---

## [0.3] — 2026-05-29 · `exec_command` renderers

Expanded the structured `exec_command` output renderers well past the original brief.
See `docs/Exec Renderers Handoff.md` for the full payload contract.

### Added

- New kinds beyond the original five: `file` (`nl`/`cat`/`sed -n`/`head`),
  `matches` (`rg`/`grep`), `http` (`curl`/`wget`), `build`, `trace`, `lint`, `tree`,
  `log`, `json`, `diffstat`, `git` (commit/add/worktree/branch/merge sub-views), and
  `compose` (`docker compose up`).
- Per-kind accent colours via `.xr-kind[data-kind="…"]`.
- `execOverflow(out)` as the single source of truth for inline-cap overflow labels.

### Notes

- Every renderer takes `<RendererView r={outputRender} full={boolean} />` — `full=false`
  is the capped inline preview, `full=true` is the modal body.
- Raw `output` string is still always sent; powers the modal **RAW** toggle and the
  plain fallback.

---

## [0.2] — light request / call renderers

### Added

- Compact one-line renderers for low-payload tool calls — `read`, `search`, `web`
  (fetch), `agent` (spawn/wait/send), `skill` — via the `.xr-call-line` vocabulary.
- Reference impl in `call-renderers.jsx`; spec data in `call-spec-data.jsx`.

---

## [0.1] — initial `exec_command` renderers

### Added

- First five structured kinds: `diff`, `tests`, `status`, `table`, `plain`.
- The shared pipeline: server parses each result once → `outputRender` JSON →
  renderer component → capped inline preview → (expand) modal with **RAW** escape hatch.
- `Exec Renderers.html` component library.
