# Supervisor → Orchestrator Relationship Reconstruction

**Date:** 2026-05-28
**Status:** Design — pending review
**Author:** Adam Mork (with Claude)

## Problem

codex cannot model 3-layer agent graphs. To work around this, a **supervisor**
session spawns an **orchestrator** session via `tmux` (a shell process launch),
and the orchestrator then spawns its own subagents through codex's normal
mechanism. The result in the dashboard:

- Both supervisor and orchestrator exist as threads in `~/.codex/state_5.sqlite`
  (each is a codex process pointing at the same `CODEX_HOME`).
- The orchestrator's own subagents are linked correctly via codex's
  `thread_spawn_edges` (a normal 2-layer graph).
- **But the supervisor → orchestrator edge is missing.** That spawn happened via
  `tmux`, entirely outside codex's spawn-edge model, so codex writes no edge. The
  orchestrator appears as an independent root (`thread_source = "user"`,
  `parent_thread_id = null`).

There is no automatic fallback signal in the data model: the `threads` schema and
`SessionSummary` carry **no** `pid`/`ppid`/tmux fields (confirmed in
`src/shared/contracts.ts` and `src/backend/sqlite/stateStore.ts`). Process-lineage
inference is impossible.

We are only missing **one edge** — not data. Both sessions are present; we need to
reconstruct the link between them.

## Goal

Reconstruct supervisor → orchestrator edges and surface them in the dashboard's
existing tree/graph machinery (`parentId`, `rootOf`, `flattenAgentTree`,
`AgentGraphView`, sessions-list grouping) for **both** newly-spawned runs and
**historical** runs already on disk.

Non-goals: spawning/orchestrating codex processes, writing to codex's database,
recovering arbitrary tmux process lineage.

## Decisions (locked during brainstorming)

1. **Correlation:** a **prompt marker** for new runs (exact, high-precision) plus a
   **signature heuristic** for historical backfill.
2. **Storage:** a **synthetic-edge overlay** owned by agentview. We never write to
   codex's `state_5.sqlite`. Read-only safety + survives codex DB resets.

## Key insight: the run id is a two-sided correlation key

The orchestrator's first prompt (stored in the `first_user_message` column) looks
like:

```
Use the implementation-execution skill as the phase orchestrator for <PHASE>.
Run state: docs/implementation-runs/<RUN_ID>/run.yaml.
Phase state: docs/implementation-runs/<RUN_ID>/phases/<PHASE>.yaml.
```

The **supervisor** that set up the run references the same
`docs/implementation-runs/<RUN_ID>/` path, and its first messages invoke the
`$implementation-execution` skill. So in the common case we can match
run-id-to-run-id and positively classify both endpoints using **SQLite columns
alone** — no transcript reads — and only escalate to file reads when the cheap
match misses.

## Classifiers

Derived per thread, cheapest source first (`first_user_message`, `preview`;
escalate to transcript scan only when noted):

| Signal | Rule | Source |
| --- | --- | --- |
| `isOrchestrator` + `phase` | `/as the phase orchestrator for\s+(\S+)/` | `first_user_message` |
| `isSupervisor` | contains `$implementation-execution` **and** not an orchestrator | first N user messages (column first; transcript fallback) |
| `runId` | `/docs\/implementation-runs\/([^/]+)\//` | `first_user_message` / `preview` |
| `markerParentId` | `/\[av-parent:([0-9a-f-]+)\]/` | `first_user_message` |

Notes:
- `$implementation-execution` is the **primary positive classifier** for a
  supervisor. If it isn't the literal first message, the db check misses and we
  fall back to scanning the first N user messages of the rollout JSONL.
- The marker (`[av-parent:<id>]`) is the forward-looking, exact path; it is
  stripped from the displayed preview so it doesn't clutter the UI.

## Linking heuristic (tiered, scored)

For each detected orchestrator (orphan root, `parentId == null`,
`isOrchestrator`), choose its supervisor by the first tier that hits:

| Tier | Rule | Confidence | `via` |
| --- | --- | --- | --- |
| 0 | `markerParentId` present → parent id is explicit | **certain** | `marker` |
| 1 | A **classified supervisor** referencing the **same `runId`**, **same cwd**, whose active window `[createdAt, updatedAt]` contains the orchestrator's `createdAt` | **high** | `run-id` |
| 2 | As tier 1 but active window does not contain spawn time (run id + cwd only) | **medium** | `run-id` |
| 3 | No db run-id match → **transcript scan**: user-root whose rollout JSONL references `docs/implementation-runs/<runId>/` | **medium** | `run-id` |
| 4 | Nothing references the run id → nearest preceding user-root in the **same cwd** | **low** | `cwd-time` |
| — | No candidate → **leave orphan, draw no edge** (never fabricate) | — | — |

