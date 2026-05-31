# Session Source Adapter Phase 3 — Claude Code Discovery (read-only list) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This phase consumes the LOCKED contracts from `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md` — use those names/signatures verbatim; never rename. The `SourceId` dispatch discriminator travels on the wire as **`?sourceId=`** (NOT `?source=`, which is already `SessionFilter.threadSource`); the contract **fields** stay `SessionSummary.source` / `SessionFilter.source`.

**Goal:** Implement Claude Code (CC) **discovery + metadata** so CC sessions appear in the merged `/api/sessions` list alongside Codex, filterable by `?sourceId=claude-code`, and so `/api/health` reports both sources. CC sessions are discovered by globbing the CC projects directory and deriving each `SessionSummary` from its transcript **without a full timeline parse** (title from the `ai-title` line, `cwd`/`gitBranch`/`version`/`id` from line fields, token totals by summing assistant `message.usage`, status by a recency heuristic, `childCount` from the `subagents/` directory). `ClaudeCodeSource` implements the LOCKED `SessionSource` interface from Phase 1, is registered in the Phase 2 registry alongside `CodexSource`, and its `parse` / `listChildren` / `tail` THROW a typed "not implemented until Phase 4/5/6" error this phase.

**Phase Boundary:** This phase adds `src/backend/sources/claudeCode/claudePaths.ts`, `discovery.ts`, `claudeMeta.ts`, and `ClaudeCodeSource.ts`, plus the `tests/fixtures/claudeProjects.ts` builder, and registers `ClaudeCodeSource` in the registry composition (`src/backend/server.ts` / the Phase 2 registry accessor). It does **NOT** implement the CC timeline parse (`parseClaudeSession.ts`/`toolMap.ts` — Phase 4), the CC agent graph (`listChildren` real children + native edges — Phase 5), or CC live tail (`tail` — Phase 6); those three `SessionSource` methods throw a typed `ClaudeCodeNotImplementedError`. It changes **no renderer**, no normalized model field, and no Codex behavior. Codex discovery/timeline/graph stay byte-identical. The only user-visible change is that CC sessions now appear in the merged session list and are filterable by `sourceId`, and health reports two sources.

**Phase-2 Dependency Note:** This phase consumes `src/shared/contracts.ts` (`SourceId`, `SessionSummary.source`, `SessionFilter.source`), `src/backend/sources/SessionSource.ts` (interface + `ResolvedSession` / `SourceHealth` / `SourceTailResult`), `src/backend/sources/registry.ts` (`createSourceRegistry`), and `src/backend/sources/sourceQuery.ts` (`parseSourceId`) from Phases 1–2. If those are not present at kickoff, STOP and confirm Phases 1–2 are landed first — Phase 3 cannot register a second source without the registry/dispatch seam. `parseSourceId` already accepts `"claude-code"` as a valid `SourceId` (Phase 2 returned it as valid even though no source was registered); this phase makes that value resolve to a real source instead of an unknown-source `400`.

**Verification:** `npm run typecheck`, `npm run test -- --run`, focused `npm run test -- --run tests/unit/claudePaths.test.ts tests/unit/claudeMeta.test.ts tests/integration/claudeDiscovery.test.ts tests/integration/mergedSessions.test.ts`, `npm run lint`, `npm run privacy:check`, `npm run e2e -- --grep @sessions`.

**Smoke-Testable Outcome:** With a temp `CLAUDE_PROJECTS_DIR` (built by `createClaudeProjectsFixture`) **and** a temp `$CODEX_HOME`, `GET /api/sessions` (no `sourceId`) returns CC and Codex sessions interleaved, sorted by `updatedAtMs` desc; `GET /api/sessions?sourceId=claude-code` returns only the CC sessions; `GET /api/sessions?sourceId=codex` returns only Codex; `GET /api/health` reports `[{source:"codex",available:true},{source:"claude-code",available:true}]` (or `available:false` with a `detail` when the projects dir is missing). A CC `SessionSummary` carries `source:"claude-code"`, a derived `title`, real `cwd`/`gitBranch`, a summed `tokenTotal`/`tokensUsed`, a `status` heuristic, and a `childCount` equal to the number of `subagents/agent-*.jsonl` files. Opening a CC session's timeline still surfaces the Phase-4 "not implemented" error (no CC timeline yet) — that is the expected boundary.

**Phase Acceptance:** Vitest integration drives the merged-list, source-filter, and health flows against a generated temp `CLAUDE_PROJECTS_DIR` + temp `$CODEX_HOME`, and `npm run e2e -- --grep @sessions` confirms no regression to the Codex Sessions flow. Records `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-3.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks (T1, T2, T3), but the phase owner remains responsible for sequencing, the registry-composition integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Keep all CC-vs-Codex branching inside `src/backend/sources/claudeCode/` and the registry composition — **no `if (claudeCode)` / `if (codex)` outside `src/backend/sources/`** (the cross-cutting guarantee from the overview).
- Preserve byte-identical Codex behavior: registering a second source must not change any Codex response. Treat any Codex e2e/integration diff as a hard failure.
- Confirm the locked `SessionSource` signatures are honored verbatim — `ClaudeCodeSource` implements every method, and the three deferred methods (`parse`/`listChildren`/`tail`) throw the typed `ClaudeCodeNotImplementedError` rather than returning a partial/wrong shape.
- Confirm `npm run privacy:check` stays green every commit: CC discovery derives only previews/metadata (titles, first-message previews) through the same `src/shared/redaction.ts` masking the Codex path uses; raw CC transcript content never leaves the server.
- Ensure `childCount` is a **count only** this phase (no real child `SessionSummary`s, no edges) — `listChildren` returning real rows is Phase 5.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Paths + fixture | Task 1 | one sub-agent | Task 2 after `claudePaths.ts` + fixture land | `src/backend/sources/claudeCode/claudePaths.ts`, `tests/fixtures/claudeProjects.ts` | `npm run test -- --run tests/unit/claudePaths.test.ts` |
| Discovery + metadata | Task 2 | one sub-agent (after Task 1) | Task 3 after `claudeMeta`/`discovery` signatures are stable | `src/backend/sources/claudeCode/discovery.ts`, `claudeMeta.ts` | `npm run test -- --run tests/unit/claudeMeta.test.ts` |
| Source + registry + API integration | Task 3 | phase-owner only (integration risk) | none (depends on Task 2) | `src/backend/sources/claudeCode/ClaudeCodeSource.ts`, registry composition in `src/backend/server.ts`, `src/backend/api/health.ts` | `npm run test -- --run tests/integration/claudeDiscovery.test.ts tests/integration/mergedSessions.test.ts` |
| Acceptance | Task 4 | phase-owner only | none | acceptance packet, full command set | full Phase 3 command set |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-31-session-source-adapter-phase-3-handoff.md`
- Required contents: current task status, branch/worktree, sub-agent results, verification evidence (typecheck + test + lint + privacy + e2e), service-wiring coverage, acceptance packet status, blockers/escalations, and exact restart instructions.

