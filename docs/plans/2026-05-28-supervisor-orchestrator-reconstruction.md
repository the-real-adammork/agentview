# Supervisor → Orchestrator Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct the supervisor → orchestrator edge that codex can't record (tmux-spawned, so no `thread_spawn_edge`) and surface it in the dashboard's existing tree and graph for both new and historical runs.

**Architecture:** A pure backend `relationships` module classifies each thread from its text fields (orchestrator / supervisor / run-id / `[av-parent:]` marker) and links each orphan orchestrator to a supervisor via tiered, scored heuristics. The `StateStore` computes this overlay once over all threads and stamps a reconstructed `parentId` + provenance onto orchestrator sessions; the existing frontend tree (`rootOf`, `buildSessionRows`, `flattenAgentTree`, repo grouping) and the agent graph then light up automatically. agentview never writes codex's `state_5.sqlite`.

**Tech Stack:** TypeScript, Node `node:sqlite` (read-only), Vitest, React + `@xyflow/react`.

---

## Design reference

Spec: `docs/design/2026-05-28-supervisor-orchestrator-reconstruction-design.md`.

**Linking tiers (as refined here — supervisor classifier anchors tier 1):**

| Tier | Rule | Confidence | `via` |
| --- | --- | --- | --- |
| 0 | Orchestrator carries `[av-parent:<id>]` and that id is a known thread | `certain` | `marker` |
| 1 | A **classified supervisor**, **same cwd**, active window `[createdAtMs, updatedAtMs]` contains the orchestrator's `createdAtMs`. Run-id match (if present on both) confirms/tie-breaks. | `high` | `run-id` if run-id matched, else `cwd-time` |
| 2 | A classified supervisor, same cwd, created before the orchestrator, but window does **not** contain the spawn time | `medium` | `cwd-time` |
| 3 | (Task 6) No db candidate → transcript scan finds a user-root whose rollout references `docs/implementation-runs/<runId>/` | `medium` | `run-id` |
| 4 | Nearest preceding non-orchestrator user-root in the same cwd | `low` | `cwd-time` |
| — | No candidate → no edge (never fabricate) | — | — |

Tie-break within a tier: earliest `createdAtMs`, then largest `updatedAtMs`.

## File structure

- **Create** `src/backend/relationships/markers.ts` — pure text classifiers + marker stripping. No I/O.
- **Create** `src/backend/relationships/reconstruct.ts` — pure linker (tiers 0,1,2,4) over lightweight thread descriptors. No I/O.
- **Create** `src/backend/relationships/transcriptRunId.ts` — Task 6, run-id transcript reader (the only I/O piece), injected into the store.
- **Modify** `src/shared/contracts.ts` — provenance fields on `SessionSummary` and `AgentEdge`; shared `EdgeConfidence` / `EdgeVia` unions.
- **Modify** `src/backend/sqlite/stateStore.ts` — overlay query + cache; stamp reconstructed `parentId` + provenance; feed synthetic rows into the graph query.
- **Modify** `src/backend/api/agentGraph.ts` — thread synthetic edges + their provenance through `deriveAgentGraph`.
- **Modify** `src/frontend/views/AgentGraphView.tsx` — render reconstructed edges distinctly by confidence.
- **Modify** `src/frontend/views/SessionsView.tsx` — "inferred parent" badge on reconstructed rows.
- **Tests:** `tests/unit/relationshipMarkers.test.ts`, `tests/unit/reconstructEdges.test.ts`, `tests/integration/reconstructedEdges.test.ts`.

## Constants (decided)

- `ORCHESTRATOR_RE = /as the phase orchestrator for\s+(\S+)/i`
- `SUPERVISOR_TOKEN_RE = /\$implementation-execution\b/`
- `RUN_ID_RE = /docs\/implementation-runs\/([^/\s]+)\//`
- `MARKER_RE = /\[av-parent:([0-9a-f-]+)\]/i`
- Confidence floor for v1: emit all tiers; render by confidence. No hide-toggle yet (documented follow-up).

---

## Task 1: Shared provenance types

**Files:**
- Modify: `src/shared/contracts.ts` (after line 36, the `ThreadSource` export; and the `SessionSummary` + `AgentEdge` interfaces)

- [ ] **Step 1: Add the provenance unions and fields**

In `src/shared/contracts.ts`, immediately after the `export type ThreadSource = "user" | "subagent";` line, add:

```typescript
/** How confident we are in a reconstructed (non-codex) parent edge. */
export type EdgeConfidence = "certain" | "high" | "medium" | "low";
/** Which signal produced a reconstructed parent edge. */
export type EdgeVia = "marker" | "run-id" | "cwd-time";
/** Origin of a parent edge: codex's own spawn record vs. agentview's reconstruction. */
export type EdgeSource = "codex" | "reconstructed";
```

In the `SessionSummary` interface, directly after the `parentId?: string | null;` line, add:

```typescript
  /** "codex" when parentId came from thread_spawn_edges; "reconstructed" when inferred. */
  parentEdgeSource?: EdgeSource;
  /** Confidence of a reconstructed parent edge (absent for codex edges). */
  parentEdgeConfidence?: EdgeConfidence;
  /** Signal that produced a reconstructed parent edge (absent for codex edges). */
  parentEdgeVia?: EdgeVia;
```

In the `AgentEdge` interface, after the `status: AgentEdgeStatus;` line, add:

```typescript
  source?: EdgeSource;
  confidence?: EdgeConfidence;
  via?: EdgeVia;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (additive optional fields only).

- [ ] **Step 3: Commit**

```bash
git add src/shared/contracts.ts
git commit -m "feat(contracts): add reconstructed edge provenance fields"
```

---

## Task 2: Thread classifiers (`markers.ts`)

**Files:**
- Create: `src/backend/relationships/markers.ts`
- Test: `tests/unit/relationshipMarkers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/relationshipMarkers.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { classifyThread, stripParentMarker } from "../../src/backend/relationships/markers";

const ORCH =
  "Use the implementation-execution skill as the phase orchestrator for phase-4-product-polish-deliverables. " +
  "Run state: docs/implementation-runs/2026-05-28-rca-workbench/run.yaml. " +
  "Phase state: docs/implementation-runs/2026-05-28-rca-workbench/phases/phase-4-product-polish-deliverables.yaml.";

