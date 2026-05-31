# Session Source Adapter Phase 4 — CC Timeline Parse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This phase consumes the LOCKED contracts from `docs/plans/2026-05-31-session-source-adapter-implementation-phases.md` — use those names/signatures verbatim; never rename. `sourceId` is the WIRE param; `SessionSource.parse(resolved)` returns `CachedRolloutFacts` and MUST populate `.warnings`.

**Goal:** Make ONE Claude Code (CC) session render end-to-end in the existing timeline UI. Add a CC transcript parser (`parseClaudeSessionLines`) that mirrors the Codex `parseRolloutLines` and emits the *identical* `CachedRolloutFacts` output type, plus a `toolMap` that adapts CC tool blocks into the `(command, output)` / `(toolName, args)` shapes the existing `classifyExecOutput` / `classifyCall` classifiers already understand. Wire `ClaudeCodeSource.parse(resolved)` to read the JSONL with the existing `readJsonlLines` and call the new parser, and dispatch `?sourceId=claude-code` through `timeline.ts` so a CC session draws through the EXISTING renderers with **zero renderer/contract changes**.

**Phase Boundary:** This phase creates `src/backend/sources/claudeCode/parseClaudeSession.ts` + `src/backend/sources/claudeCode/toolMap.ts`, wires `ClaudeCodeSource.parse`, and adds CC dispatch to `src/backend/api/timeline.ts`. It renders a **single primary transcript** only. It does NOT implement the sub-agent graph / `+SUBS` merge (Phase 5) or live tail / watch (Phase 6); it does NOT change any renderer, the normalized model (`TimelineEvent` / `OutputRender` / `CallRender`), the frontend, or the visual layer. `ClaudeCodeSource` (with `listSessions` / `getSession` / `getHealth` / `resolveSession`), `claudeMeta.ts`, `claudePaths.ts`, and `discovery.ts` are assumed to exist from Phase 3; if Phase 3 has not landed, see the Phase-3 Dependency note below.

**Verification:** `npm run typecheck`, `npm run test -- --run`, `npm run test -- --run tests/unit/parseClaudeSession.test.ts tests/unit/claudeToolMap.test.ts`, `npm run lint`, `npm run privacy:check`, `npm run e2e -- --grep @timeline`.

**Smoke-Testable Outcome:** With a temp `CLAUDE_PROJECTS_DIR` fixture containing one redacted CC transcript, opening that session's timeline (`GET /api/timeline?threadId=<cc-session-uuid>&sourceId=claude-code`) returns a `TimelinePayload` whose `events` carry the same `TimelineEventKind`s, `outputRender`s, and `callRender`s a Codex session would — user text → `user_message`, assistant text → `assistant_message`, assistant `thinking` → `reasoning`, a `Bash` call → `tool_call` with an `exec`-classified `outputRender`, a `Read`/`Grep` call → `tool_call` with a read/search `callRender`, an `Edit`/`Write` → a `diff` `outputRender`, an `Agent`/`Task` call → `agent_launch`, and `message.usage` → `token_snapshot`. The Timeline view (`@timeline` Playwright spec) renders those rows with the unchanged renderer components, and `npm run privacy:check` stays green (every CC preview passes through `maskPreviewSecrets`).

**Phase Acceptance:** Vitest unit tests drive `parseClaudeSessionLines` against an inline redacted CC fixture and assert a golden `CachedRolloutFacts` snapshot (mirroring `tests/unit/parseRollout.test.ts`); `npm run e2e -- --grep @timeline` confirms the CC session renders through the real renderers; `npm run privacy:check` confirms no raw CC content escapes. Records `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-4.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks, but the phase owner remains responsible for sequencing, integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Keep the CC parser's OUTPUT identical to `parseRolloutLines`'s: it returns a `CachedRolloutFacts` and MUST populate `.warnings` and `.summary` exactly as the Codex parser does (Planning decision #4).
- Define and freeze `CLAUDE_PARSER_VERSION` before any cache wiring; it is the CC cache-key discriminator (distinct from `ROLLOUT_PARSER_VERSION`).
- Confirm NO renderer, contract, or frontend file is modified — only the four backend files in scope + tests.
- Confirm `npm run privacy:check` stays green every commit (every CC preview routes through `maskPreviewSecrets`; raw CC content never leaves the server).
- Confirm no `if (source === "claude-code")` branch leaks outside `src/backend/sources/` and the registry/dispatch seam already established in Phase 2.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| CC parser core | Task 1 | one sub-agent | Task 2 after the `toolMap` import surface is stubbed | `src/backend/sources/claudeCode/parseClaudeSession.ts` | `npm run test -- --run tests/unit/parseClaudeSession.test.ts` |
| CC tool map | Task 2 | one sub-agent | Task 1 after the `toolMap` signature is fixed | `src/backend/sources/claudeCode/toolMap.ts` | `npm run test -- --run tests/unit/claudeToolMap.test.ts` |
| Source + dispatch wiring | Task 3 | one sub-agent (after Tasks 1–2) | None | `src/backend/sources/claudeCode/ClaudeCodeSource.ts`, `src/backend/api/timeline.ts`, `tests/fixtures/claudeProjects.ts` | `npm run e2e -- --grep @timeline` |
| Privacy + acceptance | Task 4 | phase-owner only | None | acceptance packet, full command set | Full Phase 4 command set + `privacy:check` |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-31-session-source-adapter-phase-4-handoff.md`
- Required contents: current task status, branch/worktree, sub-agent results, verification evidence (typecheck + test + lint + privacy + `@timeline` e2e), the golden-facts snapshot path, service-wiring coverage, acceptance packet status, blockers/escalations, and exact restart instructions.