## Codex Efficiency Rules

- Do not delegate Task 3; the registry composition + health wiring is the integration risk and must stay with the phase owner.
- Do not implement `parseClaudeSession.ts` or `toolMap.ts` in this phase — `ClaudeCodeSource.parse` throws. CC timeline is Phase 4.
- Do not implement real `listChildren` rows or native subagent edges — only the `childCount` integer derived from the `subagents/` directory. CC agent graph is Phase 5.
- Do not implement `ClaudeCodeSource.tail` — it throws. CC live tail is Phase 6.
- Do not touch renderers, `contracts.ts`, `CodexSource`, or any Codex handler logic beyond the registry composition that already exists from Phase 2.

## Autonomy And Escalation

| Escalation | Needed By | Agent-Owned Attempt First | Escalate Only If | Blocking Behavior |
| --- | --- | --- | --- | --- |
| Local Claude Code data | Task 2, Task 4 | Use `createClaudeProjectsFixture` temp projects dirs (redacted synthetic transcripts) and optionally validate against `$CLAUDE_PROJECTS_DIR` / `~/.claude/projects` if present and the user permits. | The user requires validation against private real CC data and local `~/.claude/projects` is unavailable or off-limits. | Phase can complete with temp fixtures; record real-data validation as not run. Do not read or print private CC transcript content. |

---

## Real-format grounding (verified against local `~/.claude/projects`)

The fixture and metadata derivation are anchored to the **real** on-disk layout (structure/keys inspected, no private content copied):

