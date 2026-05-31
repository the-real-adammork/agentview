# Session Source Adapter Layer — Implementation Phases (Overview)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This overview locks the shared contracts; per-phase docs hold the bite-sized tasks.

**Goal:** Introduce a `SessionSource` adapter seam so Agentview ingests Claude Code (CC) session logs alongside Codex rollouts, with all source-specific logic confined to `src/backend/sources/` and the normalized model / renderers / API unchanged.

**Architecture:** Define one `SessionSource` interface that owns the three real divergences (discovery+metadata, raw-log resolution, raw→normalized parse) plus live tail and children. `CodexSource` wraps the existing `StateStore` + rollout parser + live tail with zero behavior change; `ClaudeCodeSource` is the new implementation. A `SourceRegistry` dispatches by `SourceId` and fans out a merged session list. Everything downstream of `CachedRolloutFacts` is untouched.

**Tech Stack:** TypeScript (strict), Node `node:http` backend, React 19 + Vite frontend, Vitest (unit/integration), Playwright (e2e/a11y). Source design doc: `docs/design/2026-05-30-session-source-adapter-design.md`.

---

## Source of Truth: Locked Contracts

All phases MUST use these exact names and signatures. Do not rename. If a phase needs a change here, update this section first.

### Contract additions — `src/shared/contracts.ts`

```ts
export type SourceId = "codex" | "claude-code";

// SessionSummary gains:
//   source: SourceId;            // REQUIRED on new code paths; absent ⇒ treated as "codex" (back-compat)
// SessionFilter gains:
//   source?: SourceId;           // narrows the merged list to one tool
// EdgeSource changes:
//   export type EdgeSource = "native" | "reconstructed";   // was "codex" | "reconstructed"
//   ("native" = edge came from the tool's own data, e.g. Codex thread_spawn_edges OR CC subagent meta;
//    "reconstructed" = inferred by Agentview. The SessionSummary.source field says which tool.)
```

### New interface — `src/backend/sources/SessionSource.ts`

```ts
import type {
  CachedRolloutFacts, PageOptions, SessionFilter, SessionSummary, SourceId,
} from "../../shared/contracts";

export interface SourceHealth {
  source: SourceId;
  available: boolean;
  detail?: string;
}

export interface ResolvedSession {
  source: SourceId;
  sessionId: string;
  rawLogPath: string;                 // absolute path to the primary transcript
  extra?: Record<string, unknown>;    // source-specific, opaque (CC: { subagentsDir })
}

export interface SourceTailResult {
  events: import("../../shared/contracts").TimelineEvent[];
  nextByte: number;
  nextLine: number;
}

export interface SessionSource {
  readonly id: SourceId;
  getHealth(): Promise<SourceHealth>;
  listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSummary | null>;
  resolveSession(sessionId: string): Promise<ResolvedSession>;
  parse(resolved: ResolvedSession): Promise<CachedRolloutFacts>;
  listChildren(rootSessionId: string, scanDepth: number): Promise<SessionSummary[]>;
  tail(resolved: ResolvedSession, fromByte: number): Promise<SourceTailResult>;
  close(): Promise<void>;
}
```

### New registry — `src/backend/sources/registry.ts`

```ts
import type { PageOptions, SessionFilter, SessionSummary, SourceId } from "../../shared/contracts";
import type { SessionSource, SourceHealth } from "./SessionSource";

export interface SourceRegistry {
  get(source: SourceId): SessionSource;            // throws on unknown source
  has(source: SourceId): boolean;
  all(): SessionSource[];
  listSessions(filter?: SessionFilter, page?: PageOptions): Promise<SessionSummary[]>; // fan-out + merge by updatedAtMs desc
  getHealth(): Promise<SourceHealth[]>;
  close(): Promise<void>;
}

export const createSourceRegistry = (sources: SessionSource[]): SourceRegistry => { /* … */ };
```

### Dispatch rule
API handlers read a **`sourceId`** query param (default `"codex"`) and call `registry.get(sourceId)`. Native ids stay **unprefixed**; the `(sourceId, id)` pair is the composite key. For the merged list, omit `filter.source` to fan out across all sources.

