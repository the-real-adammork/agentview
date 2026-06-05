---
date: 2026-06-04
topic: two-way-dashboard-session-communication
focus: Integrate two-way communication between AgentView's dashboard and coding sessions spawned by the dashboard.
mode: repo-grounded
---

# Ideation: Two-Way Dashboard Session Communication

## Grounding Context

- AgentView currently observes sessions through read-only source adapters and normalized contracts.
- `src/backend/sources/SessionSource.ts` defines the read model and optional capabilities (`LiveTailSource`, `LiveTokenSource`) for source-specific behavior without global branching.
- `src/backend/api/stream.ts`, `src/backend/live/liveSources.ts`, and `src/frontend/api/liveStream.ts` implement one-way live updates over SSE.
- Existing design docs scoped out writing/mutating Codex or Claude artifacts, but the spawned-only constraint creates a new Host-mode boundary.
- OpenAI Codex app-server is the official deep-integration protocol for rich clients, with JSON-RPC over stdio/websocket/unix socket, streamed events, approvals, and conversation history.
- OpenAI Codex SDK supports programmatic threads, repeated `run()`, and resuming by thread ID.
- Claude Agent SDK supports streaming input for long-lived sessions and callbacks for approvals/user input.

## Topic Axes

- Spawn/control plane
- User input and approvals
- Live event ingestion
- Session identity/state
- Safety/isolation

## Ranked Ideas

### 1. Host Mode: Codex App-Server + AgentView Bridge

**Description:** Add a Host mode that spawns `codex app-server` over stdio from the AgentView backend. The backend becomes a JSON-RPC client: start thread, start turn, interrupt/cancel, respond to server requests, and translate app-server notifications into AgentView's existing live event model.

**Axis:** Spawn/control plane

**Basis:** `external:` OpenAI documents app-server as the Codex interface for deep product integrations with streamed agent events, approvals, history, and bidirectional JSON-RPC. `direct:` AgentView already has a Node backend and local process model through Electron/API child processes.

**Rationale:** This uses the officially supported rich-client boundary instead of trying to inject input into Codex logs or terminal sessions. It also honors the spawned-only constraint cleanly: Host mode sessions are controllable; ordinary observed sessions stay read-only.

**Downsides:** High initial integration cost; app-server schemas are version-specific and need generated/pinned contracts.

**Confidence:** 90%

**Complexity:** High

**Status:** Unexplored

### 2. Add a `ManagedSessionSource` Capability

**Description:** Extend the source architecture with an optional capability, not a global source rewrite: `startSession`, `sendInput`, `interrupt`, `approve`, `decline`, `resumeManaged`, and `dispose`. Only dashboard-spawned/control-capable sources implement it.

**Axis:** Spawn/control plane

**Basis:** `direct:` AgentView already narrows optional behavior through `LiveTailSource` and `LiveTokenSource` rather than putting every method on `SessionSource`.

**Rationale:** This keeps the existing adapter discipline intact. Codex-managed, Claude-managed, and read-only Codex/Claude transcript sources can coexist without conditionals leaking into API handlers or frontend code.

**Downsides:** Requires careful contract naming so "source format" and "control capability" do not get conflated.

**Confidence:** 88%

**Complexity:** Medium

**Status:** Unexplored

### 3. Keep Browser Transport as SSE Out + HTTP POST In

**Description:** Do not replace AgentView's browser live transport with WebSockets initially. Keep `/api/stream` for server-to-browser events and add POST endpoints for user messages, approvals, interrupts, and cancellation.

**Axis:** Live event ingestion

**Basis:** `direct:` The current frontend already uses `EventSource`, the current backend already supports POST JSON routes, and SSE channels already drive timeline/session/diagnostic updates. `external:` Codex's websocket app-server transport is documented as experimental/unsupported, while stdio is the default.

**Rationale:** This gives two-way behavior at the product boundary while preserving the already-working live feed. The backend can use bidirectional app-server/SDK protocols internally without exposing that complexity to the browser.

**Downsides:** POST command responses and SSE result notifications need correlation IDs so the UI can show "sent", "accepted", and "completed" states coherently.

**Confidence:** 86%

**Complexity:** Medium

**Status:** Unexplored

### 4. Managed Session Manifest and Reconciliation

**Description:** Every dashboard-spawned session should write an AgentView manifest containing source, control transport, process metadata, cwd, model/settings, thread/session ID, transcript path, createdAt, and controllability status. On restart, AgentView reconciles the manifest with real transcripts and marks sessions as live, resumable, or read-only.

**Axis:** Session identity/state

**Basis:** `reasoned:` Process handles and stdio pipes cannot be recovered after AgentView restarts, while thread IDs and transcript files can. `direct:` Existing observability sources can still discover the transcript after control is gone.