## Phase-3 Dependency Note

This phase consumes `src/backend/sources/claudeCode/ClaudeCodeSource.ts` (with `id: "claude-code"`, `getHealth`, `listSessions`, `getSession`, `resolveSession` returning `ResolvedSession { source, sessionId, rawLogPath, extra }`), `src/backend/sources/claudeCode/claudePaths.ts` (`CLAUDE_PROJECTS_DIR` resolution + path guard), `src/backend/sources/claudeCode/claudeMeta.ts`, and `src/backend/sources/claudeCode/discovery.ts` from Phase 3 (`docs/plans/2026-05-31-session-source-adapter-phase-3-cc-discovery.md`). It also consumes the Phase-2 dispatch seam (`src/backend/sources/registry.ts`, `src/backend/sources/sourceQuery.ts`, `?sourceId=` on `timeline.ts`). If Phase 3's `ClaudeCodeSource` shell (with a stub `parse` that throws "not implemented") is not present at kickoff, STOP and confirm Phase 3 is landed first — Phase 4 fills in `parse` and adds the timeline dispatch branch; it does not create the source shell or discovery.

## Source of Truth: Locked Inputs (from the overview + Codex anchors — do not rename)

```ts
// Output type is IDENTICAL to the Codex parser. New parser, same shape.
// src/backend/sources/claudeCode/parseClaudeSession.ts
import type { CachedRolloutFacts } from "../../../shared/contracts";

export const CLAUDE_PARSER_VERSION = 1;   // CC cache-key discriminator; bump on parser changes.

export interface ParseClaudeSessionOptions {
  threadId: string;          // the CC session uuid (unprefixed native id)
  rolloutPath: string;       // absolute path to the primary transcript (generic "raw log path")
  sourceMtimeMs: number;
  sourceSizeBytes: number;
  parsedThroughByte?: number;
  startingLine?: number;
}

export const parseClaudeSessionLines = (
  lines: string[],
  options: ParseClaudeSessionOptions,
): CachedRolloutFacts => { /* … */ };
```

Reused **as-is** (do NOT modify):
- `src/backend/rollout/classifyExecOutput.ts` → `classifyExecOutput(command, output)`; `classifyPatch(patchText)`.
- `src/backend/rollout/classifyCall.ts` → `classifyCall(toolName, args, query)`, `fillCallCounts(render, output)`, `fillToolSearch(render, tools)`.
- `src/shared/redaction.ts` → `maskPreviewSecrets(text)`.
- `src/backend/rollout/jsonlStream.ts` → `readJsonlLines(path)` (CC `parse` reuses this exactly as Codex does).
- `src/shared/contracts.ts` → `TimelineEvent`, `TimelineEventKind`, `OutputRender`, `CallRender`, `CachedRolloutFacts`, `CachedToolCall`, `TokenSnapshot`, `TurnSummary`, `AgentLaunchFact`, `RolloutSummary`.

## Ground Truth: Real CC transcript structure (verified against `~/.claude/projects/**/*.jsonl`)