- Transcript path: `<projectsDir>/<escaped-cwd>/<session-uuid>.jsonl`, where `<escaped-cwd>` is the absolute cwd with `/` (and `.`) replaced by `-` (e.g. `/Users/adam/Projects/agentview` → `-Users-adam-Projects-agentview`).
- Sub-agents (when present) live in a sibling dir next to the transcript: `<projectsDir>/<escaped-cwd>/<session-uuid>/subagents/agent-<id>.jsonl` plus sidecar `agent-<id>.meta.json` of shape `{ "agentType": string, "description": string, "toolUseId": string }`.
- Line types observed: `last-prompt`, `mode`, `permission-mode`, `attachment`, `file-history-snapshot`, `user`, `ai-title`, `assistant`, `system`, `queue-operation` (plus `summary` in some transcripts).
- The title line is `{"type":"ai-title","aiTitle":"…","sessionId":"…"}` (field is **`aiTitle`**, not `title`).
- Per-line stamped fields (on `user`/`assistant`/`attachment`/`system` lines): `cwd`, `gitBranch`, `version`, `sessionId`, `timestamp`, `uuid`, `parentUuid`, `isSidechain`, `userType`.
- Token usage lives on assistant lines at `message.usage` with keys: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` (and others).
- The first `user` line's `message.content` may be a plain string (preview source) or an array of content blocks (extract `text` blocks for the preview).

---

## File Map

- Create: `src/backend/sources/claudeCode/claudePaths.ts` — `resolveClaudeProjectsDir({ env, homeDir })` (default `~/.claude/projects`, override `CLAUDE_PROJECTS_DIR`), `escapeCwd(cwd)` (`/`→`-`), and `resolveClaudeSessionPath(projectsDir, relPath)` traversal guard (mirror `src/backend/codexPaths.ts`: `ensureInside` + `ClaudePathError`).
- Create: `src/backend/sources/claudeCode/discovery.ts` — `discoverClaudeSessions(projectsDir)` globs `<projectsDir>/*/*.jsonl` → `DiscoveredClaudeSession[]` (`{ sessionId, transcriptPath, projectDir, subagentsDir, childCount }`); `countSubagents(subagentsDir)` counts `agent-*.jsonl` files (presence/count only this phase).
- Create: `src/backend/sources/claudeCode/claudeMeta.ts` — `deriveClaudeMeta(transcriptPath, discovered, now)` reads the transcript line-by-line **without a full parse** and returns a `SessionSummary` (derivation table below). Pure-function helpers (`pickTitle`, `sumUsageTokens`, `inferStatus`) are unit-tested in isolation.
- Create: `src/backend/sources/claudeCode/ClaudeCodeSource.ts` — `createClaudeCodeSource({ projectsDir })` returning a `SessionSource` with `id:"claude-code"`, real `getHealth` / `listSessions` / `getSession` / `resolveSession` / `close`, and `parse` / `listChildren` / `tail` throwing `ClaudeCodeNotImplementedError`.
- Create: `tests/fixtures/claudeProjects.ts` — `createClaudeProjectsFixture({ sessions })` builder writing a temp `CLAUDE_PROJECTS_DIR` tree (one plain session, one with a `subagents/` dir) and returning `{ projectsDir, cleanup }` (mirror `tests/fixtures/codexHome.ts`).
- Modify: `src/backend/server.ts` (or the Phase-2 registry accessor `src/backend/sources/defaultRegistry.ts`) — register `createClaudeCodeSource({ projectsDir })` alongside `createCodexSource(...)` in the `createSourceRegistry([...])` composition, resolving `projectsDir` via `resolveClaudeProjectsDir()`.
- Modify: `src/backend/api/health.ts` — already reports `registry.getHealth()` across all sources from Phase 2; confirm the two-source response and the per-`sourceId` narrowing. (No structural change expected; covered by a health assertion.)
- Test: `tests/unit/claudePaths.test.ts` — projects-dir resolution (default + env override), `escapeCwd`, traversal rejection.
- Test: `tests/unit/claudeMeta.test.ts` — title (ai-title + fallback), token-sum, status heuristic, child-count, field passthrough.
- Test: `tests/integration/claudeDiscovery.test.ts` — `createClaudeCodeSource` `listSessions`/`getSession`/`getHealth`/`resolveSession` against the temp fixture; `parse`/`listChildren`/`tail` throw the typed not-implemented error.
- Test: `tests/integration/mergedSessions.test.ts` — spawn the API with both `CODEX_HOME` and `CLAUDE_PROJECTS_DIR`; merged list, `?sourceId=claude-code`, `?sourceId=codex`, and two-source `/api/health`.
- Modify: `playwright.config.ts` — create a temp `CLAUDE_PROJECTS_DIR` fixture alongside the existing e2e Codex home and pass it on the API web-server command env so the @sessions e2e exercises the merged list.
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-3.md` — acceptance evidence packet.

### `SessionSummary` fields CC must populate (derivation contract — `claudeMeta.ts`)

| `SessionSummary` field | Source / derivation | Notes |
| --- | --- | --- |
| `source` | literal `"claude-code"` | the locked discriminator; stamped on every CC row |
| `id` | the `<session-uuid>` from the filename, cross-checked against any line's `sessionId` | unprefixed (composite key is `(source, id)`) |
| `title` | the last `ai-title` line's `aiTitle`; fallback to a redacted preview of the first `user` message's text | empty/whitespace `aiTitle` ⇒ fallback |
| `firstUserMessagePreview` | redacted preview of the first `user` line's `message.content` (string, or joined `text` blocks) | masked via `src/shared/redaction.ts` |
| `titlePreview` / `preview` | redacted preview of `title` | parity with Codex rows so the UI search/preview works |
| `lastMessage` | redacted preview of the last `assistant` (or `user`) message text | preview only; never raw |
| `cwd` | the `cwd` field off the first stamped line that has one | real absolute path |
| `branch` / `gitBranch` | the `gitBranch` field off the first stamped line that has one | `gitBranch` mirrored into `branch` for the table; `gitSha`/`gitOriginUrl` left `null` (not in CC lines) |
| `model` | the last assistant line's `message.model` when present, else `""` | CC stamps the model on assistant `message.model` |
| `tokenTotal` | sum over assistant lines of `usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens` | the `sumUsageTokens` helper; missing keys treated as 0 |
| `tokensUsed` | same value as `tokenTotal` | parity with the Codex `tokensUsed` column |
| `createdAtMs` | first line's `timestamp` (ms) when present, else transcript file `birthtimeMs`/`ctimeMs` | `Date.parse` of the ISO `timestamp` |
| `updatedAtMs` | last line's `timestamp` (ms) when present, else transcript file `mtimeMs` | drives the merged-list sort comparator |
| `updatedAt` | ISO string of `updatedAtMs` | string mirror Codex rows carry |
| `status` | `inferStatus`: file `mtimeMs` within `STALE_WINDOW_MS` (default 10 min) AND no terminal marker ⇒ `"running"`, else `"complete"` | terminal marker = a `system` line with `subtype`/`stopReason` indicating end, or the last line being a completed assistant turn; finalized in `inferStatus` and unit-tested |
| `childCount` | count of `subagents/agent-*.jsonl` files in `<session-uuid>/subagents/` | count only this phase; `0` when no `subagents/` dir |
| `openChildCount` | `0` this phase | open/closed child status is Phase 5 (`listChildren` + edges); a `0` placeholder keeps the table column populated |
| `parentId` / `parentEdgeSource` / `parentEdgeConfidence` / `parentEdgeVia` | omitted this phase | CC parent edges are Phase 5; CC sessions discovered here are roots (sidechain transcripts are NOT enumerated as top-level rows — see discovery rule below) |
| `threadSource` | `"user"` | top-level CC transcripts are user roots; sub-agent sidechains are Phase 5 |
| `agentRole` / `agentNickname` | omitted (`null`) this phase | derived from `subagents/*.meta.json` in Phase 5 |
| `rolloutPath` | the absolute `transcriptPath` | the generic "raw log path"; lets `getSession`/links carry the resolved path |
| `archived` | `false` | CC has no archive concept; the archived filter excludes nothing for CC |
| `warningCountStatus` / `failedToolCountStatus` | `"not_requested"` | counts are a Phase-4+ parse concern; the status keeps the badge column inert |

> **Why no full parse:** `deriveClaudeMeta` streams the transcript and extracts only the fields above (first/last stamped line, `ai-title`, the assistant `usage` running sum, the first user message preview). It never builds `TimelineEvent[]`. The full Anthropic content-block parse is Phase 4 (`parseClaudeSession.ts`).

### How `resolveSession.extra` carries `subagentsDir`

`ClaudeCodeSource.resolveSession(sessionId)` returns:

```ts
{
  source: "claude-code",
  sessionId,
  rawLogPath: <absolute transcriptPath>,         // <projectsDir>/<escaped-cwd>/<uuid>.jsonl
  extra: { subagentsDir: <absolute subagentsDir> } // <projectsDir>/<escaped-cwd>/<uuid>/subagents
}
```

`subagentsDir` is the conventional path (transcript path with `.jsonl` stripped, `/subagents` appended) **whether or not it exists** — Phase 5's `listChildren`/agent-graph reads it; Phase 6's `tail` ignores it. It is carried in the locked `extra?: Record<string, unknown>` slot so the cross-source interface stays opaque (no CC-specific field leaks onto `ResolvedSession`). This phase only populates and returns it; nothing consumes it yet (the not-implemented methods throw before reading it).

### The typed not-implemented error

`ClaudeCodeSource` exports `class ClaudeCodeNotImplementedError extends Error { code = "CC_NOT_IMPLEMENTED"; phase: 4 | 5 | 6; method: string }`. `parse` throws `{ method:"parse", phase:4 }`, `listChildren` throws `{ method:"listChildren", phase:5 }`, `tail` throws `{ method:"tail", phase:6 }`. The timeline handler's existing error mapping surfaces this as a typed failure (the `@sessions` e2e never opens a CC timeline, so it stays green; a CC timeline request is expected to fail until Phase 4).

### Environment variable

The CC projects directory env var is **`CLAUDE_PROJECTS_DIR`** (default `~/.claude/projects`), mirroring the `CODEX_HOME` pattern. Tests, the integration harness, and `playwright.config.ts` set it to a temp fixture dir.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| CC source health | Header/status chrome | `handleHealthApiRequest` → `registry.getHealth()` (Codex + CC) | filesystem stat of `CLAUDE_PROJECTS_DIR` | None | Temp/real `CLAUDE_PROJECTS_DIR` | Integration: `/api/health` returns two source entries; CC `available:false` + `detail` when projects dir missing. |
| CC discovery list | Sessions table | `ClaudeCodeSource.listSessions(filter,page)` via `registry.get("claude-code")` | CC transcript JSONL glob + per-file metadata derivation | None | Read-only filesystem | Unit (`claudeMeta`) + integration (`claudeDiscovery`): rows carry `source:"claude-code"`, derived title/tokens/status/childCount; `SessionFilter` (search/cwd/updatedAfter/minTokens) applied. |
| Merged session list | Sessions table (default view) | `registry.listSessions` fan-out (Codex + CC) merged by `updatedAtMs` desc | both sources | None | Temp `CODEX_HOME` + `CLAUDE_PROJECTS_DIR` | Integration (`mergedSessions`): omitting `sourceId` interleaves both; ordering is `updatedAtMs` desc. |
| Source-scoped CC list | Sessions table (filtered) | `registry.get("claude-code").listSessions` (via `?sourceId=claude-code`) | CC transcripts | None | Read-only filesystem | Integration: `?sourceId=claude-code` returns only CC rows; `?sourceId=codex` returns only Codex rows. |
| CC session lookup | Row click → detail target | `registry.get("claude-code").getSession(id)` | CC transcript metadata | None | Read-only filesystem | Integration: `(claude-code, id)` resolves the row; unknown CC id → `null`/404. |
| CC resolve (path) | Timeline resolve (Phase 4 prep) | `ClaudeCodeSource.resolveSession(id)` | transcript path + conventional `subagentsDir` | None | Read-only filesystem | Integration: `resolveSession` returns absolute `rawLogPath` + `extra.subagentsDir`; traversal path rejected. |
| CC timeline boundary | Timeline view (deferred) | `ClaudeCodeSource.parse` throws `ClaudeCodeNotImplementedError` | None | None | None | Integration: `parse`/`listChildren`/`tail` throw the typed not-implemented error (phase 4/5/6). |

## E2E Harness Readiness

Reuse the existing Playwright config and the temp `$CODEX_HOME` fixture. Add a temp `CLAUDE_PROJECTS_DIR` fixture (built with the same builder logic as `tests/fixtures/claudeProjects.ts`, inlined in `playwright.config.ts` like `createE2eCodexHome`) created before the API web server starts, and pass `CLAUDE_PROJECTS_DIR=<dir>` on the API web-server command env alongside `CODEX_HOME`. The `@sessions` e2e then exercises the merged list with both sources present. No new e2e spec file is required for Phase 3 acceptance — the existing `@sessions` spec must stay green and the merged list is proved by the integration tests; an optional assertion that a `source:"claude-code"` row is visible may be added to `tests/e2e/sessions-index.spec.ts` if the SessionsView already surfaces a source badge (do not add UI in this phase).

---

### Task 1: `claudePaths.ts` + `createClaudeProjectsFixture` builder

**Depends On:** Phase 2 acceptance (registry + `sourceQuery` + contracts present)

**Execution:** sub-agent lane: Paths + fixture; parallel with none initially; checkpoint `npm run typecheck && npm run test -- --run tests/unit/claudePaths.test.ts`

**Files:**
- Create: `src/backend/sources/claudeCode/claudePaths.ts`
- Create: `tests/fixtures/claudeProjects.ts`
- Test: `tests/unit/claudePaths.test.ts`

**Service Wiring Rows Covered:**
- CC source health (path resolution surface only this task)
- CC resolve (path) (traversal guard surface only this task)

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run tests/unit/claudePaths.test.ts`
- Expected result: `resolveClaudeProjectsDir` honors `CLAUDE_PROJECTS_DIR` and defaults to `~/.claude/projects`; `escapeCwd` matches the real escaping (`/Users/adam/Projects/agentview` → `-Users-adam-Projects-agentview`); `resolveClaudeSessionPath` rejects traversal; the fixture builder writes a temp tree with one plain session and one with a `subagents/` dir.
- Evidence to collect: typecheck output, focused test output, a `tree`/`ls -R` snapshot of one generated fixture dir (structure only).

**Test Mode Disclosure:**
- Automated tests: real local temp filesystem fixture; no private CC data.
- Production/dev path exercised: yes — `claudePaths.ts` is what `ClaudeCodeSource` and the registry composition import.
- Mock-only risk: real CC escaping edge cases (cwd containing `-` or unicode) may differ; mitigated by anchoring `escapeCwd` to the verified rule and an optional `~/.claude/projects` smoke in Task 4.
- Required real dependencies: temp filesystem.
- Blocking if unavailable: yes — Task 2/3 import these.

- [ ] Step 1: Write `tests/unit/claudePaths.test.ts` with failing assertions: (a) `resolveClaudeProjectsDir({ env: { CLAUDE_PROJECTS_DIR: <temp dir> } })` returns the realpath of that dir; (b) with no env var, `resolveClaudeProjectsDir({ env: {}, homeDir: <temp home> })` returns `<temp home>/.claude/projects`; (c) a missing configured dir throws a typed `ClaudePathError` with `code: "CLAUDE_PROJECTS_DIR_MISSING"`; (d) `escapeCwd("/Users/adam/Projects/agentview")` === `"-Users-adam-Projects-agentview"`; (e) `resolveClaudeSessionPath(projectsDir, "../../etc/passwd")` throws `ClaudePathError` with `code: "CLAUDE_PATH_TRAVERSAL"`; (f) a valid relative path under the projects dir resolves inside it. Run and confirm failure (module missing).
- [ ] Step 2: Run `npm run test -- --run tests/unit/claudePaths.test.ts` and confirm the failure is the missing `claudePaths` module.
- [ ] Step 3: Implement `src/backend/sources/claudeCode/claudePaths.ts` mirroring `src/backend/codexPaths.ts`:
  - `export class ClaudePathError extends Error { code: string; constructor(code, message) {…} }`.
  - `export const resolveClaudeProjectsDir = async ({ env = process.env, homeDir = homedir() } = {}) => { … }` — read `env.CLAUDE_PROJECTS_DIR?.trim()`; default `resolve(homeDir, ".claude", "projects")`; `return await realpath(resolve(dir))`; on failure throw `new ClaudePathError("CLAUDE_PROJECTS_DIR_MISSING", …)`.
  - `export const escapeCwd = (cwd: string) => cwd.replace(/[/.]/g, "-")` (replace `/` and `.` with `-`, matching the verified real escaping).
  - `export const resolveClaudeSessionPath = async (projectsDir: string, relPath: string) => { … }` — `realpath` the root, reject absolute `relPath`, resolve against root, and `ensureInside` (copy the `ensureInside` helper pattern verbatim from `codexPaths.ts`).
- [ ] Step 4: Write `tests/fixtures/claudeProjects.ts` exporting `createClaudeProjectsFixture` (mirror `createCodexHomeFixture`'s shape and JSDoc-free builder style):
  - Types: `ClaudeSessionFixture { sessionId: string; cwd: string; aiTitle?: string; gitBranch?: string; version?: string; model?: string; firstUserMessage?: string; createdAtMs: number; updatedAtMs: number; assistantUsages?: Array<{ input?: number; output?: number; cacheCreate?: number; cacheRead?: number }>; subagents?: Array<{ agentId: string; agentType: string; description: string; toolUseId: string }> }` and `ClaudeProjectsFixture { projectsDir: string; cleanup(): Promise<void> }`.
  - `createClaudeProjectsFixture({ sessions = [] })`: `mkdtemp(join(tmpdir(), "agentview-claude-projects-"))`; for each session, compute `escapeCwd(session.cwd)`, `mkdir` `<projectsDir>/<escaped>/`, and write `<sessionId>.jsonl` whose lines are real CC shapes — a `user` line (stamped `cwd`/`gitBranch`/`version`/`sessionId`/`timestamp`/`message.content`), an `ai-title` line (`{type:"ai-title",aiTitle,sessionId}`), and one `assistant` line per `assistantUsages` entry (`{type:"assistant",message:{model,usage:{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}},cwd,gitBranch,version,sessionId,timestamp}`). After writing, set the file mtime to `updatedAtMs` via `utimes`. If `subagents` present, `mkdir` `<escaped>/<sessionId>/subagents/` and write each `agent-<agentId>.jsonl` (a minimal sidechain line) plus `agent-<agentId>.meta.json` (`{agentType,description,toolUseId}`).
  - Return `{ projectsDir, cleanup: () => rm(projectsDir, { recursive: true, force: true }) }`.
  - Provide one default fixture export `defaultClaudeSessions` with two sessions: a plain one (no subagents) and one with two `subagents/` entries — used by the discovery/merged tests.
- [ ] Step 5: Re-run `npm run typecheck && npm run test -- --run tests/unit/claudePaths.test.ts` and confirm green (the fixture is exercised in Task 2/3; here just confirm it typechecks and the path tests pass).
- [ ] Step 6: Commit this task. Suggested message:

  ```
  feat(sources): add claudePaths + claudeProjects fixture builder

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

### Task 2: `discovery.ts` + `claudeMeta.ts` with metadata-derivation unit tests

**Depends On:** Task 1

**Execution:** sub-agent lane: Discovery + metadata; parallel with Task 3 after `claudeMeta`/`discovery` signatures are stable; checkpoint `npm run test -- --run tests/unit/claudeMeta.test.ts`

**Files:**
- Create: `src/backend/sources/claudeCode/discovery.ts`
- Create: `src/backend/sources/claudeCode/claudeMeta.ts`
- Test: `tests/unit/claudeMeta.test.ts`

**Service Wiring Rows Covered:**
- CC discovery list
- CC source health (discovery-side)

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/claudeMeta.test.ts`
- Expected result: `discoverClaudeSessions` returns one entry per `<escaped-cwd>/<uuid>.jsonl` with correct `childCount`; `deriveClaudeMeta` returns a `SessionSummary` whose title/tokens/status/cwd/gitBranch/childCount match the fixture, with the `ai-title` → first-user-message fallback, the `usage`-sum, and the recency status heuristic all unit-tested.
- Evidence to collect: focused test output; a note of the finalized status-heuristic window and terminal-marker rule.

**Test Mode Disclosure:**
- Automated tests: real local temp fixture (`createClaudeProjectsFixture`) + synthetic transcript lines; no private CC data.
- Production/dev path exercised: yes — `discovery`/`claudeMeta` are what `ClaudeCodeSource.listSessions`/`getSession` call.
- Mock-only risk: real CC transcripts may carry line shapes the fixture omits; mitigated by anchoring shapes to verified keys and an optional real-dir smoke in Task 4.
- Required real dependencies: temp filesystem.
- Blocking if unavailable: yes.

- [ ] Step 1: Write failing `tests/unit/claudeMeta.test.ts`. Build a `createClaudeProjectsFixture` with the two default sessions, then assert against pure helpers and `deriveClaudeMeta`:
  - `discoverClaudeSessions(projectsDir)` returns two `DiscoveredClaudeSession`s; the one with subagents has `childCount === 2` and a `subagentsDir` ending in `/<uuid>/subagents`; the plain one has `childCount === 0`.
  - `pickTitle`: returns `aiTitle` when present; falls back to a redacted preview of the first user message when `aiTitle` is empty/whitespace.
  - `sumUsageTokens` over `[{input:100,output:50,cacheCreate:10,cacheRead:5},{input:20,output:8}]` === `100+50+10+5+20+8` (missing keys = 0).
  - `inferStatus`: a transcript whose file mtime is `now` and has no terminal marker ⇒ `"running"`; a transcript whose mtime is older than `STALE_WINDOW_MS` ⇒ `"complete"`; a transcript with a terminal marker ⇒ `"complete"` regardless of mtime.
  - `deriveClaudeMeta` returns a full `SessionSummary` with `source:"claude-code"`, the fixture's `cwd`/`gitBranch`/`model`/`id`, `tokenTotal === tokensUsed ===` the usage sum, `childCount` from discovery, `updatedAtMs` from the last line timestamp (or mtime), `archived:false`, `openChildCount:0`, and a redacted `firstUserMessagePreview` (assert no raw secret-like substring leaks — feed a `message.content` containing a fake `sk-...` token and assert it is masked).
  Run and confirm failure (modules missing).
- [ ] Step 2: Run `npm run test -- --run tests/unit/claudeMeta.test.ts` and confirm failures are the missing `discovery`/`claudeMeta` modules.
- [ ] Step 3: Implement `src/backend/sources/claudeCode/discovery.ts`:
  - `export interface DiscoveredClaudeSession { sessionId: string; transcriptPath: string; projectDir: string; subagentsDir: string; childCount: number; }`.
  - `export const discoverClaudeSessions = async (projectsDir: string): Promise<DiscoveredClaudeSession[]>` — read each `<projectsDir>/*/` dir, list `*.jsonl` files (ignore the sibling `<uuid>/` dirs and any nested `subagents/`), derive `sessionId` from the filename (strip `.jsonl`), set `transcriptPath` absolute, `subagentsDir = join(projectDir, sessionId, "subagents")`, and `childCount = await countSubagents(subagentsDir)`.
  - `export const countSubagents = async (subagentsDir: string): Promise<number>` — return the number of files matching `agent-*.jsonl` (excluding `.meta.json`); return `0` if the dir does not exist.
  - Use `node:fs/promises` `readdir`/`stat`; do NOT use a glob dependency (none is installed — mirror the dependency-free Codex code).
- [ ] Step 4: Implement `src/backend/sources/claudeCode/claudeMeta.ts`:
  - Export pure helpers `pickTitle(aiTitle, firstUserPreview)`, `sumUsageTokens(usages)`, `inferStatus({ mtimeMs, hasTerminalMarker, now, staleWindowMs })`, and `STALE_WINDOW_MS = 10 * 60 * 1000`.
  - `export const deriveClaudeMeta = async (discovered: DiscoveredClaudeSession, { now = Date.now() } = {}): Promise<SessionSummary>` — stream the transcript via `readJsonlLines(discovered.transcriptPath)` (reuse `src/backend/rollout/jsonlStream.ts`), tracking: first stamped `cwd`/`gitBranch`/`version`, the last `ai-title.aiTitle`, the first `user` message content, the last assistant `message.model`, the running `usage` sum, first/last `timestamp`, and whether a terminal marker was seen. `stat` the file for `mtimeMs`/`birthtimeMs`. Build the `SessionSummary` per the derivation table above, redacting every preview through `src/shared/redaction.ts` (the same helper the Codex parser uses — find it via `grep -rn "redact" src/backend/rollout/`).
  - Keep this a metadata-only stream: do NOT construct `TimelineEvent[]` or import `parseRollout`.
- [ ] Step 5: Run `npm run typecheck && npm run test -- --run tests/unit/claudeMeta.test.ts` and confirm green. Record the finalized `inferStatus` terminal-marker rule (which line/`subtype` counts as terminal) in a comment and in the acceptance packet.
- [ ] Step 6: Commit this task. Suggested message:

  ```
  feat(sources): derive claude-code session metadata without full parse

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

