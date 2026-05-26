# Codex Session Observability Dashboard Technical Design

**Goal:** Build a read-only, local-only observability dashboard for Codex sessions under `~/.codex`, using a Vite + React frontend and a local Node ingest/API boundary that can later map cleanly to Tauri IPC.

**Status:** Draft

---

## Context

The repository currently contains documentation and prototype assets only. There is no `package.json`, application scaffold, backend service, test setup, or runtime code outside `docs/`. The new app therefore needs to bootstrap the runtime, module structure, development commands, and verification harness from scratch while preserving the prototype's visual and product intent.

Relevant source documents:

- `docs/design/2026-05-26-codex-session-observability-dashboard.md` defines the local Codex data sources, observed schemas, normalized dashboard entities, privacy requirements, and ingestion recommendations.
- `docs/design/workflowkit-evangelion/Engineering Handoff.html` defines the intended Observatory product, five required views, field mappings, visual system, acceptance expectations, and a recommended ingest-worker contract.
- `docs/design/workflowkit-evangelion/Observatory.html`, `styles.css`, `mock.js`, `ui.jsx`, `app.jsx`, and `tweaks-panel.jsx` provide a direct-editable prototype that should be ported into TypeScript modules rather than treated as production architecture.

The dashboard reads four local Codex surfaces:

- `~/.codex/state_5.sqlite` for the fast session index, thread metadata, and `thread_spawn_edges`.
- `~/.codex/sessions/**/*.jsonl` for detailed rollout transcripts, turns, messages, tool calls, token snapshots, and sub-agent launch/wait events.
- `~/.codex/logs_2.sqlite` for structured runtime diagnostics.
- `~/.codex/log/codex-tui.log` as an advanced raw-tail fallback only.

The product surface has five required views:

- Sessions
- Timeline
- Agent Graph
- Tokens
- Diagnostics

Human decisions already made:

- Runtime architecture is Vite + React frontend with a read-only local Node ingest/API for v0.1.
- The backend/frontend boundary should remain compatible with a future Tauri IPC bridge.
- Tauri packaging is not part of v0.1.

## Non-Goals

- No writes to `state_5.sqlite`, `logs_2.sqlite`, rollout JSONL files, `codex-tui.log`, or any Codex-owned source.
- No telemetry, cloud sync, sharing, export buttons, or remote API access in v0.1.
- No Tauri packaging, native menu, native installer, updater, or signed desktop build in v0.1.
- No mutation of raw source data for redaction; redaction applies only to previews and rendered derived fields.
- No full-text indexing of every tool output by default.
- No attempt to stabilize Codex private storage formats beyond defensive parsing and schema/version checks.
- No background backfill job that eagerly parses all rollout files before the app is usable.
- No implementation-plan task checklist in this document.

## Proposed Architecture

Bootstrap a small monorepo-style TypeScript app with separate frontend, local API, shared contract, and parser/cache modules. The frontend is a Vite + React 18 application that owns rendering, navigation, view state, filtering, virtualization, and privacy-conscious previews. The local Node process owns all filesystem, SQLite, JSONL parsing, live-tail, and cache access. The two sides communicate through a narrow typed RPC/HTTP contract whose method names mirror the future Tauri IPC surface.

The local API is the only process allowed to read `~/.codex`. It opens SQLite databases in read-only mode, keeps persistent read-only connections, streams rollout files line by line, maintains a derived cache keyed by file path, mtime, and size, and exposes only normalized dashboard entities to the UI. This keeps the browser bundle free of Node-only dependencies and makes the future Tauri migration a transport swap rather than a data-model rewrite.

`state_5.sqlite.threads` drives the Sessions view and app header counts. Session listing must not parse JSONL on the render path. `thread_spawn_edges` is joined into list rows for child/open-child counts and powers the Agent Graph. Rollout JSONL is parsed lazily when a session detail view is opened, then cached under an app-owned cache directory such as `~/.codex/.observatory/cache/v1/`. `logs_2.sqlite` is queried on demand for Diagnostics and asynchronously for warning badges after Sessions has painted.

The prototype UI should be ported, not embedded. `styles.css` becomes the seed for app-level CSS variables, palette channels, dense table treatment, panels, and reduced-motion behavior. `app.jsx`, `ui.jsx`, and `tweaks-panel.jsx` become typed React modules. `mock.js` becomes fixture data for tests and Storybook-like local development states, not a runtime dependency. The five views retain the prototype's core interactions: row click opens Timeline, graph node navigation, token chart drill-down, diagnostics filters, collapsed tool output, and raw-log access behind an advanced control.