Each JSONL line is one record with a top-level `type` and shared envelope keys: `uuid`, `parentUuid`, `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `isSidechain`, `userType`. Line `type`s observed: `user`, `assistant`, `system`, `summary`, `ai-title`, `attachment`, `mode`, `file-history-snapshot`, `last-prompt`, `worktree-state`, `queue-operation`.

- **`user`** line: `message.role = "user"`, `message.content` is a **string** OR a list of blocks. When the previous assistant turn called tools, the content list carries `tool_result` blocks `{ type: "tool_result", tool_use_id, content }` where `content` is a string OR a list of `{type:"text"|"image"|"tool_reference"}` blocks. The line may also carry a top-level `toolUseResult` object (e.g. `{ commandName, success }`) — supplementary structured metadata.
- **`assistant`** line: `message.role = "assistant"`, `message.content` is a list of blocks of `type`:
  - `text` → `{ type:"text", text }`
  - `thinking` → `{ type:"thinking", thinking, signature }`
  - `tool_use` → `{ type:"tool_use", id, name, input, caller? }`
  - and `message.usage` → `{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, … }`.
- **Tool input shapes** (verified): `Bash{command,description}`, `Read{file_path}`, `Edit{file_path,old_string,new_string,replace_all}`, `Write{file_path,content}`, `MultiEdit{file_path,edits[]}`, `Grep{pattern,path,output_mode}`, `Glob{pattern,path?}`, `WebFetch{url,prompt}`, `WebSearch{query}`, `Agent{description,prompt,subagent_type}` (the real fleet uses **`Agent`**; the spec/overview also names **`Task`** — map BOTH to `agent_launch`).
- **Join key:** `tool_use.id` (assistant) ↔ `tool_result.tool_use_id` (following user). One call → one result, exactly like the Codex `call_id` join.

---

## The Mapping Table (CONCRETE — implement verbatim)

### A. CC line/block → `TimelineEventKind`

| CC source | Condition | → `kind` | preview / fields (all previews via `maskPreviewSecrets`) |
| --- | --- | --- | --- |
| `user` line | `message.content` string, OR list with no `tool_result` block | `user_message` | `previewText` = redacted joined `text` blocks (or the string). `turnId` derived from message DAG (see §C). |
| `assistant` line, `text` block | — | `assistant_message` | `previewText` = redacted block `text`. |
| `assistant` line, `thinking` block | — | `reasoning` | `previewText` = redacted `thinking` (mirrors Codex reasoning-summary handling; never spill the `signature`). |
| `assistant` line, `tool_use` block | `name` ∈ {`Agent`,`Task`} | `agent_launch` | `callId` = `tool_use.id`; `agentRole` = `input.subagent_type`; `agentTaskPreview` = redacted `input.description`/`input.prompt`; `childThreadId` left undefined this phase (Phase 5 wires `subagents/` edges). |
| `assistant` line, `tool_use` block | any other `name` | `tool_call` | `callId` = `tool_use.id`; `toolName` = `name`; fields filled by `toolMap` (see §B). |
| `user` line, `tool_result` block | — | `tool_result` | `callId` = `tool_result.tool_use_id`; `outputPreview`/`fullOutput` = redacted normalized result text (see §B "result text"). Joined onto its `tool_call` in `deriveFacts`. |
| `assistant` line | `message.usage` present and non-zero | `token_snapshot` | one extra synthesized event per assistant line; `tokenSnapshot` mapped from `usage` (see §D). |
| `system`/`summary`/`ai-title`/`attachment`/`mode`/`file-history-snapshot`/`last-prompt`/`worktree-state`/`queue-operation` lines | — | *(skipped — not a timeline event)* | Not emitted. These are metadata (Phase 3 owns title/meta). No `warning` is pushed for these known non-event lines. |
| any line | JSON parse failure | `parse_error` | `previewText` = redacted error message; push `line N: …` into `.warnings` (identical to Codex). |
| `assistant`/`user` line | role present but no recognizable content | `warning` | redacted preview; push an `unknown CC line` warning (only for genuinely unrecognized shapes, NOT the known metadata types above). |

### B. CC `tool_use` (by `name`) → normalized render inputs (`toolMap.ts`)

`toolMap` returns, for a given `tool_use` block + its joined `tool_result`, the normalized fields the existing classifiers/renderers consume. The parser sets these on the `tool_call` event (and carries `fullOutput` for `classifyExecOutput` at join time).

| CC `name` | normalize to | `commandPreview` / args | result handling | classifier used | resulting render |
| --- | --- | --- | --- | --- | --- |
| `Bash` | exec | `commandPreview` = redacted `input.command` | result text = normalized `tool_result.content` | `classifyExecOutput(command, output)` at join | `OutputRender` (diff/tests/status/table/file/matches/http/git/… or none → plain) |
| `Read` | read CallRender | args `{ file_path }` → `classifyCall("read", {path:file_path}, undefined)` | result text → `fillCallCounts` fills `totalLines` | `classifyCall` (read branch) | `ReadCallRender { kind:"read", path }` |
| `Grep` | search CallRender | args `{ pattern, path }` → `classifyCall("grep", {pattern,path}, pattern)` | result text → `fillCallCounts` fills `hits` | `classifyCall` (search branch) | `SearchCallRender { kind:"search_call", pattern, path }` |
| `Glob` | search CallRender | args `{ pattern, path }` → `classifyCall("search_files", {pattern,path}, pattern)` | — | `classifyCall` (search branch) | `SearchCallRender` |
| `Edit` / `MultiEdit` | diff OutputRender | build unified `DiffOutputRender` **directly** from `old_string`→del / `new_string`→add (one `DiffFile` per `file_path`; `MultiEdit` → one file, N hunks from `edits[]`) | result text ignored for render | **constructed in `toolMap`** (NOT `classifyPatch` — see deviation note) | `DiffOutputRender { kind:"diff", files:[{path:file_path,…}] }` |
| `Write` | diff OutputRender | build `DiffOutputRender` with every `input.content` line as an `add` (path = `file_path`) | result text ignored for render | constructed in `toolMap` | `DiffOutputRender` (all adds) |
| `WebFetch` | fetch CallRender | args `{ url }` → `classifyCall("web_fetch", {url}, undefined)` | result text → `fillCallCounts` (status) | `classifyCall` (fetch branch) | `FetchCallRender { kind:"fetch", mode:"fetch", url }` |
| `WebSearch` | fetch CallRender | args `{ query }` → `classifyCall("web_search", {}, query)` | result text → `fillCallCounts` (results) | `classifyCall` (fetch branch) | `FetchCallRender { kind:"fetch", mode:"search", query }` |
| `Agent` / `Task` | agent_launch (NOT a tool_call) | handled in §A as `agent_launch`; `toolMap` returns `{ agentRole: input.subagent_type, agentTaskPreview: redact(input.description ?? input.prompt) }` | — | none (first-class event) | — |
| `ToolSearch` | tool_search CallRender | `classifyCall("tool_search", {limit}, query)` then `fillToolSearch` from result tree if present | result tree (if any) → `fillToolSearch` | `classifyCall` + `fillToolSearch` | `ToolSearchCallRender` |
| `Skill` (CC `tool_use` name) | skill_invoke | `kind="skill_invoke"`; `skillName` = `input.skill`/`input.name`/`input.command` | result text → `skillStatus` ok/fail | none (first-class) | — |
| **any other** `name` (`StructuredOutput`, `TaskCreate`, `AskUserQuestion`, `Monitor`, `EnterWorktree`, `SendUserFile`, …) | generic tool_call | `toolName` = `name`; `argumentsPreview` = redacted `input`; result text = `outputPreview`/`fullOutput`; **still call `classifyExecOutput(undefined, output)`** so a recognizable output (e.g. JSON) renders | `classifyCall` (returns undefined) + `classifyExecOutput` | generic `tool_call` row; `outputRender` if output self-identifies, else plain |

**Result text normalization (shared helper in `toolMap`):** `tool_result.content` may be a string or a list of blocks. Normalize to a single string: if string, use it; if list, join the `text` of each `{type:"text"}` block (skip `image`/`tool_reference` blocks, but note their presence). Then redact with `maskPreviewSecrets` and bound to the same `CLASSIFY_OUTPUT_CAP` (128 KiB) the Codex parser uses for `fullOutput`. The top-level `toolUseResult` (e.g. `{commandName,success}`) is supplementary — if `content` is empty but `toolUseResult.success === false`, surface a "command failed" preview; do not parse it for renders.

### C. Turns from the `parentUuid` / message DAG

CC has no `turn_id`. Reconstruct a `turnId` per **user→assistant exchange**: assign a turn id at each top-level `user` message (e.g. `turn-<user-uuid>`); every assistant line whose `parentUuid` chains back (directly or transitively) to that user message — and the `tool_result` user lines in between — inherit that `turnId`. Build the chain by indexing lines by `uuid` and walking `parentUuid` to the nearest enclosing top-level user message. Emit `turns[]` exactly as Codex's `deriveFacts` does (start/complete timestamps, last assistant message preview, token totals from the turn's last `token_snapshot`). A line whose `parentUuid` is unresolved gets no `turnId` (still emitted as an event, just unbucketed) — never throw.

### D. `message.usage` → `TokenSnapshot`

| CC `usage` field | → `TokenSnapshot` field |
| --- | --- |
| `input_tokens` | `input` |
| `output_tokens` | `output` |
| `cache_read_input_tokens` | `cachedInput` |
| `cache_creation_input_tokens` | folded into `input` accounting (added to `input`, matching how cache-creation counts against the prompt) |
| derived | `total` = `input + output + cachedInput` (+ cache_creation already in input) |
| `timestamp` (line) | `timestamp` |

Skip emitting a `token_snapshot` when all counts are zero/absent (mirrors Codex's empty-usage guard). `previewText` mirrors Codex: `tokens total=… input=… output=… cached=…`.

---

## File Map

- Create: `src/backend/sources/claudeCode/parseClaudeSession.ts` — `parseClaudeSessionLines(lines, options): CachedRolloutFacts` + `CLAUDE_PARSER_VERSION`. Owns §A line/block classification, §C turn reconstruction, §D usage mapping, the call↔result join (reusing the `deriveFacts` shape), and `.warnings`/`.summary` population. Imports `toolMap` for per-tool render inputs and `maskPreviewSecrets` for every preview.
- Create: `src/backend/sources/claudeCode/toolMap.ts` — `mapClaudeTool(block, result)` implementing §B: returns `{ kind, toolName, commandPreview?, argumentsPreview?, callRender?, outputRenderInput?, fullOutput?, agentRole?, agentTaskPreview?, skillName? }` for the parser to apply. Constructs `DiffOutputRender` for `Edit`/`Write`/`MultiEdit`; delegates classification to `classifyExecOutput`/`classifyCall` for the rest; includes the result-text normalization helper.
- Modify: `src/backend/sources/claudeCode/ClaudeCodeSource.ts` — implement `parse(resolved)`: `readJsonlLines(resolved.rawLogPath)` → `parseClaudeSessionLines(lines, { threadId: resolved.sessionId, rolloutPath: resolved.rawLogPath, sourceMtimeMs, sourceSizeBytes })`. Replace the Phase-3 "not implemented" stub. (Caching/cache-status stays a `timeline.ts` concern per Planning decision #4.)
- Modify: `src/backend/api/timeline.ts` — dispatch by `sourceId` (default `"codex"`, via the Phase-2 `parseSourceId`). For `sourceId === "claude-code"`: resolve via `registry.get("claude-code").getSession` + `.resolveSession`, then `getRolloutFactsWithCache({ … parse: () => source.parse(resolved) })`, keyed by `CLAUDE_PARSER_VERSION`. The Codex path is unchanged. The `subtree` (`+SUBS`) branch returns the single transcript for CC this phase (no descendant merge — Phase 5).
- Create: `tests/fixtures/claudeProjects.ts` — temp `CLAUDE_PROJECTS_DIR` builder mirroring `tests/fixtures/codexHome.ts`: writes a redacted CC transcript under `<escaped-cwd>/<session-uuid>.jsonl` and returns the root + session id. Provide a small reusable `claudeLine(...)` helper.
- Create: `tests/fixtures/claude-code/plain-session.jsonl` — one small, hand-redacted CC transcript (user text, assistant text + thinking, a `Bash` call+result, a `Read` call+result, an `Edit`, an `Agent` launch, and an assistant `usage`).
- Test: `tests/unit/parseClaudeSession.test.ts` — golden `CachedRolloutFacts` snapshot + per-kind assertions (mirrors `tests/unit/parseRollout.test.ts`).
- Test: `tests/unit/claudeToolMap.test.ts` — per-tool mapping/classification, reusing `classifyExecOutput`/`classifyCall` expectations.
- Test: `tests/integration/claudeTimeline.test.ts` — `GET /api/timeline?threadId=<uuid>&sourceId=claude-code` against the temp fixture returns a CC `TimelinePayload`.
- Test: `tests/e2e/timeline-detail.spec.ts` (extend) — a `@timeline` case that selects the CC fixture session and asserts the rows render through the existing renderers.
- Test: `tests/privacy/privacyPreviews.test.ts` (extend) — assert a CC transcript carrying a fake secret yields `[REDACTED]` in every preview field.
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-4.md` — acceptance evidence packet.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| CC line → normalized events | Timeline rows | `parseClaudeSessionLines` | rollout cache (CC, keyed by `CLAUDE_PARSER_VERSION`) | None | CC JSONL (temp `CLAUDE_PROJECTS_DIR`) | Unit golden-facts snapshot: kinds/previews/turns match the table. |
| CC tool render parity | Exec/call renderer cells | `mapClaudeTool` + reused `classifyExecOutput`/`classifyCall` | rollout cache (CC) | None | CC JSONL | Unit: `Bash`→`outputRender`, `Read`/`Grep`→`callRender`, `Edit`/`Write`→`diff`, `Agent`→`agent_launch`. |
| CC timeline dispatch | Timeline view via `?sourceId=claude-code` | `timeline.ts` → `ClaudeCodeSource.parse` | rollout cache (CC) | None | temp `CLAUDE_PROJECTS_DIR` | Integration: `TimelinePayload` for the CC session; Codex timeline unchanged. |
| CC end-to-end render | Browser Timeline | browser → `/api/timeline?sourceId=claude-code` → CC parse | rollout cache (CC) | None | Playwright + temp CC fixture | `@timeline` e2e: CC rows draw through existing renderers. |
| CC redaction | All CC previews | `maskPreviewSecrets` in parser + `toolMap` | rollout cache (CC) | None | CC JSONL with a planted secret | `privacy:check` green; CC preview shows `[REDACTED]`. |

