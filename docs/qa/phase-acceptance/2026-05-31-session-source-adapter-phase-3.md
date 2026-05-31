# Phase 3 Acceptance: Claude Code Discovery (read-only list)

Phase plan: `docs/plans/2026-05-31-session-source-adapter-phase-3-cc-discovery.md`

Overview / locked contracts: `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md`

Phase: `2026-05-31-session-source-adapter-phase-3`

Branch: `feat/session-source-adapter`

## Outcome

Phase 3 implements Claude Code (CC) **discovery + metadata** so CC sessions appear in
the merged `/api/sessions` list alongside Codex, filterable by `?sourceId=claude-code`,
and so `/api/health` reports both sources. CC `SessionSummary`s are derived from each
transcript **without a full timeline parse**. `ClaudeCodeSource` implements the locked
`SessionSource` interface; its `parse` / `listChildren` / `tail` throw a typed
`ClaudeCodeNotImplementedError` until Phases 4 / 5 / 6. No renderer, normalized-model
field, or Codex behavior changed.

### Files added

- `src/backend/sources/claudeCode/claudePaths.ts` — `resolveClaudeProjectsDir({ env, homeDir })`
  (default `~/.claude/projects`, override `CLAUDE_PROJECTS_DIR`; throws typed
  `ClaudePathError` `CLAUDE_PROJECTS_DIR_MISSING` when absent), `escapeCwd` (`/` and `.` → `-`),
  `resolveClaudeSessionPath` traversal guard (`CLAUDE_PATH_TRAVERSAL`).
- `src/backend/sources/claudeCode/discovery.ts` — `discoverClaudeSessions(projectsDir)` globs
  `<projectsDir>/*/*.jsonl` → `DiscoveredClaudeSession[]` (dependency-free `node:fs/promises`;
  returns `[]` for a missing dir so the merged fan-out tolerates an absent CC dir);
  `countSubagents(subagentsDir)` counts `agent-*.jsonl` (excludes `.meta.json`; `0` when missing).
- `src/backend/sources/claudeCode/claudeMeta.ts` — `deriveClaudeMeta(discovered, { now })` streams
  the transcript and builds a `SessionSummary` (never `TimelineEvent[]`); pure helpers
  `pickTitle`, `sumUsageTokens`, `inferStatus`, and `STALE_WINDOW_MS`. Every preview is masked
  through `src/shared/redaction.ts`.
- `src/backend/sources/claudeCode/ClaudeCodeSource.ts` — `createClaudeCodeSource({ projectsDir })`
  returning a `SessionSource` (`id:"claude-code"`) with real `getHealth` / `listSessions` /
  `getSession` / `resolveSession` / `close`; `parse` / `listChildren` / `tail` throw
  `ClaudeCodeNotImplementedError`. Exports `ClaudeCodeNotImplementedError`.
- `tests/fixtures/claudeProjects.ts` — `createClaudeProjectsFixture({ sessions })` builder +
  `defaultClaudeSessions` (one plain, one with two `subagents/` entries).

### Files modified

- `src/backend/sources/defaultRegistry.ts` — registers `createClaudeCodeSource({ projectsDir })`
  alongside `createCodexSource(...)`, resolving `projectsDir` via a tolerant resolver: a missing
  `~/.claude/projects` no longer crashes the registry; CC is registered pointed at the default
  path and `getHealth` reports `available:false`.
- `src/backend/api/health.ts` — adds a `sources: SourceHealth[]` array (from `registry.getHealth()`)
  to the health body while keeping the Codex `stateDb` schema (read from the always-registered
  Codex source). Existing `data.status/mode/stateDb` assertions stay intact.
- `playwright.config.ts` — `createE2eClaudeProjects()` builds an existing-but-empty temp
  `CLAUDE_PROJECTS_DIR`, set on the API web-server command env. CC is registered and health
  reports it `available:true`, but discovers zero transcripts so the merged default Sessions
  view stays Codex-only (see Deviations).
- `tests/integration/sourceDispatch.test.ts`, `tests/integration/sessionsApi.test.ts` — isolate CC
  to an empty temp `CLAUDE_PROJECTS_DIR` so Codex assertions stay byte-identical, and update the
  three Phase-2 `claude-code → 400` (unregistered) assertions to the registered-source reality
  (see Deviations).