> **Wire-param name:** the discriminator travels as `?sourceId=` on the wire, NOT `?source=`. `/api/sessions` already uses `?source=` for `SessionFilter.threadSource` (`"user" | "subagent"`); reusing it would break the thread-source filter. The contract **fields** keep their locked names (`SessionSummary.source`, `SessionFilter.source`); only the query key differs. All phases use `sourceId` on the wire.

## Planning decisions discovered (authoritative — all phases obey)

1. **`sourceId` wire param** (see above). Default `"codex"`; unknown value ⇒ typed 400.
2. **`SourceId` location:** declared inline in `src/backend/sources/SessionSource.ts` in Phase 1 (so Phase 1 touches no contracts), then **relocated** to `src/shared/contracts.ts` in Phase 2 with `SessionSource.ts` importing it. Same exact union — no rename.
3. **Agent-graph rows are richer than `SessionSummary[]`.** `src/backend/api/agentGraph.ts` feeds `deriveAgentGraph` raw `AgentGraphRow[]` from `StateStore.getAgentGraphRows`. The cross-source `SessionSource.listChildren` returns `SessionSummary[]` (used for the merged list + `+SUBS` timeline merge). The `AgentGraphRow`-shaped path stays Codex-internal on `CodexSource` until **Phase 5**, which generalizes the agent-graph builder to accept normalized rows from any source (CC derives them from `subagents/*.meta.json`).
4. **Cache status/warnings:** `SessionSource.parse` returns only `CachedRolloutFacts`. Codex cache-status/warnings remain a handler/cache concern in `timeline.ts`. The CC parser (Phase 4) populates `CachedRolloutFacts.warnings` the same way so the timeline response shape is source-agnostic.
5. **CodexSource lifecycle:** Phase 1 keeps the existing per-request open/close (zero behavior change); Phase 2's registry owns longer-lived instances.
6. **Remaining read consumers** (`timelineRaw.ts`, `tokens.ts`, `diagnostics.ts`) also dispatch by `sourceId`; Phase 2 re-points them alongside timeline/sessions/agentGraph/health/stream (or explicitly records any left Codex-only).
7. **Shared helpers introduced by phases** (use these exact names): `parseSourceId(...)` — wire-param parser, default `"codex"`, typed 400 on unknown (Phase 2); `ClaudeCodeNotImplementedError { code: "CC_NOT_IMPLEMENTED", method, phase }` — thrown by CC's deferred `parse`/`listChildren`/`tail` until their phase lands (Phase 3); `AgentGraphRow` is **relocated** verbatim from `stateStore.ts` to `src/backend/sources/agentGraphRow.ts` and re-exported (Phase 5) so `deriveAgentGraph` stays byte-identical.
8. **CC format specifics confirmed against real logs** (for the CC parser, Phases 3–4): the title line's field is `aiTitle` (not `title`); assistant `message.usage` keys are `input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`; the sub-agent launch tool appears as either `Task` or `Agent` (both → `agent_launch`); `Skill` tool_use → `skill_invoke`; CC `Edit`/`Write`/`MultiEdit` build `DiffOutputRender` directly (CC blocks lack Codex's `*** Begin Patch` envelope that `classifyPatch` requires). Discovery uses dependency-free `node:fs/promises` (no `glob` dependency).

---

## File Structure

```
src/backend/sources/
  SessionSource.ts          # interface + ResolvedSession, SourceHealth, SourceTailResult  (Phase 1)
  registry.ts               # createSourceRegistry, MultiSource fan-out/merge               (Phase 2)
  codex/CodexSource.ts      # wraps StateStore + getRolloutFactsWithCache + tailRolloutFile + codexPaths (Phase 1)
  claudeCode/
    ClaudeCodeSource.ts     # the SessionSource impl                                         (Phase 3–6)
    discovery.ts            # glob ~/.claude/projects/<escaped-cwd>/*.jsonl + subagents/     (Phase 3)
    claudeMeta.ts           # title (ai-title), cwd/gitBranch/version, tokenTotal (usage sums), status (Phase 3)
    parseClaudeSession.ts   # Anthropic content-blocks → CachedRolloutFacts                  (Phase 4)
    toolMap.ts              # CC tool block → normalized event shape for the classifiers     (Phase 4)
    claudePaths.ts          # CLAUDE_PROJECTS_DIR resolution + path guard                     (Phase 3)
```