Privacy and safety are enforced at the API and UI boundary. The parser preserves raw values internally only long enough to derive facts, but API responses should default to preview fields with secret-like values redacted. Raw transcript, base instructions, and large tool outputs require explicit user expansion in the UI. This protects accidental display without changing source files or pretending the raw local data is sanitized.

## Human Decisions

| Decision | Options Considered | Chosen Option | Rationale |
| --- | --- | --- | --- |
| Runtime boundary | Browser-only app reading files indirectly; Vite + React with local Node API; Tauri-first desktop shell | Vite + React with read-only local Node ingest/API for v0.1 | Already decided by the human; gives fast browser development while preserving a future IPC boundary. |
| Initial data source for Sessions | Parse rollout JSONL index; query `state_5.sqlite.threads`; scan filesystem names | Query `state_5.sqlite.threads` | Meets <200ms target for 500 rows and matches observed Codex indexing. |
| Detail loading | Eagerly parse all JSONL; lazy parse selected sessions; parse directly in browser | Lazy parse selected sessions in Node API | Avoids UI thread stalls and keeps first paint fast. |
| Parsed rollout cache | No cache; in-memory cache only; disk cache keyed by source path/mtime/size | Disk cache keyed by path, mtime, and size, with in-memory hot entries | Required by performance constraints and supports warm detail loads across app restarts. |
| Diagnostics source | Raw `codex-tui.log`; `logs_2.sqlite`; both equally | `logs_2.sqlite` primary, raw TUI log as advanced fallback | Structured logs are queryable by `thread_id`; raw log is noisy and privacy-sensitive. |
| Redaction behavior | Alter source data; hide all sensitive rows; redact rendered previews only | Redact previews only, never source data | Preserves read-only auditability while reducing accidental secret exposure. |
| Base instructions display | Show inline; omit entirely; hide by default with explicit reveal | Hide by default with explicit reveal and warning | Satisfies privacy constraints while preserving debugging access. |
| Tauri compatibility | Ignore until packaging; design typed transport abstraction now | Design typed transport abstraction now | Avoids coupling React views to HTTP details and keeps the future Tauri bridge low-risk. |
| Session file actions | Launch local editor; reveal/copy source path only; no file affordance | Reveal/copy source path only | Human clarified v0.1 is read-only. Launching an editor or shell command is outside the safety boundary. |

## Responsibilities