### Tests added

- `tests/unit/claudePaths.test.ts` (8) — projects-dir resolution (env + default), `escapeCwd`,
  traversal/absolute rejection, valid-inside resolution.
- `tests/unit/claudeMeta.test.ts` (13) — discovery + child-count, `pickTitle` fallback,
  `sumUsageTokens`, `inferStatus`, full `deriveClaudeMeta` derivation + redacted preview (secret masked).
- `tests/integration/claudeDiscovery.test.ts` (10) — `createClaudeCodeSource` `id`/`getHealth`/
  `listSessions` (+ filter/page axes)/`getSession`/`resolveSession`/`close`; `parse`/`listChildren`/
  `tail` throw the typed not-implemented error with the right `phase`.
- `tests/integration/mergedSessions.test.ts` (5) — merged interleave, `?sourceId=claude-code`,
  `?sourceId=codex`, two-source health, derived CC row fields.

## Acceptance commands (all green)

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS (both tsconfigs, no output) |
| `npm run lint` | PASS (`eslint . --max-warnings=0`, zero warnings) |
| `npm run test -- --run` | PASS — **Test Files 64 passed (64); Tests 473 passed (473)** |
| `npm run privacy:check` | PASS — privacy previews 3/3; `privacy check passed` |
| `npm run e2e -- --grep @sessions` | PASS — **7 passed** |
| Focused: `npm run test -- --run tests/unit/claudePaths.test.ts tests/unit/claudeMeta.test.ts tests/integration/claudeDiscovery.test.ts tests/integration/mergedSessions.test.ts` | PASS — 4 files, **36 tests** |

## Captured evidence

### Merged list ordering (no `sourceId`, both sources)

Codex (`codex-newest`, `codex-older`) + CC (default fixture sessions) interleaved by
`updatedAtMs` desc:

```
[
  {"id":"codex-newest","source":"codex","updatedAtMs":1700000400000},
  {"id":"22222222-2222-4222-8222-222222222222","source":"claude-code","updatedAtMs":1700000300000},
  {"id":"11111111-1111-4111-8111-111111111111","source":"claude-code","updatedAtMs":1700000100000},
  {"id":"codex-older","source":"codex","updatedAtMs":1700000050000}
]
```

### Two-source `/api/health` body (`data.sources`)

```
[{"source":"codex","available":true},{"source":"claude-code","available":true}]
```

### Source-scoped lists

```
CC_ONLY_IDS    = ["22222222-2222-4222-8222-222222222222","11111111-1111-4111-8111-111111111111"]
CODEX_ONLY_IDS = ["codex-newest","codex-older"]
```

### `parse`/`listChildren`/`tail` throw the typed not-implemented error

`tests/integration/claudeDiscovery.test.ts` asserts each rejects with
`ClaudeCodeNotImplementedError` carrying `code:"CC_NOT_IMPLEMENTED"` and the owning phase:
`parse → phase 4`, `listChildren → phase 5`, `tail → phase 6`.

### Optional `~/.claude/projects` smoke (structure-only, no private content)

Ran the discovery + metadata derivation against the local real CC projects dir (keys and
non-content scalars only; no titles/previews/transcript content printed):

```
REAL_DIR_EXISTS
discovered_sessions_count= 44
sample_keys= agentNickname,agentRole,archived,branch,childCount,createdAtMs,cwd,
  failedToolCountStatus,firstUserMessagePreview,gitBranch,gitOriginUrl,gitSha,id,lastMessage,
  model,openChildCount,preview,rolloutPath,source,status,threadSource,title,titlePreview,
  tokenTotal,tokensUsed,updatedAt,updatedAtMs,warningCountStatus
sample_source= claude-code
sample_status= running
sample_childCount= 42
sample_tokenTotal_isFinite= true
sample_has_cwd= true
sample_threadSource= user
sample_archived= false
```

Real on-disk layout confirms the fixture/derivation: `<escaped-cwd>/<uuid>.jsonl`, sibling
`<uuid>/subagents/agent-*.jsonl`, `aiTitle` title line, assistant `message.usage` token keys.

## Service Wiring coverage