### Task 3: `ClaudeCodeSource` + register in registry + merged-list/health integration

**Depends On:** Task 2

**Execution:** phase-owner only (integration risk); parallel with none; checkpoint `npm run test -- --run tests/integration/claudeDiscovery.test.ts tests/integration/mergedSessions.test.ts`

**Files:**
- Create: `src/backend/sources/claudeCode/ClaudeCodeSource.ts`
- Modify: `src/backend/server.ts` (or `src/backend/sources/defaultRegistry.ts` — whichever owns the Phase-2 `createSourceRegistry([...])` composition)
- Modify: `src/backend/api/health.ts` (confirm two-source response; structural change only if the Phase-2 health handler hard-coded a single source)
- Modify: `playwright.config.ts`
- Test: `tests/integration/claudeDiscovery.test.ts`, `tests/integration/mergedSessions.test.ts`
- Test (existing, must stay green): `tests/integration/sessionsApi.test.ts`, `tests/integration/sourceDispatch.test.ts`, `tests/e2e/sessions-index.spec.ts`

**Service Wiring Rows Covered:**
- CC source health
- CC discovery list
- Merged session list
- Source-scoped CC list
- CC session lookup
- CC resolve (path)
- CC timeline boundary

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/claudeDiscovery.test.ts tests/integration/mergedSessions.test.ts && npm run typecheck && npm run lint`
- Expected result: `ClaudeCodeSource` implements the locked interface; `listSessions`/`getSession`/`getHealth`/`resolveSession` work against the fixture; `parse`/`listChildren`/`tail` throw `ClaudeCodeNotImplementedError`; the merged `/api/sessions` interleaves both sources by `updatedAtMs` desc; `?sourceId=claude-code` narrows to CC; `/api/health` reports both sources; Codex specs stay green unchanged.
- Evidence to collect: integration output, a captured merged-list ordering, a captured two-source `/api/health` body, and a captured `parse`-throws assertion.

**Test Mode Disclosure:**
- Automated tests: real local API spawned with both `CODEX_HOME` and `CLAUDE_PROJECTS_DIR` temp fixtures (mirror `sessionsApi.test.ts` spawn harness).
- Production/dev path exercised: yes — HTTP handlers → registry → `ClaudeCodeSource` → filesystem.
- Mock-only risk: real CC dir vs. fixture drift; mitigated by an optional `~/.claude/projects` smoke in Task 4.
- Required real dependencies: local HTTP runtime, temp filesystem.
- Blocking if unavailable: yes.

- [ ] Step 1: Write failing `tests/integration/claudeDiscovery.test.ts` driving `createClaudeCodeSource({ projectsDir })` directly against `createClaudeProjectsFixture`:
  - `id === "claude-code"`.
  - `getHealth()` → `{ source:"claude-code", available:true }` for a present dir; `{ available:false, detail }` when constructed with a non-existent dir.
  - `listSessions()` returns both fixture sessions with `source:"claude-code"` and derived metadata; `listSessions({ search })` filters by title/preview; `listSessions({ cwd })` filters by cwd; `listSessions({ updatedAfterMs })`/`{ minTokens }` apply; `page` (limit/offset) slices.
  - `getSession(id)` returns the matching row; unknown id → `null`.
  - `resolveSession(id)` → `{ source:"claude-code", sessionId:id, rawLogPath:<abs transcript>, extra:{ subagentsDir:<abs> } }`; a traversal/garbage id rejects via the path guard (or returns a typed not-found — pick and assert).
  - `await expect(source.parse(resolved)).rejects.toThrow(ClaudeCodeNotImplementedError)` (phase 4); same for `listChildren` (phase 5) and `tail` (phase 6).
  Run and confirm failure (module missing).
- [ ] Step 2: Run `npm run test -- --run tests/integration/claudeDiscovery.test.ts` and confirm the failure is the missing `ClaudeCodeSource` module.
- [ ] Step 3: Implement `src/backend/sources/claudeCode/ClaudeCodeSource.ts`:
  - `export class ClaudeCodeNotImplementedError extends Error { code = "CC_NOT_IMPLEMENTED"; method: string; phase: 4 | 5 | 6; constructor(method, phase) {…} }`.
  - `export const createClaudeCodeSource = ({ projectsDir }: { projectsDir: string }): SessionSource => { … }`:
    - `id: "claude-code"`.
    - `getHealth`: `stat`/`readdir` the `projectsDir`; on success `{ source:"claude-code", available:true }`; on missing/unreadable `{ source:"claude-code", available:false, detail: error.message }` (do NOT rethrow — mirror `CodexSource.getHealth`).
    - `listSessions(filter, page)`: `discoverClaudeSessions(projectsDir)` → `deriveClaudeMeta` per session (in parallel via `Promise.all`); apply the `SessionFilter` axes that make sense for CC (`search` over title/`firstUserMessagePreview`/id, `cwd`, `updatedAfterMs`/`updatedBeforeMs`/`createdAfterMs`/`createdBeforeMs`, `minTokens`/`maxTokens`, `model`; `archived` excludes nothing since CC rows are `archived:false`; `threadSource` matches `"user"`); sort by `updatedAtMs` desc; apply `page` limit/offset. Extract the filter predicate into a small shared helper or reuse `tests/unit/sessionFilter.test.ts`'s subject if it is already a pure exported function — check `src/backend/sqlite/stateStore.ts` for the canonical predicate and mirror its semantics so CC filtering matches Codex filtering behavior.
    - `getSession(id)`: derive metadata for the single matching discovered session; `null` if absent.
    - `resolveSession(id)`: locate the discovered session; build `rawLogPath` (validated via `resolveClaudeSessionPath` against `projectsDir`) and `extra:{ subagentsDir }`; throw a typed not-found if the id is unknown.
    - `parse`: `throw new ClaudeCodeNotImplementedError("parse", 4)`. `listChildren`: `throw new ClaudeCodeNotImplementedError("listChildren", 5)`. `tail`: `throw new ClaudeCodeNotImplementedError("tail", 6)`.
    - `close`: `async () => {}` (no held resources — discovery is stateless filesystem reads).
- [ ] Step 4: Register the source in the registry composition. In `src/backend/server.ts` (or `src/backend/sources/defaultRegistry.ts`), resolve `const projectsDir = await resolveClaudeProjectsDir()` (tolerate a missing dir: if `resolveClaudeProjectsDir` throws because the default `~/.claude/projects` is absent, still register a CC source pointed at the configured/default path so `getHealth` reports `available:false` rather than crashing the registry — wrap the resolve so a missing dir yields the unresolved default path and let `getHealth` report unavailability). Add `createClaudeCodeSource({ projectsDir })` to the `createSourceRegistry([ createCodexSource(...), createClaudeCodeSource(...) ])` array. Keep the existing per-request lifecycle exactly as Phase 2 established it.
- [ ] Step 5: Confirm `src/backend/api/health.ts` reports `registry.getHealth()` for both sources (Phase 2 already wired this). If Phase 2 mapped a single `SourceHealth` into the `HealthStatus.stateDb` shape, extend the health body to carry an array/per-source section WITHOUT breaking the existing Codex `stateDb` assertion (add CC as an additional reported source; do not remove the Codex `stateDb` field the existing health e2e asserts). Run `npm run test -- --run tests/integration/sourceErrors.test.ts` and confirm green.
- [ ] Step 6: Write failing `tests/integration/mergedSessions.test.ts` (mirror the `sessionsApi.test.ts` spawn harness, passing BOTH `CODEX_HOME` and `CLAUDE_PROJECTS_DIR` env to `startApi`): (a) `GET /api/sessions` (no `sourceId`) returns Codex + CC rows interleaved, asserting `updatedAtMs` desc ordering across sources; (b) `GET /api/sessions?sourceId=claude-code` returns only `source:"claude-code"` rows; (c) `GET /api/sessions?sourceId=codex` returns only Codex rows; (d) `GET /api/health` returns both source entries with `available:true`; (e) a CC row carries the derived title/tokens/childCount. Run and confirm failure.
- [ ] Step 7: Implement the integration wiring needed to pass step 6 (it should already pass once the source is registered in step 4; fix any merge-ordering or filter mismatch here). Run `npm run test -- --run tests/integration/claudeDiscovery.test.ts tests/integration/mergedSessions.test.ts tests/integration/sessionsApi.test.ts tests/integration/sourceDispatch.test.ts` and confirm green (Codex specs unchanged).
- [ ] Step 8: Update `playwright.config.ts`: add a `createE2eClaudeProjects()` helper (inline, mirroring `createE2eCodexHome`) that builds a temp `CLAUDE_PROJECTS_DIR` with one plain + one subagents session, set `process.env.CLAUDE_PROJECTS_DIR`, and add `CLAUDE_PROJECTS_DIR=${quotedProjectsDir}` to the API web-server command env. Run `npm run e2e -- --grep @sessions` and confirm green (the Codex Sessions flow is unaffected; the merged list now also contains CC rows).
- [ ] Step 9: Run `npm run typecheck && npm run lint && npm run privacy:check` and confirm green (no new raw-content path; CC previews are redacted).
- [ ] Step 10: Commit this task. Suggested message:

  ```
  feat(sources): add ClaudeCodeSource discovery + register in registry

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