- `package.json`, `tsconfig*.json`, `vite.config.ts`, and root scripts own the new app bootstrap, development commands, lint/typecheck/test commands, and local API launch wiring.
- `src/frontend/main.tsx` owns React app startup and transport initialization.
- `src/frontend/App.tsx` owns app shell layout, persistent top hazard strip and status bar chrome, primary view routing, selected session state, global loading/error surfaces, and view-level data prefetch.
- `src/frontend/views/SessionsView.tsx` owns the session table, explicit `SessionFilter` state, search over title/first message/full id, row selection, token threshold rendering, async warning and failed-tool badge display, and windowed rendering when row count grows.
- `src/frontend/views/TimelineView.tsx` owns normalized timeline rendering, turn grouping, tab filters, collapsed tool output, sub-agent links, failed command highlighting, live-tail append behavior, and the non-interactive v0.1 `TimelineScrubber`.
- `src/frontend/views/AgentGraphView.tsx` owns rendering parent/child relationships from `AgentGraph`, node selection, inspector state, open-child highlighting, and navigation to Timeline.
- `src/frontend/views/TokensView.tsx` owns token snapshot charts, cached-input ratio empty states, rate-limit meters, context-window utilization, and top-token session drill-down.
- `src/frontend/views/DiagnosticsView.tsx` owns log filtering, target selection, thread/all scope, tail mode, loudest-thread navigation, failed command panels, and raw TUI log access behind an advanced control.
- `src/frontend/components/*` owns shared view primitives ported from the prototype: panels, segmented bars, readouts, badges, hazard strips, tables, graph cards, tool-output previews, and redaction-aware text blocks.
- `src/frontend/styles/*` owns CSS variables, palette channels, typography, density, focus states, reduced-motion behavior, and responsive constraints derived from `docs/design/workflowkit-evangelion/styles.css`. Component CSS must use design tokens rather than raw hex values, preserve palette-channel overrides, use square 1px panel/table borders unless a component explicitly requires otherwise, define uppercase chrome/tracking rules, and apply tabular numeric rendering to IDs, counts, timestamps, token totals, and timecodes.
- `src/shared/contracts.ts` owns the transport-neutral request/response types, normalized entities, filter types, pagination types, and error envelope used by frontend and backend.
- `src/shared/redaction.ts` owns deterministic preview redaction for secret-like values, including AWS-style keys, JWT-like tokens, bearer/basic token headers, private key blocks, common `*_TOKEN`/`*_SECRET`/`*_KEY` environment assignments, and long opaque hex/base64 strings.
- `src/backend/server.ts` owns the v0.1 local HTTP server and ingest-worker process boundary: local-only binding, route registration, request validation, CORS restrictions for the Vite origin, source watchers, debounce scheduling, and lifecycle management.
- `src/backend/api/*` owns route handlers for sessions, thread details, tailing, logs, diagnostics summaries, and raw log access.
- `src/backend/codexPaths.ts` owns `$CODEX_HOME` resolution, defaulting to `~/.codex`, path normalization, allowlisted source paths, and protection against path traversal.
- `src/backend/sqlite/stateStore.ts` owns read-only access to `state_5.sqlite`, including WAL-compatible read connection setup, schema compatibility checks, session list queries, session lookup, and thread spawn edge queries.
- `src/backend/sqlite/logStore.ts` owns read-only access to `logs_2.sqlite`, including WAL-compatible read connection setup, filtered log queries, warning counts, target summaries, process/thread scopes, and diagnostics pagination.
- `src/backend/rollout/jsonlStream.ts` owns streaming line reads, incremental byte-offset reads, malformed-line handling, file stat collection, and chunk sizing.
- `src/backend/rollout/parseRollout.ts` owns conversion from raw JSONL events to `Turn`, `TimelineEvent`, `Message`, `ToolCall`, `ToolResult`, `TokenSnapshot`, agent launch/wait facts, failed tool facts, and summary fields.
- `src/backend/cache/rolloutCache.ts` owns cache lookup, cache invalidation by path/mtime/size, append-only tail updates, cache versioning, and atomic writes to the dashboard-owned cache directory.
- `src/backend/tail/liveTail.ts` owns polling or watch-backed live tail by byte offset for selected rollout files and the capped recent-row buffer.
- `src/backend/diagnostics/rawTuiLog.ts` owns advanced raw-tail reads from `~/.codex/log/codex-tui.log`.
- Shared contract: all UI data crosses through `ObservatoryApi`, a transport-neutral interface with methods matching `listSessions`, `getThread`, `getTimeline`, `getAgentGraph`, `getTokenSeries`, `queryLogs`, `getDiagnosticsSummary`, `tailThread`, and `tailRawLog`.

## Data Flow / Control Flow

1. The developer starts the Vite frontend and local Node API together. The API binds only to localhost and resolves `$CODEX_HOME`, defaulting to `~/.codex`.
2. On app load, the frontend calls `listSessions(filter)` through `ObservatoryApi`.
3. The API queries `state_5.sqlite.threads`, left-joins or separately aggregates `thread_spawn_edges`, returns normalized `SessionSummary` rows, and does not touch JSONL during first paint.
4. The frontend renders Sessions immediately, using fixed column widths and virtualization when needed.
5. After first paint, the frontend requests lightweight async diagnostics badges, such as warning counts by visible `thread_id`, without letting late values resize columns.
6. When a user opens a session detail view, the frontend calls `getTimeline(threadId)` or a view-specific detail method.
7. The API resolves the session's `rollout_path` from `state_5.sqlite`, stats the file, checks `rolloutCache`, and stream-parses only when the cache key is absent or stale.
8. The parser reads JSONL line by line, normalizes events, joins `function_call` and `function_call_output` by `call_id`, groups turn facts, derives durations and failed tools, extracts token snapshots, and redacts preview fields before returning them.
9. Timeline, Tokens, and Agent Graph render from the normalized detail model. Agent Graph enriches `thread_spawn_edges` with child session metadata and optionally final report previews from cached child rollouts when already available.
10. Diagnostics calls query `logs_2.sqlite` by selected `thread_id`, level, target, and pagination cursor. Raw `codex-tui.log` tail is only read after explicit advanced-mode activation.
11. For an active selected session, the frontend calls `tailThread(threadId, fromByte)` on a timer or subscribes through a server-sent/event-stream-like transport. The backend reads from the last byte offset, parses only appended complete lines, updates the cache, and returns newly normalized events plus the next offset.
12. If source files are unavailable, locked, malformed, or schema-incompatible, the API returns a typed partial-data error. The UI renders available panels with clear local failure states instead of blanking the whole dashboard.

## Integration Points

### API / Transport

The v0.1 transport can be local HTTP for Vite development, but the interface should be defined as an implementation-agnostic TypeScript client:

| Method | Purpose | Primary Source |
| --- | --- | --- |
| `getHealth()` | Confirm API, paths, source availability, schema checks | Filesystem, SQLite pragmas |
| `listSessions(filter, page)` | Fast sessions table and header stats | `state_5.sqlite.threads`, `thread_spawn_edges` |
| `getThread(threadId)` | Full session metadata and source paths | `state_5.sqlite.threads` |
| `getTimeline(threadId, options)` | Timeline events, turns, tool joins, token snapshots, summary | Rollout JSONL cache/parser |
| `getAgentGraph(rootThreadId, options)` | Parent/child tree with child metadata | `thread_spawn_edges`, `threads`, optional rollout cache |
| `getTokenSeries(threadId)` | Token and rate-limit snapshots | Rollout JSONL cache/parser |
| `getDiagnosticsSummary(filter)` | Warning counts, loudest targets, failed command summary | `logs_2.sqlite`, rollout cache |
| `queryLogs(filter, page)` | Structured runtime log rows | `logs_2.sqlite.logs` |
| `tailThread(threadId, fromByte)` | Incremental rollout events for live selected session | Rollout file byte offset |
| `tailRawLog(fromByte)` | Advanced raw TUI log tail | `codex-tui.log` |

Responses should use typed envelopes:

```ts
type ApiResult<T> =
  | { ok: true; data: T; warnings?: ApiWarning[] }
  | { ok: false; error: ApiError; partial?: unknown };
```

The future Tauri bridge should implement the same `ObservatoryApi` interface with `invoke()` calls in place of HTTP fetches.

### Ingest Worker

For v0.1, the local Node API process is also the ingest worker. It should keep the browser/UI thread isolated from filesystem, SQLite, cache, and JSONL work while exposing the small `ObservatoryApi` RPC surface over local HTTP. A later desktop build can move the same worker responsibilities behind Tauri IPC without changing view contracts.

Worker obligations:

- Open `state_5.sqlite` and `logs_2.sqlite` with read-only flags and WAL-compatible read behavior, keep one persistent connection per database, and report schema compatibility through `getHealth()`.
- Watch `$CODEX_HOME/sessions/` for changed rollout files where the platform supports it, with a 250ms debounce before cache invalidation or tail parsing. Polling by stat is acceptable as a fallback when file watching is unavailable.
- Parse only opened or tailed threads into the derived cache; do not eagerly backfill every historical rollout before the app is usable.
- Use the RPC-equivalent methods `listSessions(filter)`, `getThread(id)`, `tailThread(id, fromByte)`, and `queryLogs(filter)` as the stable minimum worker contract.
- Never require the UI thread to parse files above 4MB. The Node worker should stream rollout files above 1MB and page reads in 256KB chunks so the same code path handles both medium and large transcripts.
- Surface worker/cache/source failures as typed partial-data warnings rather than blanking the full app.

### Storage / State

- Source storage remains Codex-owned under `$CODEX_HOME`.
- Dashboard cache is app-owned and versioned, recommended as `$CODEX_HOME/.observatory/cache/v1/`.
- Cache entries are derived, disposable JSON artifacts. They are never canonical and can be deleted without data loss.
- Cache keys include normalized absolute rollout path, file mtime, file size, parser version, and cache schema version.
- App UI state stays client-side: selected view, selected session, filters, sort order, expanded rows, advanced raw mode, and reduced-motion/tweak preferences.

Recommended cached rollout shape:

```ts
interface CachedRolloutFacts {
  version: 1;
  parserVersion: string;
  source: {
    path: string;
    mtimeMs: number;
    size: number;
    parsedThroughByte: number;
  };
  sessionMeta?: SessionMetaPreview;
  turns: Turn[];
  events: TimelineEvent[];
  messages: Message[];
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  tokenSnapshots: TokenSnapshot[];
  agentEvents: AgentLifecycleEvent[];
  summary: RolloutSummary;
}
```

### Configuration

- `$CODEX_HOME` defaults to `~/.codex`.
- Local API host defaults to `127.0.0.1`.
- Local API port may default to a fixed development port with fallback when occupied.
- Cache directory defaults to `$CODEX_HOME/.observatory/cache/v1/`.
- Tool output collapse threshold defaults to 4KB.
- JSONL worker streaming threshold defaults to 1MB.
- JSONL UI-blocking threshold is 4MB: no file above this size may be parsed or synchronously processed on the UI thread.
- JSONL chunk size defaults to 256KB.
- Session file watch debounce defaults to 250ms.
- Live visible row cap defaults to 200.
- Warning-count hydration should be delayed until after Sessions first paint.

### UI