| Flow | Evidence |
| --- | --- |
| CC source health | `mergedSessions` (`/api/health` → both `available:true`); `claudeDiscovery` (`getHealth` → `available:false` + `detail` for a missing dir). |
| CC discovery list | `claudeMeta` unit (title/token/status/childCount derivation) + `claudeDiscovery` (`listSessions` rows carry `source:"claude-code"` + derived metadata). |
| Merged session list | `mergedSessions`: omitting `sourceId` interleaves both sources sorted by `updatedAtMs` desc. |
| Source-scoped CC list | `mergedSessions`: `?sourceId=claude-code` → CC only; `?sourceId=codex` → Codex only. |
| CC session lookup | `claudeDiscovery`: `getSession(id)` resolves; unknown id → `null`. |
| CC resolve (path) | `claudeDiscovery`: `resolveSession` returns absolute `rawLogPath` + `extra.subagentsDir`; unknown/traversal id rejects. |
| CC timeline boundary | `claudeDiscovery`: `parse`/`listChildren`/`tail` throw the typed not-implemented error. |
| Codex byte-identical | `sessionsApi`, `sourceDispatch`, `timelineApi`, `graphTokensApi`, `reconstructedEdges`, and the `@sessions` e2e stay green (CC isolated to an empty dir in Codex harnesses). |

## Finalized derivation decisions (downstream phases inherit these)

### `inferStatus` heuristic (window + terminal-marker rule)

- **`STALE_WINDOW_MS = 10 * 60 * 1000`** (10 minutes).
- A transcript whose **file mtime** is within `STALE_WINDOW_MS` of `now` **AND** has **no
  terminal marker** ⇒ `"running"`; everything else ⇒ `"complete"`.
- A **terminal marker forces `"complete"`** regardless of mtime.
- **Terminal-marker rule (Phase 3):** a `system` line whose `subtype` is `end` / `completed` /
  `complete` (case-insensitive), or that carries a non-empty string `stopReason`. The full
  stop-reason taxonomy is a Phase-4 parse concern; this phase only needs the boolean "did the
  run end". Phases 4–6 may refine the marker set as the real CC `system` line shapes are parsed.

### `SessionSummary` fields CC populates (and derivation)

- `source` = literal `"claude-code"`.
- `id` = `<uuid>` from the filename.
- `title` = last `ai-title.aiTitle`; fallback = redacted preview of the first `user` message text
  (`pickTitle`).
- `firstUserMessagePreview` / `titlePreview` / `preview` / `lastMessage` = redacted previews
  (`maskPreviewSecrets`, bounded to 800 chars). `lastMessage` = last assistant (else user) text.
- `cwd` / `branch` / `gitBranch` = first stamped line's `cwd` / `gitBranch` (`gitBranch` mirrored
  into `branch`). `gitSha` / `gitOriginUrl` = `null` (not in CC lines).
- `model` = last assistant `message.model`, else `""`.
- `tokenTotal` = `tokensUsed` = sum over assistant lines of
  `input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens`
  (`sumUsageTokens`; missing keys = 0).
- `createdAtMs` = first line `timestamp` ms (else file `birthtimeMs`/`ctimeMs`);
  `updatedAtMs` = last line `timestamp` ms (else file `mtimeMs`); `updatedAt` = ISO of `updatedAtMs`.
- `status` = `inferStatus` (above).
- `childCount` = count of `subagents/agent-*.jsonl`; `openChildCount` = `0` (placeholder, Phase 5).
- `threadSource` = `"user"`; `agentNickname` / `agentRole` = `null` (Phase 5); `archived` = `false`.
- `warningCountStatus` / `failedToolCountStatus` = `"not_requested"` (Phase 4+ parse concern).
- `rolloutPath` = absolute `transcriptPath`. Parent-edge fields omitted (CC roots; Phase 5).

### `resolveSession.extra.subagentsDir` convention

`resolveSession(id)` returns `{ source:"claude-code", sessionId, rawLogPath:<abs transcript>,
extra:{ subagentsDir:<abs> } }` where `subagentsDir` = the transcript path with `.jsonl` stripped
+ `/subagents` appended (`<projectsDir>/<escaped-cwd>/<uuid>/subagents`), whether or not it exists.
The transcript path is validated against the projects root via `resolveClaudeSessionPath`. Nothing
consumes `extra` yet (Phase 5 `listChildren`/agent-graph reads it; Phase 6 `tail` ignores it).