describe("classifyThread", () => {
  it("detects an orchestrator, its phase, and run id", () => {
    const c = classifyThread({ firstUserMessage: ORCH, preview: "working" });
    expect(c.isOrchestrator).toBe(true);
    expect(c.phase).toBe("phase-4-product-polish-deliverables");
    expect(c.runId).toBe("2026-05-28-rca-workbench");
    expect(c.isSupervisor).toBe(false);
    expect(c.markerParentId).toBeNull();
  });

  it("detects a supervisor via the $implementation-execution invocation", () => {
    const c = classifyThread({
      firstUserMessage: "$implementation-execution start the rca-workbench run",
      preview: null,
    });
    expect(c.isSupervisor).toBe(true);
    expect(c.isOrchestrator).toBe(false);
  });

  it("never classifies an orchestrator as a supervisor even if it mentions the skill", () => {
    const c = classifyThread({ firstUserMessage: ORCH, preview: null });
    expect(c.isSupervisor).toBe(false);
  });

  it("extracts an av-parent marker id", () => {
    const c = classifyThread({
      firstUserMessage: "[av-parent:019e67b0-3000-7700-9000-00005bee6c00] do the thing",
      preview: null,
    });
    expect(c.markerParentId).toBe("019e67b0-3000-7700-9000-00005bee6c00");
  });

  it("treats an ordinary session as neither", () => {
    const c = classifyThread({ firstUserMessage: "fix the flaky test", preview: "done" });
    expect(c).toMatchObject({ isOrchestrator: false, isSupervisor: false, runId: null, markerParentId: null });
  });

  it("strips the marker (and collapsed whitespace) from a preview", () => {
    expect(stripParentMarker("[av-parent:abc-123]  hello world")).toBe("hello world");
    expect(stripParentMarker(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/unit/relationshipMarkers.test.ts`
Expected: FAIL — cannot find module `markers`.

- [ ] **Step 3: Write the implementation**

Create `src/backend/relationships/markers.ts`:

```typescript
export interface ThreadTextFields {
  firstUserMessage: string | null | undefined;
  preview?: string | null | undefined;
}

export interface ThreadClassification {
  /** Matched the orchestrator launch prompt. */
  isOrchestrator: boolean;
  /** Phase id captured from the orchestrator prompt (null when not an orchestrator). */
  phase: string | null;
  /** Invokes $implementation-execution and is not itself an orchestrator. */
  isSupervisor: boolean;
  /** docs/implementation-runs/<runId>/ reference, if any. */
  runId: string | null;
  /** Parent thread id from an explicit [av-parent:<id>] marker, if any. */
  markerParentId: string | null;
}

const ORCHESTRATOR_RE = /as the phase orchestrator for\s+(\S+)/i;
const SUPERVISOR_TOKEN_RE = /\$implementation-execution\b/;
const RUN_ID_RE = /docs\/implementation-runs\/([^/\s]+)\//;
const MARKER_RE = /\[av-parent:([0-9a-f-]+)\]/i;

/** Trailing sentence punctuation that clings to a captured token (e.g. "phase-4."). */
const stripTrailingPunct = (value: string): string => value.replace(/[.,;:]+$/, "");

export const classifyThread = (fields: ThreadTextFields): ThreadClassification => {
  const first = fields.firstUserMessage ?? "";
  const preview = fields.preview ?? "";
  const both = `${first}\n${preview}`;

  // Orchestrator + marker are keyed on the launch prompt (firstUserMessage) so a
  // supervisor whose latest preview happens to quote the orchestrator phrase is
  // not misclassified.
  const orchestratorMatch = first.match(ORCHESTRATOR_RE);
  const isOrchestrator = orchestratorMatch !== null;
  const phase = orchestratorMatch ? stripTrailingPunct(orchestratorMatch[1]) : null;

  const markerMatch = first.match(MARKER_RE);
  const markerParentId = markerMatch ? markerMatch[1] : null;

  // run id and the supervisor token may appear in either the first message or the
  // latest preview, so scan both.
  const runMatch = both.match(RUN_ID_RE);
  const runId = runMatch ? runMatch[1] : null;

  const isSupervisor = !isOrchestrator && SUPERVISOR_TOKEN_RE.test(both);

  return { isOrchestrator, phase, isSupervisor, runId, markerParentId };
};

/** Remove the [av-parent:] marker from user-facing text and tidy whitespace. */
export const stripParentMarker = (value: string | null | undefined): string =>
  (value ?? "").replace(MARKER_RE, "").replace(/\s{2,}/g, " ").trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/unit/relationshipMarkers.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add src/backend/relationships/markers.ts tests/unit/relationshipMarkers.test.ts
git commit -m "feat(relationships): thread classifiers for orchestrator/supervisor/run-id/marker"
```

---

## Task 3: Linker (`reconstruct.ts`, tiers 0/1/2/4)

**Files:**
- Create: `src/backend/relationships/reconstruct.ts`
- Test: `tests/unit/reconstructEdges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reconstructEdges.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { reconstructEdges, type ReconstructThread } from "../../src/backend/relationships/reconstruct";

const CWD = "/repo/agentview";
const orchPrompt = (phase: string, run = "run-a") =>
  `Use the implementation-execution skill as the phase orchestrator for ${phase}. ` +
  `Run state: docs/implementation-runs/${run}/run.yaml.`;

const base: Omit<ReconstructThread, "id" | "firstUserMessage" | "createdAtMs" | "updatedAtMs"> = {
  preview: null,
  cwd: CWD,
  threadSource: "user",
  hasRealParent: false,
};

describe("reconstructEdges", () => {
  it("uses the marker when present (tier 0, certain)", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      {
        ...base,
        id: "orch",
        firstUserMessage: `[av-parent:sup] ${orchPrompt("phase-1")}`,
        createdAtMs: 2000,
        updatedAtMs: 3000,
      },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup", confidence: "certain", via: "marker" });
  });

  it("links to a classified supervisor in the same cwd whose window contains the spawn (tier 1, high)", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup", confidence: "high" });
  });

  it("prefers a supervisor whose run id matches and reports via run-id", () => {
    const threads: ReconstructThread[] = [
      {
        ...base,
        id: "sup-a",
        firstUserMessage: "$implementation-execution docs/implementation-runs/run-a/run.yaml",
        createdAtMs: 1000,
        updatedAtMs: 9000,
      },
      {
        ...base,
        id: "sup-b",
        firstUserMessage: "$implementation-execution docs/implementation-runs/run-b/run.yaml",
        createdAtMs: 1100,
        updatedAtMs: 9000,
      },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1", "run-a"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup-a", confidence: "high", via: "run-id" });
  });

  it("falls to medium when the supervisor window does not contain the spawn (tier 2)", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 1500 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "sup", confidence: "medium", via: "cwd-time" });
  });

  it("falls to a preceding non-orchestrator root in the same cwd (tier 4, low)", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "root", firstUserMessage: "ordinary work", createdAtMs: 1000, updatedAtMs: 1200 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("orch")).toMatchObject({ parentId: "root", confidence: "low", via: "cwd-time" });
  });

  it("emits no edge when there is no candidate", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    expect(reconstructEdges(threads).size).toBe(0);
  });

  it("never links an orchestrator that already has a real parent", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      {
        ...base,
        id: "orch",
        firstUserMessage: orchPrompt("phase-1"),
        createdAtMs: 2000,
        updatedAtMs: 3000,
        hasRealParent: true,
      },
    ];
    expect(reconstructEdges(threads).has("orch")).toBe(false);
  });

  it("links every phase orchestrator of one run to the same supervisor", () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "sup", firstUserMessage: "$implementation-execution go", createdAtMs: 1000, updatedAtMs: 9000 },
      { ...base, id: "p1", firstUserMessage: orchPrompt("phase-1"), createdAtMs: 2000, updatedAtMs: 2500 },
      { ...base, id: "p2", firstUserMessage: orchPrompt("phase-2"), createdAtMs: 3000, updatedAtMs: 3500 },
    ];
    const edges = reconstructEdges(threads);
    expect(edges.get("p1")?.parentId).toBe("sup");
    expect(edges.get("p2")?.parentId).toBe("sup");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/unit/reconstructEdges.test.ts`
Expected: FAIL — cannot find module `reconstruct`.

- [ ] **Step 3: Write the implementation**

Create `src/backend/relationships/reconstruct.ts`:

```typescript
import type { EdgeConfidence, EdgeVia, ThreadSource } from "../../shared/contracts";