## E2E Harness Readiness

Reuse the existing `@timeline` Playwright spec (`tests/e2e/timeline-detail.spec.ts`) and add a CC arm: stand up a temp `CLAUDE_PROJECTS_DIR` (via `tests/fixtures/claudeProjects.ts`) containing the redacted `plain-session.jsonl`, pass `CLAUDE_PROJECTS_DIR` through the Playwright web-server env alongside the existing `CODEX_HOME`, navigate to the CC session, and assert the timeline rows render. The existing Codex `@timeline` case must stay green unchanged (dispatch defaults to `"codex"`).

---

### Task 1 (T1): `parseClaudeSession` message/text/reasoning/usage mapping + golden facts test

**Depends On:** Phase 3 acceptance (ClaudeCodeSource shell + discovery + claudePaths present)

**Execution:** sub-agent lane: CC parser core; parallel with Task 2 after the `mapClaudeTool` signature is fixed; checkpoint `npm run test -- --run tests/unit/parseClaudeSession.test.ts`

**Files:**
- Create: `src/backend/sources/claudeCode/parseClaudeSession.ts`
- Create: `tests/fixtures/claude-code/plain-session.jsonl`
- Test: `tests/unit/parseClaudeSession.test.ts`

**Service Wiring Rows Covered:**
- CC line → normalized events

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/parseClaudeSession.test.ts && npm run typecheck`
- Expected result: the CC fixture parses to a `CachedRolloutFacts` whose `events` kinds are `[user_message, reasoning, assistant_message, tool_call, tool_result, token_snapshot, agent_launch, …]` per §A; `turns[]` reconstructed from the message DAG; `warnings` empty for the all-known-types fixture; `parserVersion === CLAUDE_PARSER_VERSION`.
- Evidence to collect: focused test output + the golden-facts snapshot diff.

**Test Mode Disclosure:**
- Automated tests: hand-redacted local CC JSONL fixture
- Production/dev path exercised: yes — the real `parseClaudeSessionLines` used by `ClaudeCodeSource.parse`
- Mock-only risk: private CC format drift vs. the small fixture (mitigated by grounding the table on real `~/.claude/projects` transcripts)
- Required real dependencies: none (pure parse of a checked-in fixture)
- Blocking if unavailable: no

- [ ] Step 1: Write `tests/fixtures/claude-code/plain-session.jsonl` (hand-authored, redacted): a `user` line (string content), an `assistant` line with a `thinking` block + a `text` block + `message.usage`, an `assistant` line with a `Bash` `tool_use`, the following `user` line with the matching `tool_result`, a `Read` call+result, an `Edit` call, and an `Agent` `tool_use`. Plant one fake `API_KEY=...` to prove redaction. Keep it under ~20 lines.
- [ ] Step 2: Write a failing `tests/unit/parseClaudeSession.test.ts` mirroring `tests/unit/parseRollout.test.ts` (load via specifier, parse the fixture, assert against a golden `CachedRolloutFacts`). Assert: the kind sequence; `previewText` redaction (`[REDACTED]` present, raw key absent); `reasoning` never contains the `signature`; `token_snapshot.tokenSnapshot.input/output/cachedInput`; a `turnId` is shared across the user→assistant→tool_result chain; `parserVersion === CLAUDE_PARSER_VERSION`. Run and confirm failure (module missing).
- [ ] Step 3: Implement `src/backend/sources/claudeCode/parseClaudeSession.ts`: `CLAUDE_PARSER_VERSION = 1`; `parseClaudeSessionLines(lines, options)` mirroring `parseRolloutLines` — JSON-parse each line (push `parse_error` + warning on failure), classify per §A, synthesize a `token_snapshot` event from `message.usage` per §D, reconstruct `turnId` per §C, call `mapClaudeTool` for `tool_use` blocks, run the `deriveFacts`-style call↔result join (by `tool_use.id`↔`tool_use_id`), run `classifyExecOutput`/`fillCallCounts`/`fillToolSearch` at join time, strip `fullOutput`/`fullArguments` before returning, and assemble `summary` + `warnings`. Every preview goes through `maskPreviewSecrets`.
- [ ] Step 4: Run `npm run test -- --run tests/unit/parseClaudeSession.test.ts && npm run typecheck && npm run lint` and confirm green.
- [ ] Step 5: Commit this task. Suggested message: `feat(sources): add CC transcript parser (parseClaudeSessionLines)`

### Task 2 (T2): `toolMap` tool_use/tool_result join + per-tool classification tests

**Depends On:** Task 1 (shares the `mapClaudeTool` signature; may run in parallel once frozen)

**Execution:** sub-agent lane: CC tool map; parallel with Task 1 after the signature is fixed; checkpoint `npm run test -- --run tests/unit/claudeToolMap.test.ts`

**Files:**
- Create: `src/backend/sources/claudeCode/toolMap.ts`
- Test: `tests/unit/claudeToolMap.test.ts`

**Service Wiring Rows Covered:**
- CC tool render parity

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/claudeToolMap.test.ts && npm run typecheck`
- Expected result: each tool maps per §B — `Bash`+result → `classifyExecOutput` yields the expected `OutputRender`; `Read` → `ReadCallRender`; `Grep`/`Glob` → `SearchCallRender`; `Edit`/`Write`/`MultiEdit` → `DiffOutputRender` (built directly); `WebFetch`/`WebSearch` → `FetchCallRender`; `Agent`/`Task` → `agent_launch` fields; unknown tool → generic `tool_call` with redacted arg/output previews and `classifyExecOutput(undefined, output)` still attempted.
- Evidence to collect: focused test output, including a redaction assertion on a planted secret in `Bash` output.