### `CLAUDE_PROJECTS_DIR` env var

Default `~/.claude/projects`; override via `CLAUDE_PROJECTS_DIR`. Mirrors the `CODEX_HOME` pattern.
Tests, the integration harness, and `playwright.config.ts` set it to a temp fixture dir.

### Typed `ClaudeCodeNotImplementedError` boundary

`class ClaudeCodeNotImplementedError extends Error { code = "CC_NOT_IMPLEMENTED"; method: string;
phase: 4 | 5 | 6 }`. `parse → {method:"parse", phase:4}`, `listChildren → {method:"listChildren",
phase:5}`, `tail → {method:"tail", phase:6}`. Phases 4/5/6 replace the corresponding throw with the
real implementation.

## Deviations from the plan (recorded per the autonomy clause)

1. **`sourceDispatch.test.ts` `claude-code` assertions updated.** Phase 2's
   `tests/integration/sourceDispatch.test.ts` encoded the *unregistered-source* behavior — three
   assertions expected `?sourceId=claude-code` (sessions list, `/api/sessions/:id`, timeline) to
   return `400 UNKNOWN_SOURCE`. The overview's Phase-2 Dependency Note explicitly states Phase 3
   "makes that value resolve to a real source instead of an unknown-source 400," so those
   assertions are obsolete by design. They were updated to the registered-source reality (empty CC
   list `200`; Codex id unknown to CC → `404 THREAD_NOT_FOUND` for both `/api/sessions/:id` and
   `/api/timeline`). The Codex assertions in that spec are unchanged. This is the smallest change
   consistent with the locked contract and the documented intent.

2. **CC isolated to an empty dir in the Codex test harnesses + the `@sessions` e2e.** With CC
   registered, the merged fan-out reads `CLAUDE_PROJECTS_DIR` (default `~/.claude/projects`). Tests
   that only set `CODEX_HOME` would otherwise pick up the developer's real CC data — polluting the
   Codex-only assertions and tripping the first-paint JSONL read trap in `sessionsApi.test.ts`
   (CC discovery legitimately reads transcript JSONL on list, which is CC's design). Resolution:
   `sessionsApi.test.ts` and `sourceDispatch.test.ts` set `CLAUDE_PROJECTS_DIR` to an isolated
   empty temp dir, so CC discovers zero sessions and the Codex bodies stay byte-identical. The
   plan's "no `if (codex)` outside `src/backend/sources/`" guarantee is preserved — no source
   branching was added to any handler.

3. **`@sessions` e2e CC fixture is empty (not "one plain + one subagents session").** Plan Step 8
   suggested seeding the e2e `CLAUDE_PROJECTS_DIR` with CC sessions, but the existing `@sessions`
   spec asserts *exact* Codex row counts (`toHaveCount(2)`), tree-grouping (`data-depth`), the
   transport "sessions: 2" status, and the default sub-agent selection — all of which break if CC
   rows enter the merged default view, and the `SessionsView` frontend is **out of Phase 3 scope**
   ("do not add UI in this phase"). The overview's cross-cutting guarantee — "Existing Codex e2e
   specs must stay green every phase" — is the harder constraint, so the e2e CC dir is created
   *existing but empty*: CC is registered and `/api/health` reports it `available:true`, but the
   merged default view stays Codex-only. The CC merged list is fully proved by the `mergedSessions`
   integration test. When the CC Sessions UI lands (a later phase), the e2e fixture can be seeded.

## Completion checklist

- [x] All acceptance commands pass (typecheck, lint, full test, privacy, `@sessions` e2e).
- [x] Every Service-Wiring row has evidence.
- [x] No `if (codex)` / `if (claudeCode)` branching outside `src/backend/sources/`.
- [x] `SessionSource` signatures honored verbatim; `parse`/`listChildren`/`tail` throw the typed
      `ClaudeCodeNotImplementedError`.
- [x] Codex behavior byte-identical (Codex specs + e2e green, CC isolated in Codex harnesses).
- [x] Acceptance packet committed with current evidence.
