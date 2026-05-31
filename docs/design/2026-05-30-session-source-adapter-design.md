# Session Source Adapter Layer — Design

**Date:** 2026-05-30
**Status:** Approved for planning
**Goal:** Introduce a `SessionSource` adapter seam so Agentview can ingest Claude Code session logs alongside Codex rollouts without `if (codex) … else …` logic leaking across the backend.

## Context

Agentview today is built entirely around Codex rollouts. Exploration of the pipeline shows the architecture is in good shape for this change: **everything already funnels through a normalized model** (`TimelineEvent` + `CachedRolloutFacts` + `SessionSummary` in `src/shared/contracts.ts`), and the **entire frontend** (15 exec renderers, 5 call renderers, timeline rows, all views) plus the **HTTP API** consume only those normalized types. Raw Codex shapes never escape the backend.

The Codex coupling is concentrated in *ingestion*, across three concerns:

1. **Parsing** raw events → normalized — `src/backend/rollout/parseRollout.ts` (~940 lines).
2. **Discovery + metadata** — the deepest divergence: Codex enumerates sessions from a sqlite state DB (`state_5.sqlite` via `src/backend/sqlite/stateStore.ts`) and resolves rollout paths under `$CODEX_HOME` (`src/backend/codexPaths.ts`, `src/backend/api/timeline.ts`).
3. **Live tail** — byte-offset streaming (`src/backend/tail/liveTail.ts`); a shared mechanism with per-format line parsing.

### The Claude Code format (verified against real logs)

Claude Code stores transcripts as JSONL at `~/.claude/projects/<escaped-cwd>/<session-uuid>.jsonl`. Key differences from Codex:

- **No DB. Metadata is in the log.** Title comes from an `ai-title` line; `cwd` / `gitBranch` / `version` / `sessionId` are stamped on every line; token totals are derived by summing `usage` off assistant messages.
- **Anthropic message format.** Line types include `user`, `assistant`, `system`, `summary`, `ai-title`, `attachment`, `mode`, `file-history-snapshot`, `last-prompt`. Messages carry `message.content[]` blocks: `text`, `thinking`, `tool_use`, `tool_result`. Tool calls are `tool_use` blocks in assistant messages; results are `tool_result` blocks in the following `user` message.
- **Sub-agents are explicit on disk** (newer CC). Each sub-agent transcript lives at `<session>/subagents/agent-<id>.jsonl` with a sidecar `agent-<id>.meta.json` of shape `{agentType, description, toolUseId}`. The `toolUseId` links the child file back to the exact `Task` tool_use block in the parent — a **certain** parent→child edge (better than the Codex reconstruction case). Sub-agent lines carry `isSidechain: true`, the parent `sessionId`, and an `agentId`.

This confirms the seam belongs at ingestion, and that the existing normalized model (including `agentLaunches` / `childThreadId` / `parentId` / `+Subs`) maps cleanly onto Claude Code.

## Approach

Chosen: **Approach A — a single `SessionSource` provider interface** that owns the three real divergences (discovery+metadata, resolution, parse) plus live tail, with everything downstream unchanged.

Rejected alternatives:
- **B — Parser-only adapter:** abstracts only `raw → normalized` and leaves discovery/metadata (the *deepest* divergence) un-abstracted, growing branchy logic in `sessions.ts` / `timeline.ts` — the exact mess we want to avoid.
- **C — Normalize-to-disk ETL:** convert both formats into one canonical on-disk system-of-record. Cleanest long-term if multi-tool becomes a core product direction, but far more than adding one source needs now. Approach A can evolve into C later (the parsed-facts cache is already on disk) without rework.

## Architecture

### The interface

```ts
type SourceId = "codex" | "claude-code";

interface ResolvedSession {
  source: SourceId;
  sessionId: string;
  rawLogPath: string;         // absolute path to the primary transcript
  // source-specific extras (e.g. subagents dir for CC) carried opaquely
}

interface SessionSource {
  id: SourceId;
  listSessions(filter: SessionFilter, page: PageOptions): Promise<SessionSummary[]>; // discovery + metadata
  resolveSession(sessionId: string): Promise<ResolvedSession>;                       // locate raw log(s)
  parse(resolved: ResolvedSession): Promise<CachedRolloutFacts>;                     // raw → normalized
  listChildren(sessionId: string): Promise<SessionSummary[]>;                        // spawn subtree for +Subs
  tail(resolved: ResolvedSession, fromByte: number): AsyncIterable<TimelineEvent>;   // live
}
```

### Registry / dispatch

A `registry` holds registered sources and dispatches by `SourceId`. A `MultiSource.listSessions` fans out to all sources and merges results by `updatedAt` for the unified session list. Per the decisions below, sessions are identified by an explicit `(source, id)` composite key.

### File layout