### Task 4: Phase 3 Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3

**Execution:** phase-owner only; parallel with none; checkpoint full Phase 3 command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-3.md`
- Modify: any Phase 3 file needed for integration fixes (no contract or Codex-behavior changes)

**Service Wiring Rows Covered:**
- All rows in the Service Wiring Matrix

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run lint && npm run test -- --run && npm run privacy:check && npm run e2e -- --grep @sessions`
- Expected result: CC sessions appear in the merged list and are filterable by `sourceId`; `/api/health` reports both sources; Codex flows are byte-identical; CC timeline still throws the typed Phase-4 not-implemented error.
- Evidence to collect: full command output, e2e summary, captured merged-list ordering, captured two-source `/api/health` body, the finalized status-heuristic note, and (optional) a `~/.claude/projects` smoke result (structure-only, no private content printed).

**Test Mode Disclosure:**
- Automated tests: real local API with temp `CODEX_HOME` + `CLAUDE_PROJECTS_DIR` fixtures + Playwright.
- Production/dev path exercised: yes — browser → API → registry → `ClaudeCodeSource` → filesystem.
- Mock-only risk: optional real `~/.claude/projects` validation may be skipped if local CC data is unavailable or off-limits.
- Required real dependencies: local HTTP runtime, Playwright, temp filesystem.
- Blocking if unavailable: yes, except optional private real-data validation.