**Tie-breakers within a tier:** prefer the candidate with the **earliest
`createdAt`** (the run originator) and the **most run-id references** (the
long-lived supervisor that spawned multiple phase orchestrators).

All phase-N orchestrators of one run share a run id and resolve to the same
supervisor, yielding the full 3-layer tree (supervisor → orchestrators → their
subagents) for free.

## Architecture

New backend module(s), composed into the existing read path:

1. **Classifier** (`src/backend/relationships/classify.ts`, name TBD during
   planning) — pure functions over a thread's text fields returning the signals
   table above. Unit-testable in isolation; no I/O.
2. **Linker** (`src/backend/relationships/link.ts`) — given the full set of
   classified threads (and a transcript-reader dependency for tiers 3–4),
   produces synthetic edges `{ parentId, childId, confidence, via, runId, phase }`.
   Tiers 0–2 are pure over the in-memory thread set; tiers 3–4 take an injected
   reader so they stay testable.
3. **Overlay store** — agentview-owned persistence for derived edges, separate
   from codex's DB. Merged into the existing graph/summary build alongside real
   `thread_spawn_edges`. (Exact store mechanism — table in an agentview-owned
   SQLite file vs. on-the-fly derivation cached in memory — decided in the plan.)

### Data flow

```
state_5.sqlite (read-only)
        │  threads + thread_spawn_edges
        ▼
   classify()  ──▶ per-thread signals
        ▼
    link()     ──▶ synthetic edges (scored)   ◀── transcript reader (tiers 3–4)
        ▼
  merge with real thread_spawn_edges
        ▼
 SessionSummary.parentId / AgentGraph edges
        ▼
 rootOf / flattenAgentTree / AgentGraphView / sessions-list grouping
```

`SessionSummary` / `AgentEdge` gain optional provenance fields
(`edgeSource: "codex" | "reconstructed"`, `confidence`, `via`) so the UI can
distinguish reconstructed links. Real codex edges always win when both exist.

## UI

- Reconstructed edges render distinctly by confidence: **solid** (marker/certain),
  **dashed** (high), **dotted + "inferred" badge** (medium/low).
- A **confidence floor** hides low-signal guesses (tier 4 below threshold), or
  places them behind a toggle, so junk edges never pollute the default view.
- No UI fabricates a parent when there is no signal — orphans stay orphans.

## Forward path

Adopt the marker in the supervisor's tmux spawn command:

```
[av-parent:<supervisor_thread_id>]
```

placed anywhere in the orchestrator's first prompt. This yields tier-0 (certain)
links going forward; the heuristic remains the historical-backfill safety net.

## Error handling & edge cases

- **Run id reused / re-run:** disambiguate by the active-window time check (tier 1)
  — pick the supervisor whose `[createdAt, updatedAt]` brackets the orchestrator's
  spawn.
- **Marker malformed / unknown id:** ignore the marker, fall through to heuristic
  tiers (treat as if absent).
- **No supervisor candidate:** emit no edge; the orchestrator stays a root.
- **Transcript read failure (tiers 3–4):** degrade to the next cheaper-or-lower
  tier; never throw out of the read path.
- **codex later adds a real edge:** real `thread_spawn_edges` always override the
  synthetic overlay for the same `(parent, child)` pair.

## Testing

- **Classifier:** table-driven unit tests over representative `first_user_message`
  strings (orchestrator prompt, supervisor `$implementation-execution` prompt,
  ordinary user session, marker present/malformed).
- **Linker:** fixture thread-sets exercising each tier and the tie-breakers,
  including run-id reuse and "no candidate". Transcript reader injected as a stub.
- **Integration:** extend `observatoryFixtures` with a supervisor +
  multi-phase-orchestrator + subagents run; assert the merged graph produces the
  expected 3-layer tree and provenance flags.
- **UI:** snapshot/visual check that confidence tiers render with the right
  styling and the floor hides low-signal edges.

## Open items for the implementation plan

- Exact overlay persistence mechanism (agentview-owned SQLite table vs. cached
  derivation).
- `N` for "first N user messages" in the supervisor transcript-scan fallback.
- Confidence-floor default and whether tier 4 is hidden vs. toggled.
- Final module/file names and where the merge hooks into `sessions.ts` /
  `agentGraph.ts`.