- Use the prototype's five-view navigation and dense instrumentation style as the UX baseline.
- Preserve the five top-level routes/views: `sessions`, `timeline`, `graph`, `tokens`, `diagnostics`.
- Render the top hazard strip and bottom status bar on every primary screen; they are app-shell chrome, not per-view optional decoration.
- Use real tables for session listing with accessible headers and active-row state.
- Collapse tool outputs over 4KB by default and show byte counts before expansion.
- Hide base instructions by default; require an explicit reveal for raw content.
- Render redacted previews in table rows, cards, chart labels, and collapsed output snippets.
- Keep raw values out of tooltips unless the user has explicitly expanded raw mode for that field.
- Session source-file affordances should be limited to copying or revealing the rollout path text in the UI. The app must not launch `$EDITOR`, run `open`, or execute any local command in v0.1.
- Gate scanlines, blinking, ticker motion, graph pulses, and live-tail autoscroll behavior behind reduced-motion handling.

### Design System Constraints

- Component styles must use CSS custom properties from the palette system; raw hex values are limited to token definitions and palette overrides.
- Every palette channel must define `--primary`, `--primary-bright`, ink tokens, and rule tokens so palette swap is one root attribute change.
- Panels, tables, chips, and readouts should use square corners and 1px borders by default, matching the prototype's industrial instrumentation style.
- Typography roles are explicit: display font for major readouts and chrome labels, monospace for tables/logs/IDs/timestamps, Japanese serif only where the prototype uses Japanese support text.
- Header/status chrome uses uppercase labels, controlled letter spacing, and tabular numerals for counts, IDs, timecodes, token totals, and rate-limit values.
- The token SegBar warning threshold is `tokensUsed > 100000` for session rows, matching the handoff acceptance gate.

### Accessibility Obligations

- Text color usage must preserve the handoff contrast targets: `ink-strong` on `bg-0` at AAA contrast and `ink-dim` only for secondary text, never primary body text.
- All buttons and clickable table rows must have visible 1px primary focus rings with 2px offset.
- Session table headers must use `scope="col"` and active rows must set `aria-current="true"`.
- Hazard tape, reticles, brackets, decorative status dots, and scanline/chrome decorations must be `aria-hidden` when they do not communicate unique state.
- Reduced-motion users must not receive blink, pulse, ticker, scanline animation, graph edge pulse, or forced live-tail autoscroll behavior.

## Data Contracts

### SessionFilter

`SessionFilter` is accepted by `listSessions(filter, page)` and must compose all active axes before sorting:

- `search`: substring match over `threads.title`, `threads.first_user_message`, `threads.preview`, and full `threads.id`.
- `cwd`: exact repo/worktree path, with UI labels allowed to shorten `$HOME` to `~`.
- `dateRange`: `updatedAtMs` or `createdAtMs` range, with `updatedAtMs` as the default sessions view axis.
- `threadSource`: `all | user | subagent`.
- `agentRole`: exact role for sub-agent rows, with `all` as default.
- `model`: exact model name, with `all` as default.
- `archived`: `include | exclude | only`, defaulting to `exclude`.
- `hasWarnings`: `all | yes | no`, backed by async warning-count hydration when not already cached.
- `hasFailedTools`: `all | yes | no`, backed by parsed rollout facts when available and marked `unknown` when not yet parsed.
- `minTokens` and `maxTokens`: numeric thresholds over `threads.tokens_used`.

### SessionSummary

`SessionSummary` is returned by `listSessions` and must be enough for the first paint:

- `id`
- `rolloutPath`
- `createdAtMs`
- `updatedAtMs`
- `cwd`
- `repoLabel`
- `titlePreview`
- `firstUserMessagePreview`
- `preview`
- `model`
- `reasoningEffort`
- `tokensUsed`
- `threadSource`
- `agentNickname`
- `agentRole`
- `gitSha`
- `gitBranch`
- `gitOriginUrlPreview`
- `archived`
- `childCount`
- `openChildCount`
- `warningCountStatus`: `not_requested | loading | ready | unavailable`
- `warningCount`
- `failedToolCountStatus`: `not_requested | loading | ready | unavailable | unknown`
- `failedToolCount`

Title/brief rendering should use `threads.title`, then `threads.first_user_message`, then `threads.preview` as the fallback sequence. Failed-tool filtering is exact only after a rollout has parsed; before that, rows may expose `failedToolCountStatus: unknown` and the UI must communicate that the failed-tool filter is based on indexed/cached facts rather than a fresh full-transcript scan.

### TimelineEvent

`TimelineEvent` is the UI-facing union produced from rollout JSONL:

- `task_started`
- `task_complete`
- `turn_context`
- `user_message`
- `assistant_message`
- `agent_message`
- `reasoning`
- `tool_call`
- `tool_result`
- `token_snapshot`
- `agent_launch`
- `agent_wait`
- `warning`
- `parse_error`

Every event has `threadId`, `timestamp`, `turnId` when known, `sourceLine`, `kind`, `severity`, and `previewText`. Tool-related events also include `callId`, `toolName`, redacted `argumentsPreview`, `outputPreview`, `outputBytes`, `exitCode` when extractable, `durationMs` when joinable, `isCollapsedByDefault`, and `hasRawAvailable`.

### TimelineScrubber

`TimelineScrubber` is derived from `TimelineEvent[]` plus the selected turn/session summary. It is a non-interactive v0.1 overview strip, not a seek control.

Inputs:

- `events`: at least the visible timeline event set, preserving event `timestamp`, `kind`, `severity`, and stable event id/source line.
- `startedAtMs` and `endedAtMs`: from the selected turn or from first/last event timestamps when turn bounds are unavailable.
- `durationMs` and `ttftMs`: displayed in the scrubber header when available.
- `kindColor`: deterministic mapping from event kind to token color, using user/message cyan, tool amber, warnings/failures warn red, agent reports good, token snapshots primary, and task completion ink-strong.

Rendering obligations:

- Show at least 20 event ticks when the selected session has 20 or more events.
- Position ticks by normalized timestamp across the selected span.
- Use the same kind-color mapping as timeline rows.
- Avoid layout overlap by allowing dense ticks to collapse to 1-2px width.
- Do not implement drag, seek, or click navigation in v0.1.

### AgentGraph

`AgentGraph` contains:

- `root: AgentNode`
- `nodes: AgentNode[]`
- `edges: AgentEdge[]`
- `maxDepth`
- `truncatedDepth: boolean`
- `openCount`
- `statusSummary`

Depth 2 should be the default fetch for v0.1, with a visible indicator when deeper descendants exist. The data contract should allow deeper fetches later without changing the view model.

### TokenSeries

`TokenSeries` contains:

- raw `TokenSnapshot[]`
- aggregate totals by input, cached input, output, reasoning output, and total
- context-window utilization per snapshot when `model_context_window` is populated
- cached-input ratio only when both numerator and denominator are valid
- primary and secondary rate-limit percent plus reset time when present
- empty-state reasons for missing token snapshots or incomplete ratio fields

### RuntimeLog

`RuntimeLog` contains:

- `id`
- `timestampMs`
- `level`
- `target`
- `bodyPreview`
- `modulePath`
- `file`
- `line`
- `threadId`
- `processUuid`
- `estimatedBytes`
- `redactionApplied`

The API should page logs by cursor using `(ts, ts_nanos, id)` ordering rather than offset for large result sets.

## Parsing And Cache Strategy

Rollout parsing should be streaming and tolerant. Each line is parsed independently; malformed lines become `parse_error` events with line number and preview. Parser failures in one line must not discard the rest of the file. Unknown event types should be retained as generic transcript events so schema drift remains visible.

The parser should normalize observed JSONL types:

- `session_meta` for session identity, cwd, git context, source/sub-agent metadata, and hidden base instruction presence.
- `turn_context` for sandbox, approval, model, effort, date/timezone, permission profile, realtime state, and collaboration mode.
- `event_msg.task_started`, `event_msg.user_message`, `event_msg.agent_message`, `event_msg.token_count`, and `event_msg.task_complete`.
- `response_item.message`, `response_item.reasoning`, `response_item.function_call`, and `response_item.function_call_output`.

Function calls and outputs are joined by `call_id`. Duration is derived by subtracting the call timestamp from the output timestamp when both exist. Exit codes are extracted only from structured output fields or known shell/tool wrappers; otherwise they remain unknown. Failed shell command detection is best-effort and should be marked as derived.

Sub-agent launches are detected from parent rollout `function_call` events named `spawn_agent` and `wait_agent`, then reconciled with `thread_spawn_edges` and child `session_meta.source.subagent.thread_spawn` when available. `thread_spawn_edges` remains the canonical graph source; rollout-derived launch facts enrich the timeline.

Cache invalidation:

- Reuse cache when path, mtime, size, parser version, and cache schema version match.
- For append-only active rollouts, read only bytes after `parsedThroughByte` when file size increased and mtime changed.
- If file size shrinks or path changes, discard and rebuild that cache entry.
- Cache writes should be atomic via temp file plus rename.
- Cache read errors should fall back to cold parse and report a warning, not fail the detail view.