- [ ] Step 1: Create the acceptance packet with a Service Wiring table row per matrix flow and a Commits table (Tasks 1–4), each citing the command and the test/spec that proves it.
- [ ] Step 2: Run the full command set and confirm any integration failures; fix within Phase 3 scope only (no contract or Codex-behavior changes).
- [ ] Step 3: Record in the packet: the finalized `inferStatus` heuristic (window + terminal-marker rule), the exact `SessionSummary` fields CC populates and their derivation, the `resolveSession.extra.subagentsDir` convention, the `CLAUDE_PROJECTS_DIR` env var, and the typed `ClaudeCodeNotImplementedError` boundary for Phases 4/5/6 so those phases inherit accurate assumptions.
- [ ] Step 4: Re-run the full command set and attach evidence (command output, e2e artifacts, merged-list + health captures, optional `~/.claude/projects` smoke).
- [ ] Step 5: Commit this task. Suggested message:

  ```
  docs: record session-source-adapter phase 3 acceptance

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: `claudePaths.ts`, `discovery.ts`, `claudeMeta.ts`, `ClaudeCodeSource.ts`, the registry composition, and the fixture compile across both tsconfigs.
- Run: `npm run lint`
  Expected: eslint passes with zero warnings.
- Run: `npm run test -- --run`
  Expected: unit + integration pass, including the new `claudePaths`, `claudeMeta`, `claudeDiscovery`, and `mergedSessions` specs and every unchanged Codex spec.
- Run: `npm run privacy:check`
  Expected: redaction guard stays green — CC previews are masked; raw CC transcript content never leaves the server.
- Run: `npm run e2e -- --grep @sessions`
  Expected: the Sessions flow passes with both sources present; the Codex flow is unchanged and CC rows appear in the merged list.

**Required Service Wiring Coverage:**
- CC source health — `mergedSessions` integration + `/api/health` capture cover the two-source health report and the `available:false` missing-dir path.
- CC discovery list — `claudeMeta` unit + `claudeDiscovery` integration cover metadata derivation (title/token/status/childCount) and `SessionFilter` application.
- Merged session list — `mergedSessions` integration covers omitted-`sourceId` fan-out + `updatedAtMs` desc interleave.
- Source-scoped CC list — `mergedSessions` integration covers `?sourceId=claude-code` (CC only) and `?sourceId=codex` (Codex only).
- CC session lookup — `claudeDiscovery` integration covers `getSession` resolution and unknown-id `null`.
- CC resolve (path) — `claudeDiscovery` integration covers `resolveSession` `rawLogPath` + `extra.subagentsDir` and traversal rejection.
- CC timeline boundary — `claudeDiscovery` integration covers `parse`/`listChildren`/`tail` throwing the typed `ClaudeCodeNotImplementedError` (phase 4/5/6).

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-3.md`

**Completion Rule:** The phase cannot be marked complete until every acceptance command passes, every applicable service-wiring row has evidence, no `if (codex)`/`if (claudeCode)` branching exists outside `src/backend/sources/`, the `SessionSource` signatures match the locked overview verbatim (with `parse`/`listChildren`/`tail` throwing the typed not-implemented error), Codex behavior is byte-identical, and the acceptance packet exists with current commit evidence.