**Test Mode Disclosure:**
- Automated tests: inline CC tool blocks + joined results (no filesystem)
- Production/dev path exercised: yes — the real `mapClaudeTool` + the reused classifiers
- Mock-only risk: CC tools not in the table fall to the generic branch (intended); new tools just need a row later
- Required real dependencies: none (pure unit)
- Blocking if unavailable: no

- [ ] Step 1: Write failing `tests/unit/claudeToolMap.test.ts` with one case per §B row, feeding a `tool_use` block + its joined `tool_result` and asserting the normalized output. Include: a `Bash` whose output is a `git diff` (→ `diff` `OutputRender` via `classifyExecOutput`); a `Read` (→ `read` `callRender`); a `Grep` (→ `search_call`); an `Edit` (→ `diff` from `old_string`/`new_string`); a `Write` (→ all-adds `diff`); a `WebSearch` (→ `fetch` search); an `Agent` (→ `agent_launch` fields); a `tool_result.content` given as a **list of text blocks** (assert join + redaction); an unknown `Zzz` tool (→ generic `tool_call`). Run and confirm failure.
- [ ] Step 2: Implement `src/backend/sources/claudeCode/toolMap.ts`: the result-text normalizer (string | block-list → redacted, capped string per §B), the per-name `switch`, the direct `DiffOutputRender` builder for `Edit`/`MultiEdit` (del=`old_string` lines, add=`new_string` lines) and `Write` (all adds), and delegation to `classifyCall`/`classifyExecOutput` for the rest. Return the normalized shape the parser applies. Do NOT route `Edit`/`Write` through `classifyPatch` (see deviation note).
- [ ] Step 3: Run `npm run test -- --run tests/unit/claudeToolMap.test.ts && npm run typecheck && npm run lint` and confirm green.
- [ ] Step 4: Commit this task. Suggested message: `feat(sources): map CC tool blocks to normalized render inputs`