## Privacy And Security

The local API must bind to loopback only and should reject non-local origins in development. It should never expose arbitrary file reads. All file access starts from `$CODEX_HOME` plus the rollout path recorded in `state_5.sqlite.threads`, and path normalization must prevent traversal outside the allowlisted Codex source paths.

The backend opens SQLite databases with read-only flags and never runs write statements. Application code should not execute user-provided SQL. Filters are parameterized and constrained to known fields.

Preview redaction is mandatory for:

- tool arguments
- tool output previews
- message previews in lists
- log body previews
- git remote URLs when they contain credentials
- environment-like assignments
- raw TUI log previews

Base instructions are not included in default session detail payloads. The API may expose a `baseInstructionsAvailable` boolean and a separate explicit raw retrieval method in the future, but v0.1 should prefer a UI reveal path that is visibly sensitive and off by default.

Large tool outputs are collapsed by default. Expanding an output should request or reveal the raw local content intentionally, with the collapsed header showing tool name, exit status, duration, byte count, and redacted preview.

No telemetry, export, external fonts loaded at runtime, remote assets, command execution, or editor-launch behavior should be introduced in v0.1. If the prototype's Google Fonts are desired, they should be self-hosted or replaced with local/system font stacks during implementation.

"Open in editor" from the prototype/handoff should be redesigned as a read-only copy/reveal path action. The local API must not expose command execution or editor-launch endpoints in v0.1.

## Performance Strategy

Sessions first paint must stay under 200ms for 500 rows. The design supports this by querying only `state_5.sqlite.threads` and `thread_spawn_edges` aggregates for the initial list, preallocating columns for async warning and failed-tool counts, and using windowed rendering if the result set grows beyond 500 rows or rendering measurements show table paint regressions.

JSONL parsing happens in the Node ingest worker, never in the browser UI thread. Files larger than 1MB should stream in chunks and report progress or partial loading states if detail rendering exceeds expected latency. Files larger than 4MB are forbidden from any synchronous UI-thread parsing path. The API should avoid reading whole transcripts into memory just to split lines.

SQLite access uses one read-only connection per database per API process, not one connection per query. Queries should follow existing indexes:

- `threads.updated_at_ms` / `threads.created_at_ms` for ordering.
- `threads.archived, cwd, updated_at_ms` for filtered session lists.
- `thread_spawn_edges.parent_thread_id, status` for graph and child counts.
- `logs.thread_id, ts, ts_nanos, id` for thread diagnostics.
- `logs.ts, ts_nanos, id` for global diagnostics.

Live tail uses byte offsets. The backend returns complete parsed appended lines plus the next byte offset. The UI caps visible live rows at 200 and keeps scroll stable unless the user is already at the bottom.

## Error Handling

The API returns typed errors with source, code, user-safe message, and optional diagnostic details:

- `CODEX_HOME_MISSING`
- `STATE_DB_MISSING`
- `LOGS_DB_MISSING`
- `SQLITE_OPEN_FAILED`
- `SCHEMA_UNSUPPORTED`
- `THREAD_NOT_FOUND`
- `ROLLOUT_MISSING`
- `ROLLOUT_PARSE_PARTIAL`
- `CACHE_READ_FAILED`
- `CACHE_WRITE_FAILED`
- `RAW_LOG_UNAVAILABLE`

Views should render partial data when possible. For example, Sessions can render without warning badges, Timeline can render with parse-error rows, Tokens can show an empty state when no token snapshots exist, Agent Graph can render database edges without final report previews, and Diagnostics can show rollout-derived failed tools even if `logs_2.sqlite` is missing.

## Sequencing

1. Bootstrap the TypeScript/Vite/React app, local Node API, shared contracts, development scripts, and fixture-driven UI shell using the prototype as the visual reference.
2. Establish the read-only Codex source layer with `$CODEX_HOME` resolution, SQLite connection management, schema checks, session queries, spawn-edge queries, and the fast Sessions view.
3. Add rollout streaming, parsing, cache invalidation, and Timeline rendering with collapsed/redacted tool outputs, joined tool calls/results, and the non-interactive `TimelineScrubber`.
4. Add Agent Graph and Tokens from the same normalized parsed facts, including depth-limited graph fetches, token empty states, and rate-limit displays.
5. Add structured Diagnostics from `logs_2.sqlite`, async warning badges, failed command summaries, and advanced raw `codex-tui.log` tail.
6. Harden performance, privacy, accessibility, and error handling against large transcripts, missing files, schema drift, reduced motion, and source-lock scenarios.

## Verification Strategy