```
src/backend/sources/
  SessionSource.ts          # interface + ResolvedSession, SourceId
  registry.ts               # register + dispatch by (source, id); MultiSource fan-out/merge
  codex/CodexSource.ts      # thin wrapper over EXISTING stateStore + parseRollout + liveTail + codexPaths
  claudeCode/
    ClaudeCodeSource.ts
    discovery.ts            # glob ~/.claude/projects/<escaped-cwd>/*.jsonl + subagents/
    claudeMeta.ts           # title from ai-title; cwd/gitBranch/version from lines; tokenTotal from usage sums
    parseClaudeSession.ts   # Anthropic content-blocks → CachedRolloutFacts
    toolMap.ts              # CC tool block (Bash/Read/Grep/Edit/Task/WebFetch…) → normalized event shape
```

No `if (codex) … else …` exists anywhere outside `src/backend/sources/`.

### Reused vs. new

- **Reused unchanged:** all exec/call renderers, `contracts.ts`, the whole frontend, all API handlers. Because `classifyExecOutput.ts` and `classifyCall.ts` are command/tool-name driven, once `toolMap.ts` maps CC's `Bash` → exec-with-`command`, `Read` → read, `Grep` → search, `Task` → agent-launch, the existing classifiers light up the CC timeline automatically.
- **New work (all inside `ClaudeCodeSource`):** `toolMap.ts` (CC tool-block → normalized), metadata derivation, filesystem discovery, `subagents/` agent-graph wiring.

### Agent graph for Claude Code

`discovery.ts` reads `subagents/*.meta.json` and emits `agentLaunches` keyed by `toolUseId`, plus child `SessionSummary`s with `parentId` and `parentEdgeSource: "native"` (certain). `+Subs` resolves children by walking the `subagents/` directory instead of Codex spawn edges. `agentType` → `agentRole`; `description` → nickname/task.

### Session status inference (CC)

Codex carries explicit status; CC does not. Derive heuristically: a transcript whose file was modified within a recent window and lacks a terminal marker is treated as `running`; otherwise `complete`. (Exact heuristic finalized during implementation; isolated to `claudeMeta.ts`.)

## Contract changes (small, additive, back-compatible)

- Add `source: SourceId` to `SessionSummary`. Absent ⇒ defaults to `"codex"` (back-compat for existing cache/links).
- Generalize `EdgeSource = "codex" | "reconstructed"` → `"native" | "reconstructed"`; the `source` field already says which tool produced a native edge.
- Add `source?: SourceId` to `SessionFilter` to support the merged-list source filter.
- Treat `rolloutPath` as a generic "raw log path" (no rename required).
- No expected changes to `TimelineEventKind` or the `OutputRender` / `CallRender` unions.

## Decisions

1. **Session identity:** explicit `source` field + `(source, id)` composite key threaded through API/routes. Native ids stay **unprefixed**, so existing Codex cache filenames, deep-links, and routing are untouched; missing `source` defaults to `"codex"`.
2. **Session list:** **merged** — one unified list interleaving both tools sorted by recency, with a `source` filter on `SessionFilter`. `MultiSource` fans out and merges.

## Implementation order (each step shippable with green tests)

1. **Extract `SessionSource`, wrap Codex** as `CodexSource` — pure refactor, zero behavior change. *De-risking step; lands before any CC code and is guarded entirely by existing tests.*
2. **Add `source` discriminator + `(source, id)` dispatch**; default `"codex"`; generalize the contract fields above; key routing/cache by source.
3. **CC discovery only** — `ClaudeCodeSource.listSessions` globs `~/.claude/projects` and derives metadata. CC sessions appear in the merged list, filterable; no timeline yet.
4. **CC timeline parse** — `parseClaudeSession` + `toolMap` render one CC session end-to-end through the existing renderers.
5. **CC agent graph** — `subagents/` enumeration → children + certain edges; `agentGraph` and `+Subs` work for CC.
6. **CC live tail** — watch CC files; append-parse via `tail`.

## Configuration

- Codex home stays `CODEX_HOME` (default `~/.codex`).
- Claude Code projects dir defaults to `~/.claude/projects`, overridable via an env var (e.g. `CLAUDE_PROJECTS_DIR`) mirroring the `CODEX_HOME` pattern, for tests and non-default installs.

## Testing & privacy

- **Fixtures:** redacted CC fixtures under `tests/fixtures/claude-code/` — one plain session and one with a sub-agent — plus golden `CachedRolloutFacts`, mirroring the existing Codex parser tests.
- **Step 1 safety:** the Codex extraction is a behavior-preserving refactor, fully guarded by the existing test suite.
- **Redaction inherited:** CC content normalizes into the same previews `src/shared/redaction.ts` masks, so raw CC content never leaves the server — consistent with the existing privacy stance.

## Out of scope

- The Approach C canonical on-disk store / unified cross-tool search.
- Any change to the rendering layer or visual design.
- Writing or mutating Claude Code / Codex logs (Agentview remains read-only over both).