Modified existing files (cross-phase): `src/shared/contracts.ts`, `src/backend/api/sessions.ts`, `src/backend/api/timeline.ts`, `src/backend/api/health.ts`, `src/backend/api/agentGraph.ts`, `src/backend/api/stream.ts`, `src/backend/server.ts`, `src/backend/live/liveSources.ts`, `src/frontend/api/client.ts`, `src/frontend/views/SessionsView.tsx`.

## Existing anchors the phases wrap (do not rewrite their logic)

- `src/backend/sqlite/stateStore.ts` → `openStateStore({ codexHome })` returns `StateStore` with `getHealth() / listSessions(filter,page) / getThread(id) / getAgentGraphRows(rootId,scanDepth) / close()`.
- `src/backend/cache/rolloutCache.ts` → `getRolloutFactsWithCache(...)` returns `{ facts: CachedRolloutFacts, ... }`.
- `src/backend/rollout/jsonlStream.ts` → `parseRolloutFile(path, options)`, `readJsonlLines(path)`.
- `src/backend/rollout/parseRollout.ts` → `parseRolloutLines(lines, options)`, `ROLLOUT_PARSER_VERSION = 23`.
- `src/backend/tail/liveTail.ts` → `tailRolloutFile({...})` returns `TailRolloutResult`.
- `src/backend/codexPaths.ts` → `resolveCodexHome(...)`, `resolveCodexSourcePath(home, path)`.
- `src/backend/rollout/classifyCall.ts` → `classifyCall(toolName, args, query)`; `classifyExecOutput.ts` → `classifyExecOutput(command, output)`. **Reused as-is by the CC parser.**
- `src/backend/server.ts` registers handlers in order: health, sessions, timeline, timelineRaw, agentGraph, tokens, diagnostics, stream, fixtures.

## Verification commands (per phase)

- `npm run typecheck` — `tsc --noEmit` for both tsconfigs.
- `npm run test -- --run` — Vitest unit + integration.
- `npm run test -- --run <path>` — focused.
- `npm run e2e -- --grep @sessions` / `@timeline` / `@graph-tokens` as relevant. (There is no `@graph`/`@live`/`@stream` tag — the graph view is `@graph-tokens`; CC live tail is covered by the `@timeline` "tail updates" spec.)
- `npm run privacy:check` — redaction guard (raw never leaves server).
- `npm run lint` — eslint, zero warnings.

---

## Phases

| Phase | Title | Boundary | Depends on |
| --- | --- | --- | --- |
| 1 | Codex Source Extraction | Introduce `SessionSource` + `CodexSource` wrapping existing code. **Zero behavior change**, guarded by existing tests. No new source yet. | — |
| 2 | Registry + Source Dispatch | `createSourceRegistry`, add `source` to contracts, route API by `(source,id)`, default `"codex"`. Single registered source still Codex. | 1 |
| 3 | CC Discovery (read-only list) | `ClaudeCodeSource.listSessions/getSession/getHealth` via filesystem glob + metadata derivation. CC sessions appear in merged list, filterable. No timeline. | 2 |
| 4 | CC Timeline Parse | `parseClaudeSession` + `toolMap` → one CC session renders end-to-end through existing renderers. | 3 |
| 5 | CC Agent Graph | `subagents/*.meta.json` → `listChildren` + native spawn edges; `agentGraph` + `+Subs` work for CC. | 4 |
| 6 | CC Live Tail | `ClaudeCodeSource.tail` + watch wiring; CC sessions stream live. | 4 (5 recommended) |

Each phase is independently shippable with green `typecheck` + `test` + relevant `e2e`, and ends with an acceptance packet under `docs/qa/phase-acceptance/2026-05-31-session-source-adapter-phase-<n>.md`.

## Cross-cutting guarantees

- **Privacy:** CC content normalizes into the same previews `src/shared/redaction.ts` masks; raw CC content never leaves the server. `npm run privacy:check` must stay green every phase.
- **Back-compat:** Codex paths keep working unchanged; `source` defaults to `"codex"` wherever absent. Existing Codex e2e specs must stay green every phase.
- **No `if (codex)` outside `src/backend/sources/`.** Source branching lives only in source implementations and the registry.
- **Fixtures:** CC fixtures under `tests/fixtures/claudeProjects.ts` (builder) + `tests/fixtures/claude-code/` (sample redacted transcripts incl. one with a `subagents/` dir), mirroring `tests/fixtures/codexHome.ts`.