**Rationale:** Two-way control introduces state that Codex/Claude transcript stores do not own. A manifest keeps the dashboard honest about whether a session can still receive input or only be observed/resumed.

**Downsides:** Needs cleanup policy for stale manifests and versioning for future manifest fields.

**Confidence:** 84%

**Complexity:** Medium

**Status:** Unexplored

### 5. Approval and User-Input Inbox

**Description:** Add a first-class pending-request surface for command approvals, file-change approvals, network approvals, and agent questions. The dashboard shows the exact request, available decisions, risk context, and affected session/turn, then posts the user's decision back to the managed source.

**Axis:** User input and approvals

**Basis:** `external:` Codex app-server emits server-initiated approval requests; Claude Agent SDK uses callbacks for tool approval and `AskUserQuestion`. `direct:` AgentView already has Diagnostics/warning surfaces that draw attention to blocked or risky work.

**Rationale:** "Two-way communication" is not only chat messages. The highest-value interactive path is resolving agent blockers without leaving the dashboard.

**Downsides:** Requires strong UI design and careful redaction because approval payloads may include commands, paths, or requested permissions.

**Confidence:** 82%

**Complexity:** Medium-High

**Status:** Unexplored

### 6. Protocol Events First, Log Tail as Reconciliation

**Description:** For managed sessions, ingest structured protocol notifications directly and map them to `TimelineEvent`/`CachedRolloutFacts`; keep file tailing as a fallback/reconciliation path. Do not make managed sessions wait for transcript writes to appear.

**Axis:** Live event ingestion

**Basis:** `direct:` Current file watching exists because AgentView is an outside observer. `external:` Codex app-server and Claude SDK stream richer lifecycle events directly.

**Rationale:** Direct protocol ingestion should reduce latency and preserve semantic events like approvals and turn lifecycle that transcript parsing may only infer later.

**Downsides:** Creates two ingestion paths for the same session; needs dedupe/correlation by item IDs, turn IDs, and source lines.

**Confidence:** 80%

**Complexity:** High

**Status:** Unexplored

### 7. Safety Boundary: Managed Only, Capability-Gated Controls, Separate Audit Log

**Description:** Make arbitrary attach impossible in the first version. Controls render only for managed sessions with active capabilities. Store dashboard approvals, denials, interrupts, and sandbox changes in an AgentView-owned audit log separate from source transcripts.

**Axis:** Safety/isolation

**Basis:** `direct:` The user explicitly accepts spawned-only control; repo `AGENTS.md` emphasizes isolation, ports, durable test accounts, and secrets hygiene. `reasoned:` Source transcripts may not preserve who approved what from the dashboard.

**Rationale:** This prevents the most dangerous class of feature creep: pretending AgentView can safely drive unknown external terminals. It also gives a durable accountability trail for host-side decisions.

**Downsides:** Users may ask why an observed running session has no composer; the UI needs a clear managed/read-only distinction.

**Confidence:** 87%

**Complexity:** Medium

**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | PTY-first terminal control | Useful fallback, but weaker than protocol APIs for approvals, event structure, and session identity. |
| 2 | Full WebSocket rewrite of AgentView browser transport | Too much churn; SSE+POST fits current architecture and avoids depending on experimental Codex websocket transport. |
| 3 | Control arbitrary existing sessions | Scope/safety mismatch; spawned-only control is cleaner and safer. |
| 4 | Make managed sessions a separate `SourceId` immediately | May be useful later, but capability gating is a better first abstraction than multiplying source identities. |
| 5 | Multi-agent orchestration board | Strong later product direction, but depends on basic managed sessions and approval inbox first. |
| 6 | Replayable run packets | Valuable but secondary; manifest/audit log should come first. |
| 7 | Checkpoint/revert controls | Strong safety complement, but too dependent on source-specific filesystem checkpoint support for the first integration. |
| 8 | Claude-managed sessions first | Plausible, but Codex app-server is more directly aligned with AgentView's existing Codex-heavy architecture and official rich-client protocol. |
| 9 | Diagnostics-only approval surface | Too narrow; pending requests need to be available globally, not buried in one view. |
| 10 | No persistent process manager | Too brittle for live sessions; a managed registry is needed even if process lifetimes are short. |

## Sources

- OpenAI Codex app-server: https://developers.openai.com/codex/app-server
- OpenAI Codex SDK: https://developers.openai.com/codex/sdk
- Claude Agent SDK sessions: https://code.claude.com/docs/en/agent-sdk/sessions
- Claude streaming input: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Claude approvals/user input: https://code.claude.com/docs/en/agent-sdk/user-input