### Task 3 (T3): Wire `ClaudeCodeSource.parse` + timeline dispatch + `@timeline` e2e

**Depends On:** Task 1, Task 2

**Execution:** sub-agent lane: Source + dispatch wiring; parallel with none; checkpoint `npm run test -- --run tests/integration/claudeTimeline.test.ts && npm run e2e -- --grep @timeline`

**Files:**
- Modify: `src/backend/sources/claudeCode/ClaudeCodeSource.ts`, `src/backend/api/timeline.ts`
- Create: `tests/fixtures/claudeProjects.ts`
- Test: `tests/integration/claudeTimeline.test.ts`, `tests/e2e/timeline-detail.spec.ts` (extend)

**Service Wiring Rows Covered:**
- CC timeline dispatch
- CC end-to-end render

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/integration/claudeTimeline.test.ts && npm run typecheck && npm run e2e -- --grep @timeline`
- Expected result: `GET /api/timeline?threadId=<uuid>&sourceId=claude-code` returns a `TimelinePayload` whose events render through the existing renderers; the Codex `@timeline` case is unchanged; the CC `@timeline` arm passes.
- Evidence to collect: integration output, Playwright trace/screenshot of the CC timeline.

**Test Mode Disclosure:**
- Automated tests: real local API against a temp `CLAUDE_PROJECTS_DIR` fixture + Playwright
- Production/dev path exercised: yes — browser → `/api/timeline?sourceId=claude-code` → registry → `ClaudeCodeSource.parse` → rollout cache
- Mock-only risk: CC `subtree` (`+SUBS`) returns single transcript this phase (Phase 5 merges descendants) — documented, not a regression
- Required real dependencies: temp filesystem, Playwright runtime
- Blocking if unavailable: yes

- [ ] Step 1: Create `tests/fixtures/claudeProjects.ts` mirroring `tests/fixtures/codexHome.ts`: write the redacted transcript under `<root>/<escaped-cwd>/<session-uuid>.jsonl`, return `{ root, sessionId, cwd }`, and expose a `claudeLine(...)` helper. Write a failing `tests/integration/claudeTimeline.test.ts` (mirror the existing timeline integration harness) hitting `/api/timeline?threadId=<uuid>&sourceId=claude-code` with `CLAUDE_PROJECTS_DIR` pointed at the fixture. Run and confirm failure (parse stub / no dispatch).
- [ ] Step 2: Implement `ClaudeCodeSource.parse(resolved)`: `readJsonlLines(resolved.rawLogPath)` + `stat` for mtime/size → `parseClaudeSessionLines(lines, { threadId: resolved.sessionId, rolloutPath: resolved.rawLogPath, sourceMtimeMs, sourceSizeBytes })`. Replace the Phase-3 stub.
- [ ] Step 3: Add CC dispatch to `src/backend/api/timeline.ts`: branch on the parsed `sourceId`. For `"claude-code"`: `registry.get("claude-code").getSession(threadId)` → 404 if absent; `.resolveSession(threadId)` → `getRolloutFactsWithCache({ threadId, rolloutPath: resolved.rawLogPath, parse: () => source.parse(resolved), parserVersion: CLAUDE_PARSER_VERSION })`; return the same `TimelinePayload` shape. Keep the Codex branch byte-for-byte. CC `subtree` returns the single transcript (no descendant walk this phase). Preserve the existing error mapping (404/400/503/500).
- [ ] Step 4: Extend `tests/e2e/timeline-detail.spec.ts` with a `@timeline` CC case: temp `CLAUDE_PROJECTS_DIR` in the Playwright web-server env, navigate to the CC session, assert at least one exec/call/diff renderer row is present (the rows draw through the unchanged components).
- [ ] Step 5: Run `npm run test -- --run tests/integration/claudeTimeline.test.ts && npm run typecheck && npm run lint && npm run e2e -- --grep @timeline` and confirm green.
- [ ] Step 6: Commit this task. Suggested message: `feat(api): render CC sessions via timeline dispatch (sourceId=claude-code)`

### Task 4 (T4): Privacy/redaction verification + Phase 4 acceptance packet

**Depends On:** Task 1, Task 2, Task 3

**Execution:** phase-owner only; parallel with none; checkpoint full Phase 4 command set + `privacy:check`

**Files:**
- Modify: `tests/privacy/privacyPreviews.test.ts` (extend with a CC case)
- Create: `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-4.md`
- Modify: any Phase 4 files needed for integration fixes

**Service Wiring Rows Covered:**
- CC redaction
- All rows (acceptance roll-up)

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run lint && npm run privacy:check && npm run e2e -- --grep @timeline`
- Expected result: CC parse + render + redaction all green; a CC transcript carrying a planted secret yields `[REDACTED]` in every preview field; Codex suites unchanged.
- Evidence to collect: full command output, `@timeline` artifacts, the privacy assertion output, golden-facts snapshot path.