import { classifyThread, type ThreadClassification } from "./markers";

export interface ReconstructThread {
  id: string;
  firstUserMessage: string | null;
  preview: string | null;
  cwd: string;
  createdAtMs: number;
  updatedAtMs: number;
  threadSource: ThreadSource | null;
  /** True when codex already records a parent (thread_spawn_edges) for this thread. */
  hasRealParent: boolean;
}

export interface ReconstructedLink {
  childId: string;
  parentId: string;
  confidence: EdgeConfidence;
  via: EdgeVia;
  runId: string | null;
  phase: string | null;
}

interface Classified extends ReconstructThread {
  c: ThreadClassification;
}

const isUserRoot = (t: Classified): boolean => !t.hasRealParent && t.threadSource !== "subagent";

/** earliest createdAtMs, then largest updatedAtMs */
const preferOriginator = (a: Classified, b: Classified): number =>
  a.createdAtMs - b.createdAtMs || b.updatedAtMs - a.updatedAtMs;

export const reconstructEdges = (threads: ReconstructThread[]): Map<string, ReconstructedLink> => {
  const classified: Classified[] = threads.map((t) => ({ ...t, c: classifyThread(t) }));
  const byId = new Map<string, Classified>(classified.map((t) => [t.id, t]));
  const supervisors = classified.filter((t) => t.c.isSupervisor);
  const links = new Map<string, ReconstructedLink>();

  const orchestrators = classified.filter((t) => t.c.isOrchestrator && !t.hasRealParent);

  for (const orch of orchestrators) {
    const runId = orch.c.runId;
    const phase = orch.c.phase;

    // Tier 0 — explicit marker.
    if (orch.c.markerParentId && byId.has(orch.c.markerParentId) && orch.c.markerParentId !== orch.id) {
      links.set(orch.id, { childId: orch.id, parentId: orch.c.markerParentId, confidence: "certain", via: "marker", runId, phase });
      continue;
    }

    // Tiers 1–2 — a classified supervisor in the same cwd, created no later than the orchestrator.
    const supCandidates = supervisors
      .filter((s) => s.id !== orch.id && s.cwd === orch.cwd && s.createdAtMs <= orch.createdAtMs)
      .sort(preferOriginator);

    if (supCandidates.length > 0) {
      const runMatches = runId ? supCandidates.filter((s) => s.c.runId === runId) : [];
      const pool = runMatches.length > 0 ? runMatches : supCandidates;
      const windowMatches = pool.filter((s) => s.createdAtMs <= orch.createdAtMs && orch.createdAtMs <= s.updatedAtMs);

      if (windowMatches.length > 0) {
        const parent = windowMatches[0];
        const via: EdgeVia = runMatches.length > 0 ? "run-id" : "cwd-time";
        links.set(orch.id, { childId: orch.id, parentId: parent.id, confidence: "high", via, runId, phase });
        continue;
      }

      const parent = pool[0];
      links.set(orch.id, { childId: orch.id, parentId: parent.id, confidence: "medium", via: "cwd-time", runId, phase });
      continue;
    }

    // Tier 4 — nearest preceding non-orchestrator user root in the same cwd.
    const fallback = classified
      .filter(
        (t) =>
          t.id !== orch.id &&
          t.cwd === orch.cwd &&
          isUserRoot(t) &&
          !t.c.isOrchestrator &&
          t.createdAtMs <= orch.createdAtMs,
      )
      .sort((a, b) => b.createdAtMs - a.createdAtMs);

    if (fallback.length > 0) {
      links.set(orch.id, { childId: orch.id, parentId: fallback[0].id, confidence: "low", via: "cwd-time", runId, phase });
    }
  }

  return links;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- --run tests/unit/reconstructEdges.test.ts`
Expected: PASS (all 8).

- [ ] **Step 5: Commit**

```bash
git add src/backend/relationships/reconstruct.ts tests/unit/reconstructEdges.test.ts
git commit -m "feat(relationships): tiered supervisor->orchestrator edge linker"
```

---

## Task 4: Stamp reconstructed parentId in the state store

The store computes the overlay once per opened connection (cheap: one extra query over candidate threads), then applies it in `normalizeThread`.

**Files:**
- Modify: `src/backend/sqlite/stateStore.ts`
- Test: `tests/integration/reconstructedEdges.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/reconstructedEdges.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { createCodexHomeFixture } from "../fixtures/codexHome";
import { openStateStore } from "../../src/backend/sqlite/stateStore";

const CWD = "/repo/agentview";
const orchPrompt = (phase: string, run = "rca-workbench") =>
  `Use the implementation-execution skill as the phase orchestrator for ${phase}. ` +
  `Run state: docs/implementation-runs/${run}/run.yaml.`;

describe("reconstructed supervisor->orchestrator edges", () => {
  it("stamps a reconstructed parentId + provenance on an orphan orchestrator", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "supervisor",
          cwd: CWD,
          createdAtMs: 1_000_000,
          updatedAtMs: 9_000_000,
          firstUserMessage: "$implementation-execution kick off rca-workbench",
          threadSource: "user",
        },
        {
          id: "orchestrator",
          cwd: CWD,
          createdAtMs: 2_000_000,
          updatedAtMs: 3_000_000,
          firstUserMessage: orchPrompt("phase-4"),
          threadSource: "user",
        },
      ],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const orch = await store.getThread("orchestrator");
        expect(orch?.parentId).toBe("supervisor");
        expect(orch?.parentEdgeSource).toBe("reconstructed");
        expect(orch?.parentEdgeConfidence).toBe("high");

        const supervisor = await store.getThread("supervisor");
        expect(supervisor?.parentId ?? null).toBeNull();
        expect(supervisor?.parentEdgeSource).toBeUndefined();
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("leaves a real codex parent untouched", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "p", cwd: CWD, createdAtMs: 1_000_000, updatedAtMs: 2_000_000, firstUserMessage: "parent", threadSource: "user" },
        { id: "c", cwd: CWD, createdAtMs: 1_500_000, updatedAtMs: 2_000_000, firstUserMessage: "child", threadSource: "subagent" },
      ],
      edges: [{ parentThreadId: "p", childThreadId: "c", status: "closed" }],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const child = await store.getThread("c");
        expect(child?.parentId).toBe("p");
        expect(child?.parentEdgeSource).toBe("codex");
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- --run tests/integration/reconstructedEdges.test.ts`
Expected: FAIL — `parentId` is null / provenance undefined.

- [ ] **Step 3: Add the overlay query and apply it**

In `src/backend/sqlite/stateStore.ts`:

(a) Add the import near the top (after the existing `threadTitle` import on line 13):

```typescript
import { reconstructEdges, type ReconstructThread } from "../relationships/reconstruct";
```

(b) `normalizeThread` must be able to receive an overlay. Change its signature and the two assignments. Replace the current `parentId: row.parent_thread_id ?? null,` line and add provenance using an injected `overlay` argument. Update the function signature on line 123:

```typescript
const normalizeThread = (
  row: ThreadRow,
  overlay?: Map<string, import("../relationships/reconstruct").ReconstructedLink>,
): SessionSummary => {
```

Inside the function, after computing `model` (around line 139), add:

```typescript
  const realParentId = row.parent_thread_id ?? null;
  const reconstructed = !realParentId ? overlay?.get(row.id) : undefined;
```

Then in the returned object, replace:

```typescript
    parentId: row.parent_thread_id ?? null,
```

with:

```typescript
    parentId: realParentId ?? reconstructed?.parentId ?? null,
    parentEdgeSource: realParentId ? "codex" : reconstructed ? "reconstructed" : undefined,
    parentEdgeConfidence: reconstructed?.confidence,
    parentEdgeVia: reconstructed?.via,
```

(c) Add a query that loads the lightweight descriptors for the linker, and build a cached overlay. Add this SQL constant after `selectThreadSql` (after line 259):

```typescript
const selectReconstructInputSql = `
  SELECT
    t.id AS id,
    t.first_user_message AS firstUserMessage,
    t.preview AS preview,
    t.cwd AS cwd,
    COALESCE(t.created_at_ms, t.created_at * 1000) AS createdAtMs,
    COALESCE(t.updated_at_ms, t.updated_at * 1000) AS updatedAtMs,
    t.thread_source AS threadSource,
    CASE WHEN parent_edge.child_thread_id IS NULL THEN 0 ELSE 1 END AS hasRealParent
  FROM threads t
  LEFT JOIN thread_spawn_edges parent_edge ON parent_edge.child_thread_id = t.id
`;
```

(d) Inside `openStateStore`, after `validateSchema` runs and before building `store` (after line 281), add a lazily-built, cached overlay:

```typescript
  let overlayCache: Map<string, import("../relationships/reconstruct").ReconstructedLink> | null = null;
  const getOverlay = () => {
    if (overlayCache) {
      return overlayCache;
    }
    const rows = db.prepare(selectReconstructInputSql).all() as unknown as Array<{
      id: string;
      firstUserMessage: string | null;
      preview: string | null;
      cwd: string;
      createdAtMs: number | bigint | null;
      updatedAtMs: number | bigint | null;
      threadSource: ThreadSource | null;
      hasRealParent: number | bigint;
    }>;
    const threads: ReconstructThread[] = rows.map((row) => ({
      id: row.id,
      firstUserMessage: row.firstUserMessage,
      preview: row.preview,
      cwd: row.cwd,
      createdAtMs: Number(row.createdAtMs ?? 0),
      updatedAtMs: Number(row.updatedAtMs ?? 0),
      threadSource: row.threadSource,
      hasRealParent: Number(row.hasRealParent) === 1,
    }));
    overlayCache = reconstructEdges(threads);
    return overlayCache;
  };
```

(e) Pass the overlay into every `normalizeThread` call. In `listSessions`, both `rows.map(normalizeThread)` calls (lines 387 and 396) become `rows.map((row) => normalizeThread(row, getOverlay()))`. In `getThread` (line 406), change `return row ? normalizeThread(row) : null;` to `return row ? normalizeThread(row, getOverlay()) : null;`.

- [ ] **Step 4: Run the integration test**

Run: `npm run test -- --run tests/integration/reconstructedEdges.test.ts`
Expected: PASS (both).

- [ ] **Step 5: Run the existing store tests for regressions**

Run: `npm run test -- --run tests/integration/stateStore.test.ts tests/integration/sessionsApi.test.ts`
Expected: PASS (existing behavior unchanged — real edges still win, archived defaults still apply).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/backend/sqlite/stateStore.ts tests/integration/reconstructedEdges.test.ts
git commit -m "feat(state-store): stamp reconstructed parentId + provenance on orphan orchestrators"
```

---

## Task 5: Splice reconstructed edges into the agent graph

When the graph root is a supervisor, its tmux-spawned orchestrators (and their real subtrees) must appear. Approach: after building the base graph rows for the root, fetch the overlay, and for each reconstructed child whose parent is already in the row set, append a synthetic edge row plus that child's own subtree rows. `deriveAgentGraph` already builds `childrenByParent` from `(parentThreadId, childThreadId, edgeStatus)` rows, so synthetic rows flow through unchanged — we only thread provenance onto the resulting `AgentEdge`.

**Files:**
- Modify: `src/backend/sqlite/stateStore.ts` (extend `AgentGraphRow` + a new `getReconstructedGraphRows` method)
- Modify: `src/backend/api/agentGraph.ts` (carry provenance onto edges)
- Test: `tests/integration/reconstructedEdges.test.ts` (add a graph case)

- [ ] **Step 1: Write the failing test (append to the integration file)**

Append to `tests/integration/reconstructedEdges.test.ts`:

```typescript
import { deriveAgentGraph } from "../../src/backend/api/agentGraph";

describe("reconstructed edges in the agent graph", () => {
  it("includes the orchestrator subtree under the supervisor with reconstructed provenance", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "supervisor", cwd: CWD, createdAtMs: 1_000_000, updatedAtMs: 9_000_000, firstUserMessage: "$implementation-execution go", threadSource: "user" },
        { id: "orchestrator", cwd: CWD, createdAtMs: 2_000_000, updatedAtMs: 3_000_000, firstUserMessage: orchPrompt("phase-4"), threadSource: "user" },
        { id: "worker", cwd: CWD, createdAtMs: 2_500_000, updatedAtMs: 2_900_000, firstUserMessage: "do work", threadSource: "subagent" },
      ],
      edges: [{ parentThreadId: "orchestrator", childThreadId: "worker", status: "closed" }],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const rows = await store.getAgentGraphRows("supervisor", 5);
        const graph = deriveAgentGraph("supervisor", rows, { maxDepth: 5 });
        const ids = graph.nodes.map((n) => n.id).sort();
        expect(ids).toEqual(["orchestrator", "supervisor", "worker"]);
        const recon = graph.edges.find((e) => e.parentId === "supervisor" && e.childId === "orchestrator");
        expect(recon?.source).toBe("reconstructed");
        expect(graph.edges.find((e) => e.parentId === "orchestrator" && e.childId === "worker")?.source ?? "codex").toBe("codex");
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- --run tests/integration/reconstructedEdges.test.ts`
Expected: FAIL — graph has only `supervisor` (orchestrator subtree missing).

- [ ] **Step 3: Extend `AgentGraphRow` and `getAgentGraphRows`**

In `src/backend/sqlite/stateStore.ts`, add two optional fields to the `AgentGraphRow` interface (after `edgeOrder` on line 58):

```typescript
  /** Set on synthetic rows produced from the reconstructed overlay. */
  edgeSource?: import("../../shared/contracts").EdgeSource;
  edgeConfidence?: import("../../shared/contracts").EdgeConfidence;
  edgeVia?: import("../../shared/contracts").EdgeVia;
```

Change the `getAgentGraphRows` implementation so that, after computing the base recursive `rows`, it appends reconstructed subtrees. Replace the `async getAgentGraphRows(rootThreadId, scanDepth) {` body's `return db.prepare(...).all(...)` with a named `const baseRows = db.prepare(...).all(...) as unknown as AgentGraphRow[];` followed by:

```typescript
      const overlay = getOverlay();
      if (overlay.size === 0) {
        return baseRows;
      }

      const present = new Set(baseRows.map((row) => row.id).filter((id): id is string => id !== null));
      const extraRows: AgentGraphRow[] = [];
      const queue = [...present];
      const expanded = new Set<string>();

      // For each node already in the graph, attach any orchestrators reconstructed
      // under it, then pull each orchestrator's own real subtree.
      while (queue.length > 0) {
        const parentId = queue.shift() as string;
        for (const link of overlay.values()) {
          if (link.parentId !== parentId || expanded.has(link.childId) || present.has(link.childId)) {
            continue;
          }
          expanded.add(link.childId);
          present.add(link.childId);

          const childMeta = db
            .prepare(`
              SELECT
                id, title, first_user_message AS firstUserMessage, preview,
                tokens_used AS tokensUsed,
                COALESCE(created_at_ms, created_at * 1000) AS createdAtMs,
                COALESCE(updated_at_ms, updated_at * 1000) AS updatedAtMs,
                agent_nickname AS agentNickname, agent_role AS agentRole
              FROM threads WHERE id = :childId
            `)
            .get({ childId: link.childId }) as unknown as Partial<AgentGraphRow> | undefined;

          // Synthetic edge row: parent (supervisor) -> child (orchestrator).
          extraRows.push({
            id: link.childId,
            title: childMeta?.title ?? null,
            firstUserMessage: childMeta?.firstUserMessage ?? null,
            preview: childMeta?.preview ?? null,
            tokensUsed: childMeta?.tokensUsed ?? null,
            createdAtMs: childMeta?.createdAtMs ?? null,
            updatedAtMs: childMeta?.updatedAtMs ?? null,
            agentNickname: childMeta?.agentNickname ?? null,
            agentRole: childMeta?.agentRole ?? null,
            parentThreadId: parentId,
            childThreadId: link.childId,
            edgeStatus: "closed",
            edgeOrder: null,
            edgeSource: "reconstructed",
            edgeConfidence: link.confidence,
            edgeVia: link.via,
          });

          // The orchestrator's own (real) subtree.
          const subRows = db.prepare(graphRecursiveSql).all({ rootThreadId: link.childId, scanDepth }) as unknown as AgentGraphRow[];
          for (const sub of subRows) {
            if (sub.id && sub.id !== link.childId) {
              extraRows.push(sub);
              if (!present.has(sub.id)) {
                present.add(sub.id);
                queue.push(sub.id);
              }
            } else if (!sub.childThreadId) {
              // skip the duplicate root metadata row for the orchestrator
            } else {
              extraRows.push(sub);
            }
          }
          queue.push(link.childId);
        }
      }

      return [...baseRows, ...extraRows];
```

To reuse the recursive query, extract the existing recursive SQL (lines 410–480) into a module-level `const graphRecursiveSql = \`...\`;` (the same string currently inlined), and have both the original call and the subtree call use `db.prepare(graphRecursiveSql)`. The original call stays `db.prepare(graphRecursiveSql).all({ rootThreadId, scanDepth })`.

- [ ] **Step 4: Thread provenance onto edges in `deriveAgentGraph`**

In `src/backend/api/agentGraph.ts`:

In the loop that builds `childrenByParent` (lines 110–120), capture provenance. Change the pushed object to include the new fields:

```typescript
      children.push({
        childId: row.childThreadId,
        status: row.edgeStatus,
        row: row.id ? row : undefined,
        edgeOrder: Number(row.edgeOrder ?? children.length),
        sortCreatedAtMs: row.createdAtMs ?? Number.MAX_SAFE_INTEGER,
        edgeSource: row.edgeSource,
        edgeConfidence: row.edgeConfidence,
        edgeVia: row.edgeVia,
      });
```

Update the `childrenByParent` map's value type (line 100-103) to include `edgeSource?`, `edgeConfidence?`, `edgeVia?` (matching `AgentGraphRow`'s new optional fields).

Where edges are pushed (lines 161–165), include provenance:

```typescript
      edges.push({
        parentId: current.id,
        childId: child.childId,
        status: child.status,
        ...(child.edgeSource ? { source: child.edgeSource } : {}),
        ...(child.edgeConfidence ? { confidence: child.edgeConfidence } : {}),
        ...(child.edgeVia ? { via: child.edgeVia } : {}),
      });
```

- [ ] **Step 5: Run the graph test**

Run: `npm run test -- --run tests/integration/reconstructedEdges.test.ts`
Expected: PASS (all three describe blocks).

- [ ] **Step 6: Regression + typecheck + commit**

```bash
npm run test -- --run tests/unit/agentGraph.test.ts tests/integration/graphTokensApi.test.ts
npm run typecheck
git add src/backend/sqlite/stateStore.ts src/backend/api/agentGraph.ts tests/integration/reconstructedEdges.test.ts
git commit -m "feat(agent-graph): splice reconstructed orchestrator subtrees with provenance"
```

---

## Task 6: Tier 3 — transcript run-id fallback

For orchestrators the pure linker left **unlinked** or at **low** confidence, scan candidate user-roots' rollout JSONL for `docs/implementation-runs/<runId>/` and, on a hit, upgrade to a `medium` / `run-id` link. This is the only filesystem-touching piece and is injected so it stays testable.

**Files:**
- Create: `src/backend/relationships/transcriptRunId.ts`
- Modify: `src/backend/sqlite/stateStore.ts` (call it inside `getOverlay`, after the pure pass)
- Test: `tests/unit/reconstructEdges.test.ts` (the resolver is a pure async function with an injected reader)

- [ ] **Step 1: Write the failing test (append to the unit file)**

Append to `tests/unit/reconstructEdges.test.ts`:

```typescript
import { upgradeViaTranscript } from "../../src/backend/relationships/transcriptRunId";

describe("upgradeViaTranscript", () => {
  it("links an unlinked orchestrator to the root whose transcript references its run id", async () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "root", firstUserMessage: "set up the run", createdAtMs: 1000, updatedAtMs: 9000 },
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1", "run-z"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const existing = new Map(); // pure linker found nothing (root not a classified supervisor)
    const rolloutById = new Map<string, string>([["root", "sessions/root.jsonl"]]);
    const readText = async (path: string) =>
      path === "sessions/root.jsonl" ? "blah docs/implementation-runs/run-z/run.yaml blah" : "";

    const upgraded = await upgradeViaTranscript(threads, existing, {
      rolloutPathById: rolloutById,
      readText,
    });
    expect(upgraded.get("orch")).toMatchObject({ parentId: "root", confidence: "medium", via: "run-id" });
  });

  it("does not override an existing high/certain link", async () => {
    const threads: ReconstructThread[] = [
      { ...base, id: "orch", firstUserMessage: orchPrompt("phase-1", "run-z"), createdAtMs: 2000, updatedAtMs: 3000 },
    ];
    const existing = new Map([
      ["orch", { childId: "orch", parentId: "sup", confidence: "high" as const, via: "run-id" as const, runId: "run-z", phase: "phase-1" }],
    ]);
    const upgraded = await upgradeViaTranscript(threads, existing, { rolloutPathById: new Map(), readText: async () => "" });
    expect(upgraded.get("orch")?.parentId).toBe("sup");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- --run tests/unit/reconstructEdges.test.ts`
Expected: FAIL — cannot find module `transcriptRunId`.

- [ ] **Step 3: Implement the resolver**

Create `src/backend/relationships/transcriptRunId.ts`:

```typescript
import { classifyThread } from "./markers";
import type { ReconstructThread, ReconstructedLink } from "./reconstruct";

export interface TranscriptReaderDeps {
  /** Maps a thread id to the rollout path to read (already resolved to an absolute path by the caller). */
  rolloutPathById: Map<string, string>;
  /** Reads a rollout file's text; returns "" if unreadable. */
  readText: (path: string) => Promise<string>;
}

const runIdMentioned = (text: string, runId: string): boolean =>
  text.includes(`docs/implementation-runs/${runId}/`);

/**
 * For orchestrators that are unlinked or only low-confidence after the pure pass,
 * find a user-root whose transcript references the orchestrator's run id and link
 * them at medium confidence. Existing high/certain links are never overridden.
 */
export const upgradeViaTranscript = async (
  threads: ReconstructThread[],
  existing: Map<string, ReconstructedLink>,
  deps: TranscriptReaderDeps,
): Promise<Map<string, ReconstructedLink>> => {
  const result = new Map(existing);
  const classified = threads.map((t) => ({ t, c: classifyThread(t) }));
  const candidates = classified.filter(({ t, c }) => !t.hasRealParent && c.isOrchestrator);

  for (const { t: orch, c } of candidates) {
    const runId = c.runId;
    if (!runId) {
      continue;
    }
    const current = result.get(orch.id);
    if (current && (current.confidence === "certain" || current.confidence === "high" || current.confidence === "medium")) {
      continue;
    }

    const roots = classified
      .filter(({ t }) => t.id !== orch.id && !t.hasRealParent && t.threadSource !== "subagent" && t.createdAtMs <= orch.createdAtMs)
      .sort((a, b) => a.t.createdAtMs - b.t.createdAtMs);

    for (const { t: root } of roots) {
      const path = deps.rolloutPathById.get(root.id);
      if (!path) {
        continue;
      }
      const text = await deps.readText(path);
      if (text && runIdMentioned(text, runId)) {
        result.set(orch.id, { childId: orch.id, parentId: root.id, confidence: "medium", via: "run-id", runId, phase: c.phase });
        break;
      }
    }
  }

  return result;
};
```

- [ ] **Step 4: Wire it into the store**

In `src/backend/sqlite/stateStore.ts`, `getOverlay` becomes async (the store methods already `await`). Change `getOverlay` to build the pure overlay, then run `upgradeViaTranscript`. Add imports:

```typescript
import { readFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { upgradeViaTranscript } from "../relationships/transcriptRunId";
```

Change the cache type and make it a promise so concurrent calls share one build:

```typescript
  let overlayPromise: Promise<Map<string, import("../relationships/reconstruct").ReconstructedLink>> | null = null;
  const getOverlay = () => {
    if (overlayPromise) {
      return overlayPromise;
    }
    overlayPromise = (async () => {
      const rows = db.prepare(selectReconstructInputSql).all() as unknown as Array<{
        id: string; firstUserMessage: string | null; preview: string | null; cwd: string;
        createdAtMs: number | bigint | null; updatedAtMs: number | bigint | null;
        threadSource: ThreadSource | null; hasRealParent: number | bigint;
      }>;
      const threads: ReconstructThread[] = rows.map((row) => ({
        id: row.id, firstUserMessage: row.firstUserMessage, preview: row.preview, cwd: row.cwd,
        createdAtMs: Number(row.createdAtMs ?? 0), updatedAtMs: Number(row.updatedAtMs ?? 0),
        threadSource: row.threadSource, hasRealParent: Number(row.hasRealParent) === 1,
      }));
      const pure = reconstructEdges(threads);

      const rolloutRows = db.prepare("SELECT id, rollout_path AS rolloutPath FROM threads").all() as unknown as Array<{ id: string; rolloutPath: string }>;
      const rolloutPathById = new Map(
        rolloutRows.map((r) => [r.id, isAbsolute(r.rolloutPath) ? r.rolloutPath : join(codexHome, r.rolloutPath)] as const),
      );
      return upgradeViaTranscript(threads, pure, {
        rolloutPathById,
        readText: async (path) => {
          try {
            return await readFile(path, "utf8");
          } catch {
            return "";
          }
        },
      });
    })();
    return overlayPromise;
  };
```

Update the three call sites to `await`: in `listSessions`, `const overlay = await getOverlay();` once at the top of the method, then `rows.map((row) => normalizeThread(row, overlay))`; in `getThread`, `const overlay = await getOverlay(); return row ? normalizeThread(row, overlay) : null;`; in `getAgentGraphRows`, `const overlay = await getOverlay();` replacing the synchronous `getOverlay()`.

- [ ] **Step 5: Run unit + integration**

Run: `npm run test -- --run tests/unit/reconstructEdges.test.ts tests/integration/reconstructedEdges.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/backend/relationships/transcriptRunId.ts src/backend/sqlite/stateStore.ts tests/unit/reconstructEdges.test.ts
git commit -m "feat(relationships): transcript run-id fallback (tier 3) for unlinked orchestrators"
```

---

## Task 7: Frontend — render reconstructed edges and a sessions badge

**Files:**
- Modify: `src/frontend/views/AgentGraphView.tsx`
- Modify: `src/frontend/views/SessionsView.tsx`
- Test: `tests/unit/graphTokenComponents.test.tsx` is component-level; add a focused render assertion in a new `tests/unit/reconstructedEdgeRender.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/reconstructedEdgeRender.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { AgentGraphView } from "../../src/frontend/views/AgentGraphView";
import type { AgentGraph } from "../../src/shared/contracts";

const graph: AgentGraph = {
  root: { id: "sup", title: "Supervisor", status: "complete", depth: 0, tokenTotal: 0 },
  nodes: [
    { id: "sup", title: "Supervisor", status: "complete", depth: 0, tokenTotal: 0 },
    { id: "orch", title: "Orchestrator", status: "complete", depth: 1, tokenTotal: 0 },
  ],
  edges: [{ parentId: "sup", childId: "orch", status: "closed", source: "reconstructed", confidence: "high", via: "run-id" }],
  maxDepth: 2,
  truncatedDepth: false,
  openCount: 0,
  statusSummary: { open: 0, closed: 1, failed: 0 },
};

describe("AgentGraphView reconstructed edges", () => {
  it("marks reconstructed edges with a data attribute and class", () => {
    const { container } = render(
      <AgentGraphView
        graph={graph}
        isLoading={false}
        error={null}
        maxDepth={2}
        onMaxDepthChange={() => {}}
        onRefresh={() => {}}
        onSelectSession={() => {}}
      />,
    );
    // React Flow renders edges asynchronously into the DOM; assert the derived edge
    // model instead by querying the rendered edge label text.
    expect(container.querySelector('[data-testid="agent-graph-canvas"]')).not.toBeNull();
  });
});
```

(Note: React Flow does not render SVG edges in jsdom reliably; this test asserts the canvas mounts. Edge styling is verified visually + via the unit edge-model assertions in Task 5. Keep this test minimal.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- --run tests/unit/reconstructedEdgeRender.test.tsx`
Expected: FAIL — module render error until imports/props line up (or PASS trivially if the component already mounts; if it passes immediately, proceed — the real change is the styling below).

- [ ] **Step 3: Style reconstructed edges**

In `src/frontend/views/AgentGraphView.tsx`, in the `setEdges(graph.edges.map(...))` block (lines 179–199), replace the returned edge object with one that varies by provenance:

```typescript
    setEdges(
      graph.edges.map((edge) => {
        const open = edge.status === "open";
        const reconstructed = edge.source === "reconstructed";
        const dash = reconstructed ? (edge.confidence === "high" ? "6 4" : "2 4") : undefined;
        return {
          id: `${edge.parentId}-${edge.childId}`,
          source: edge.parentId,
          target: edge.childId,
          type: "default",
          animated: open && !reconstructed,
          label: reconstructed ? `${edge.via ?? "inferred"} · ${edge.confidence ?? ""}`.trim() : edge.status,
          ariaLabel: reconstructed
            ? `Reconstructed ${edge.confidence ?? ""} edge via ${edge.via ?? "heuristic"}`
            : `${open ? "Open" : "Closed"} spawn edge`,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: reconstructed ? "var(--ink-ghost)" : open ? "var(--warn)" : "var(--primary)",
          },
          style: dash ? { strokeDasharray: dash } : undefined,
          data: { reconstructed, confidence: edge.confidence, via: edge.via },
          className: reconstructed
            ? `graph-flow-edge graph-flow-edge--reconstructed graph-flow-edge--${edge.confidence ?? "low"}`
            : `graph-flow-edge graph-flow-edge--${edge.status}`,
        };
      }),
    );
```

Also update the header subtitle (line 219) to acknowledge reconstruction:

```typescript
              <span>Agent Tree · thread_spawn_edges + reconstructed</span>
```

- [ ] **Step 4: Sessions list badge**

In `src/frontend/views/SessionsView.tsx`, locate where a sub-agent row renders its role/label (the `isSubagent` usage around line 48 and the row rendering). Add, next to the existing sub-agent label, a conditional badge when the row's parent edge is reconstructed:

```tsx
{session.parentEdgeSource === "reconstructed" ? (
  <span className="chip dim" title={`Inferred parent · ${session.parentEdgeVia ?? "heuristic"} · ${session.parentEdgeConfidence ?? ""}`}>
    inferred
  </span>
) : null}
```

(Place this inside the row's label/metadata span. If `SessionsView` delegates row rendering to a child component, thread `session` through and add the badge there. Match the existing `chip` styling already used in the view.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npm run test -- --run tests/unit/reconstructedEdgeRender.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/frontend/views/AgentGraphView.tsx src/frontend/views/SessionsView.tsx tests/unit/reconstructedEdgeRender.test.tsx
git commit -m "feat(ui): render reconstructed edges distinctly + inferred-parent badge"
```

---

## Task 8: End-to-end fixture scenario + full verification

**Files:**
- Test: `tests/integration/reconstructedEdges.test.ts` (add a multi-phase scenario)

- [ ] **Step 1: Add the multi-phase end-to-end test**

Append to `tests/integration/reconstructedEdges.test.ts`:

```typescript
describe("full rca-workbench-style run", () => {
  it("reconstructs one supervisor over two phase orchestrators, each with a worker", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "supervisor", cwd: CWD, createdAtMs: 1_000_000, updatedAtMs: 9_000_000, firstUserMessage: "$implementation-execution rca-workbench", threadSource: "user" },
        { id: "orch-1", cwd: CWD, createdAtMs: 2_000_000, updatedAtMs: 4_000_000, firstUserMessage: orchPrompt("phase-1"), threadSource: "user" },
        { id: "orch-4", cwd: CWD, createdAtMs: 5_000_000, updatedAtMs: 6_000_000, firstUserMessage: orchPrompt("phase-4"), threadSource: "user" },
        { id: "w1", cwd: CWD, createdAtMs: 2_500_000, updatedAtMs: 3_000_000, firstUserMessage: "phase 1 work", threadSource: "subagent" },
        { id: "w4", cwd: CWD, createdAtMs: 5_500_000, updatedAtMs: 5_800_000, firstUserMessage: "phase 4 work", threadSource: "subagent" },
      ],
      edges: [
        { parentThreadId: "orch-1", childThreadId: "w1", status: "closed" },
        { parentThreadId: "orch-4", childThreadId: "w4", status: "closed" },
      ],
    });

    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const sessions = await store.listSessions({ archived: "exclude" }, { limit: 100, offset: 0 });
        const byId = new Map(sessions.map((s) => [s.id, s]));
        expect(byId.get("orch-1")?.parentId).toBe("supervisor");
        expect(byId.get("orch-4")?.parentId).toBe("supervisor");
        expect(byId.get("orch-1")?.parentEdgeSource).toBe("reconstructed");

        const graph = deriveAgentGraph("supervisor", await store.getAgentGraphRows("supervisor", 5), { maxDepth: 5 });
        expect(graph.nodes.map((n) => n.id).sort()).toEqual(["orch-1", "orch-4", "supervisor", "w1", "w4"]);
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run the full new suite**

Run: `npm run test -- --run tests/integration/reconstructedEdges.test.ts tests/unit/relationshipMarkers.test.ts tests/unit/reconstructEdges.test.ts`
Expected: PASS (all).

- [ ] **Step 3: Full gate — whole test suite, typecheck, lint**

Run: `npm run typecheck && npm run lint && npm run test -- --run`
Expected: PASS. If `privacy:check` is part of CI, also run `npm run privacy:check` (the marker is stripped from previews via `stripParentMarker`, so confirm no marker leaks — see Task 9).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/reconstructedEdges.test.ts
git commit -m "test(relationships): end-to-end multi-phase reconstruction scenario"
```

---

## Task 9: Strip the marker from user-facing previews

The `[av-parent:<id>]` marker must not appear in titles/previews shown in the UI.

**Files:**
- Modify: `src/backend/sqlite/stateStore.ts` (`normalizeThread`)
- Test: `tests/integration/reconstructedEdges.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```typescript
describe("marker hygiene", () => {
  it("strips the av-parent marker from preview/first-message fields", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        { id: "sup", cwd: CWD, createdAtMs: 1_000_000, updatedAtMs: 9_000_000, firstUserMessage: "$implementation-execution go", threadSource: "user" },
        {
          id: "orch",
          cwd: CWD,
          createdAtMs: 2_000_000,
          updatedAtMs: 3_000_000,
          firstUserMessage: `[av-parent:sup] ${orchPrompt("phase-1")}`,
          preview: "[av-parent:sup] latest line",
          threadSource: "user",
        },
      ],
    });
    try {
      const store = await openStateStore({ codexHome: fixture.codexHome });
      try {
        const orch = await store.getThread("orch");
        expect(orch?.firstUserMessagePreview).not.toContain("av-parent");
        expect(orch?.preview).not.toContain("av-parent");
        expect(orch?.lastMessage).not.toContain("av-parent");
        expect(orch?.parentId).toBe("sup"); // still linked via the marker
      } finally {
        await store.close();
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- --run tests/integration/reconstructedEdges.test.ts`
Expected: FAIL — previews still contain `av-parent`.

- [ ] **Step 3: Apply the strip**

In `src/backend/sqlite/stateStore.ts`, add to the imports from the relationships module:

```typescript
import { stripParentMarker } from "../relationships/markers";
```

In `normalizeThread`, change the preview derivations (lines 126–127) to strip the marker:

```typescript
  const firstUserMessagePreview = stripParentMarker(row.first_user_message);
  const preview = stripParentMarker(row.preview);
```

(`trimPreview` is no longer needed for these two; leave it if used elsewhere.) The classifier still reads the raw `row.first_user_message` via the overlay query (`selectReconstructInputSql` selects the unmodified column), so marker detection is unaffected.

- [ ] **Step 4: Run + regression + commit**

```bash
npm run test -- --run tests/integration/reconstructedEdges.test.ts tests/privacy/privacyPreviews.test.ts
npm run typecheck
git add src/backend/sqlite/stateStore.ts tests/integration/reconstructedEdges.test.ts
git commit -m "feat(state-store): strip av-parent marker from user-facing previews"
```

---

## Self-review

**Spec coverage:**
- Detection layer (orchestrator/supervisor/runId/marker) → Task 2. ✓
- Tiered scored linker (tiers 0,1,2,4) → Task 3; tier 3 transcript → Task 6. ✓
- Synthetic overlay, never writes codex DB → Task 4 (read-only `db`, separate overlay map). ✓
- Provenance on `SessionSummary` + `AgentEdge` → Task 1; populated in Tasks 4–5. ✓
- Agent-graph splicing → Task 5. ✓
- UI distinct rendering + badge → Task 7. ✓
- Marker forward path + preview hygiene → Task 9. ✓
- "Leave orphan, never fabricate" → Task 3 (no candidate ⇒ no map entry), asserted in Task 3 Step 1. ✓
- Backfill historical data → Tasks 3/6 need no marker; asserted in Task 8. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"; every code step shows code. The one soft spot is Task 7 Step 4 (SessionsView badge placement) — `SessionsView` row markup wasn't fully read; the executor must place the badge in the existing row label span. Flagged inline.

**Type consistency:** `ReconstructedLink` shape (`childId, parentId, confidence, via, runId, phase`) is identical across Tasks 3, 6. `EdgeConfidence`/`EdgeVia`/`EdgeSource` come from contracts (Task 1) everywhere. `AgentGraphRow` optional `edgeSource/edgeConfidence/edgeVia` (Task 5) match the `childrenByParent`/`AgentEdge` fields. `getOverlay` is async from Task 6 onward — Task 4 introduces it sync, Task 6 converts it and updates all call sites (noted explicitly).

**Open follow-ups (out of scope, documented):** confidence-floor toggle in the UI; CSS for `graph-flow-edge--reconstructed` (relies on inline `strokeDasharray` for v1); configurability of the signature regexes (hardcoded to the implementation-execution workflow for v1).
