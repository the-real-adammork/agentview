# Post-Design-Refactor Fixes — Backlog

**Status:** collecting · **Created:** 2026-05-28 · **Owner:** Adam

A running list of correctness bugs to address **after the in-flight design refactor
lands** (we don't want to fight merge conflicts in the view layer while the refactor
is open). Each entry records the symptom, the confirmed/suspected root cause, the
affected code, and a proposed fix direction. Implementation plans get written per-item
once we start, not here.

---

## 1. Worktrees are counted as separate repos in the Repos view

**Symptom:** The Repos index shows multiple cards for what is really one repository —
one card per git worktree (e.g. `impl-phase-4-graph-tokens`,
`impl-phase-2-sessions-index`, … each appear as their own "repo" alongside
`agentview`). All worktrees of a repo should collapse into a single repo card and count
toward one repo.

**Root cause (confirmed):** Repo identity is `deriveRepoName(gitOriginUrl, cwd)`
(`src/shared/repoName.ts`). It prefers the name parsed from the git origin URL, but
falls back to the **cwd basename** when no origin URL is recorded — and in practice most
sessions have `git_origin_url = NULL` (verified against the live `/api/sessions`
payload). Worktrees live at `<repo>/.worktrees/<slug>`, so the cwd basename is the
worktree slug, not the repo name. Each worktree therefore derives a distinct repo name
and splinters into its own card.

Confirmed from live data — same repo, different worktree cwds, all `origin: null`:
```
cwd /Users/adam/Projects/agentview                                  -> "agentview"
cwd /Users/adam/Projects/agentview/.worktrees/impl-phase-4-graph-tokens   -> "impl-phase-4-graph-tokens"
cwd /Users/adam/Projects/agentview/.worktrees/impl-phase-2-sessions-index -> "impl-phase-2-sessions-index"
```

**Affected code:**
- `src/shared/repoName.ts` — `deriveRepoName` / `pathBasename` (the fallback path).
- `src/backend/sqlite/stateStore.ts:148` — sets `repoLabel = deriveRepoName(...)`.
- `src/frontend/views/sessionTree.ts` — `sessionRepoName`, `groupSessionsByRepo`.
- `src/frontend/views/ReposView.tsx` — `RepoCard` displays `group.cwd` (the first
  root's cwd) for the name/branch line.

**Proposed fix direction:**
- In `repoName.ts`, when falling back to the cwd basename, first **canonicalize** the
  path by stripping a trailing `/.worktrees/<slug>` (and bare `/worktrees/<slug>`)
  segment so every worktree resolves to the repo-root basename. This fixes both the
  backend `repoLabel` and the frontend `sessionRepoName` in one place since they share
  the helper.
- Revisit what the `RepoCard` header shows once grouping is correct: `group.cwd` is
  currently whichever root was seen first; it should show the canonical repo path, not a
  worktree path. Worktree/branch detail belongs at the session/sub-row level.
- Open question: should the card surface "N worktrees" as a stat? (Defer unless wanted.)

**Verification:** with the fix, the agentview worktrees collapse to one `agentview`
card; `Repos` count in the header drops accordingly. Add a unit test in `repoName`
covering the `.worktrees/<slug>` canonicalization with `origin: null`.

---

## 2. Sub-agent title should be the sub-agent's own initial prompt, not the parent's

**Symptom (reported):** In the sessions view, a sub-agent's title shows the parent's
initial prompt instead of the sub-agent's own initial prompt.

**Investigation (could not yet reproduce in the data path):** Every layer inspected
already carries the **child's own** prompt, distinct from the parent:
- `state_5.sqlite`: child `threads.title` and `threads.first_user_message` are the
  sub-agent's own prompt (parent title differs).
- `/api/sessions` payload: for rows with `parentId != null`, `title` and
  `firstUserMessagePreview` are the child's own prompt; the parent row's title differs.
- `SessionsView.tsx:391` renders `session.title` per row (the child's own).
- Agent Graph: `agentGraph.ts` `titleFromRow` uses the child row's title.

The one place sub-agents are **not** labeled by their prompt is the Timeline left
sidebar agent tree: `TimelineView.tsx:48` labels sub-agents as
`agentNickname ?? "agent"` (a nickname, not the prompt, and not the parent's prompt).

**Open — need a precise repro from Adam:** which screen, and an example session id where
the sub-agent row shows the *parent's* text. Two hypotheses to confirm against that repro:
1. It's the Timeline agent-tree label (nickname), and the desired change is to label/
   subtitle sub-agents with their own initial prompt brief there.
2. There's a specific data case where a child thread's `title` was written as the
   parent's prompt at Codex ingest time (we read an external DB read-only). If so, prefer
   the child's `first_user_message` over `title` for sub-agent rows.

**Affected code (candidates):** `src/frontend/views/TimelineView.tsx:48` (`threadName`),
`src/frontend/views/SessionsView.tsx:391`, `src/backend/sqlite/stateStore.ts:127`
(`titlePreview` precedence: `title || first_user_message || preview`).

---

## 3. "Failed to fetch" error in the Diagnostics panel

**Symptom:** The Diagnostics panel shows a "Failed to fetch" error.

**Root cause (two distinct things):**
1. **"Failed to fetch" = network-level failure.** The frontend calls the API at an
   absolute base URL `http://127.0.0.1:4317` (`client.ts:111`); there is **no Vite
   proxy** (`vite.config.ts`). When the API server isn't running, every `fetch()`
   rejects with the browser's `TypeError: Failed to fetch`. This is exactly the state
   observed at startup: a stale Vite dev server was up on `:5173` but **nothing was
   listening on `:4317`**. The web app and API must run together (`npm run dev:all`).
2. **Raw TUI log 404 even when the API is up.** `/api/diagnostics/raw-tail` returns
   `404 RAW_TUI_LOG_MISSING` because `~/.codex/log/codex-tui.log` does not exist on this
   machine. The panel surfaces this as an error rather than a benign empty-state.

**Affected code:**
- `src/frontend/api/client.ts:164` (`getJson`) — no handling for fetch rejection;
  callers `.catch` into a generic message.
- `src/frontend/views/DiagnosticsView.tsx` — `rawError` / `summaryError` / `logsError`
  rendering; treats `RAW_TUI_LOG_MISSING` as an error.
- `src/backend/diagnostics/rawTuiLog.ts` — emits `RAW_TUI_LOG_MISSING` (404).
- `vite.config.ts` — no `/api` proxy.

**Proposed fix direction:**
- Treat `RAW_TUI_LOG_MISSING` as an informational empty-state ("no raw TUI log on this
  host"), not a red error.
- Make the API-unreachable case degrade with a clear, actionable message
  ("API not reachable at :4317 — is `npm run api` running?") instead of bare
  "Failed to fetch". Optionally add a Vite `/api` proxy so the web app and API share an
  origin and a single `npm run dev` works, reducing the split-server footgun.

**Verification:** with the API down, the panel shows the actionable message; with the
API up and no `codex-tui.log`, the raw-tail section shows an empty-state, not an error.

---

## Sequencing

Do these **after** the design refactor merges. Suggested order: #1 (self-contained,
shared helper + test), then #3 (UI empty-states), then #2 (needs a repro from Adam first).