- Unit:
  - Parser fixtures for `session_meta`, `turn_context`, `event_msg` variants, `response_item` variants, malformed lines, unknown event types, joined tool calls/results, token snapshots, and sub-agent launch/wait events.
  - Redaction fixtures for common secret-like values, credentials in URLs, JWT-like strings, private-key blocks, environment assignments, and non-secret false positives.
  - Cache key and invalidation tests for unchanged files, append-only growth, truncation, mtime changes, parser version changes, and corrupt cache files.
  - Query builder tests that verify parameterized `SessionFilter` axes, failed-tool status handling, and expected ordering without user-provided SQL.
- Integration:
  - Temporary `state_5.sqlite` and `logs_2.sqlite` fixtures with observed table shapes, indexes, parent/child edges, warning logs, and missing optional rows.
  - Temporary rollout JSONL trees that exercise lazy parse, warm cache, tail-by-offset, and partial parse failures.
  - Local API route tests for success, partial data, missing source files, unsupported schema, and local-only path validation.
- UI/manual:
  - Sessions renders 500 fixture rows in under 200ms on the target development machine; search and every `SessionFilter` axis compose without layout flash.
  - Opening the largest available rollout renders cold under the accepted threshold and warm under the accepted threshold.
  - Timeline collapses outputs over 4KB, expands intentionally, shows redacted previews, joins tool results by `call_id`, and renders at least 20 scrubber ticks with the same kind colors as timeline rows when enough events exist.
  - Agent Graph renders root, depth 1, and depth 2 without overlapping in common fixture sizes, with a deeper-depth indicator when needed.
  - Tokens renders real token snapshots and empty states for missing cached-ratio fields.
  - Diagnostics filters by level, target, and scope; raw tail remains hidden until advanced mode.
  - Reduced-motion mode disables blink, pulse, ticker, scanline motion, and autoscroll surprises.
- Regression:
  - Snapshot or DOM tests for the five required views with fixture data.
  - Accessibility checks for `scope="col"` table headers, buttons, focus states, `aria-current` row indicators, contrast targets, reduced motion, and `aria-hidden` decorative hazard/reticle/bracket/status elements.
  - Performance regression checks for first paint, JSONL parse memory behavior, and live-tail row caps.
  - Privacy regression checks ensuring base instructions are absent from default payloads and preview redaction runs before render.

## Risks And Tradeoffs

- Codex storage schemas are private and may drift. Mitigation: schema checks, typed partial errors, unknown-event preservation, and parser fixtures based on observed source samples.
- `logs_2.sqlite` may be large and actively written by Codex. Mitigation: read-only persistent connection, indexed cursor queries, small page sizes, and graceful handling of open/lock failures.
- Warning badges can become expensive if queried per row. Mitigation: batch visible thread IDs, hydrate after first paint, cache counts briefly, and avoid diagnostics work on the initial list path.
- Rollout files may contain sensitive prompts, tool outputs, source snippets, or credentials. Mitigation: local-only API, preview redaction, default collapse, base-instruction hiding, and no export/telemetry.
- Disk cache under `~/.codex` introduces new app-owned files. Mitigation: keep cache under `.observatory/cache/v1`, make it disposable, never mix it with Codex canonical state, and document cache deletion safety.
- Future Tauri IPC could diverge from v0.1 HTTP if view code imports fetch directly. Mitigation: all frontend code depends on `ObservatoryApi`, not the concrete transport.
- The prototype's visual effects can hurt accessibility or responsiveness. Mitigation: reduced-motion gates, accessible tables/buttons, fixed layout constraints, and performance measurement before shipping.
- Depth-limited graph rendering may hide deep sub-agent trees. Mitigation: show `truncatedDepth` and allow deeper fetches later through the existing contract.
- Raw expansion features can accidentally expose sensitive data on screen. Mitigation: keep raw controls explicit, scoped, and visually marked as sensitive; keep default views preview-only.

## Open Questions

- The Codex schemas are observed from local files as of 2026-05-26, but they are not public/stable APIs. Implementation should confirm schema compatibility at startup and define the minimum supported schema version behavior.
- The exact local API port and dev-server orchestration are not specified. The design assumes localhost-only with a fixed default plus occupied-port fallback.
- Multiple `$CODEX_HOME` roots are out of scope for this design. The implementation should expose configuration in a way that does not block a future multi-root selector.
- Raw base-instruction retrieval is intentionally not part of default payloads. Whether v0.1 includes an explicit reveal endpoint can be deferred to implementation planning because the safe default is already defined.

## Handoff To Implementation Plan

When this design is approved, use `$implementation-plans` to turn the sequencing into task-level work.