**Test Mode Disclosure:**
- Automated tests: real local API + Playwright + the privacy guard against a planted-secret CC fixture
- Production/dev path exercised: yes — browser → API → CC parse → previews
- Mock-only risk: optional real `~/.claude/projects` validation may be skipped if local data is unavailable
- Required real dependencies: temp filesystem, Playwright runtime
- Blocking if unavailable: yes, except optional private real-data validation

- [ ] Step 1: Extend `tests/privacy/privacyPreviews.test.ts` with a CC transcript (planted `API_KEY=...`, a credentialed URL, a `<base_instructions>` block) and assert every emitted `previewText`/`argumentsPreview`/`outputPreview`/`commandPreview`/`rawPreview` contains `[REDACTED]` and never the raw secret. Run `npm run privacy:check` and confirm green.
- [ ] Step 2: Create the acceptance packet with a Service Wiring table row per matrix flow and a Commits table (Tasks 1–4).
- [ ] Step 3: Run the full command set and confirm any integration failures.
- [ ] Step 4: Apply final integration fixes within Phase 4 scope.
- [ ] Step 5: Rerun the full command set and record evidence (artifact paths, golden-facts snapshot, privacy assertion, `@timeline` trace) into the packet.
- [ ] Step 6: Commit this task. Suggested message: `docs: record session-source-adapter phase 4 acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: `parseClaudeSession.ts`, `toolMap.ts`, `ClaudeCodeSource.parse`, and the `timeline.ts` CC branch compile across both tsconfigs; no renderer/contract change.
- Run: `npm run test -- --run`
  Expected: unit + integration pass, including `parseClaudeSession` (golden facts), `claudeToolMap`, `claudeTimeline`, and the unchanged Codex suites.
- Run: `npm run lint`
  Expected: zero warnings.
- Run: `npm run privacy:check`
  Expected: redaction guard green — every CC preview routes through `maskPreviewSecrets`; raw CC content never leaves the server.
- Run: `npm run e2e -- --grep @timeline`
  Expected: the CC fixture session renders through the existing renderers; the Codex `@timeline` case is unchanged.

**Required Service Wiring Coverage:**
- CC line → normalized events — unit golden-facts snapshot covers the §A kind/preview/turn mapping.
- CC tool render parity — unit covers `Bash`→`outputRender`, `Read`/`Grep`/`Glob`→`callRender`, `Edit`/`Write`/`MultiEdit`→`diff`, `Agent`/`Task`→`agent_launch`, unknown→generic.
- CC timeline dispatch — integration covers `?sourceId=claude-code` returning a `TimelinePayload` with Codex parity preserved.
- CC end-to-end render — `@timeline` e2e covers the CC session drawing through the unchanged renderer components.
- CC redaction — `privacy:check` covers a planted-secret CC transcript yielding `[REDACTED]` in every preview.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-4.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every applicable service-wiring row has evidence, the golden `CachedRolloutFacts` snapshot is committed, `CLAUDE_PARSER_VERSION` is defined and used as the CC cache key, no renderer/contract/frontend file is modified, `privacy:check` is green, and the acceptance packet exists with current commit evidence.

## Deviations from the Locked Overview (with rationale)

1. **`Edit`/`Write`/`MultiEdit` build `DiffOutputRender` directly in `toolMap` — they do NOT reuse `classifyPatch`.** The spec/overview suggested "reuse `classifyPatch` if applicable." Verified: `classifyPatch` (`src/backend/rollout/classifyExecOutput.ts:224`) hard-requires the Codex `*** Begin Patch` envelope (`if (!patchText || !/\*\*\* Begin Patch/.test(patchText)) return undefined;`). CC `Edit`/`Write` blocks carry `old_string`/`new_string`/`content` — never that envelope — so `classifyPatch` would always return `undefined`. The mapping therefore constructs the `DiffOutputRender` (the same contract type the diff renderer consumes) directly from the CC fields. No renderer/contract change; the *output* type is identical. "If applicable" is satisfied by it not being applicable.
2. **`Agent` (real fleet) is mapped alongside `Task` (spec name) → `agent_launch`.** Real `~/.claude/projects` transcripts use `name: "Agent"` (`{description,prompt,subagent_type}`); the spec/overview name the block `Task`. To match both real data and the locked spec, `toolMap` routes `Agent` AND `Task` to `agent_launch`. No contract change.
3. **`Skill` is recognized as a first-class `skill_invoke`** (real CC `tool_use` name `Skill{skill}`), mirroring the Codex parser's existing `skill_invoke` kind. This is additive within the existing `TimelineEventKind` union (no contract change) and keeps the Skills tab parity with Codex.

These are the only deviations; everything else follows the locked overview and the Codex parser pattern verbatim (identical `CachedRolloutFacts` output, `.warnings` populated, `sourceId` wire param, dispatch through the Phase-2 registry).
