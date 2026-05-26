# Codex Session Observability Dashboard Spec

**Date:** 2026-05-26

**Goal:** Define the local Codex data sources and dashboard-facing data model needed to oversee Codex sessions, sub-agents, tool activity, token usage, and runtime diagnostics.

**Scope:** This spec documents the observed local storage format on this machine under `/Users/adam/.codex`. It is intended to guide a WorkflowKit dashboard implementation. It does not assume these files are stable public APIs.

## Data Sources

Codex observability is stored across four primary local surfaces:

- `/Users/adam/.codex/sessions/**/*.jsonl` - per-session rollout transcripts, grouped by date.
- `/Users/adam/.codex/state_5.sqlite` - structured thread/session metadata and agent relationships.
- `/Users/adam/.codex/logs_2.sqlite` - structured runtime logs.
- `/Users/adam/.codex/log/codex-tui.log` - raw TUI/runtime text log.

The recommended dashboard architecture should treat `state_5.sqlite` as the fast session index, the rollout JSONL files as the source of detailed session timelines, and `logs_2.sqlite` as the operational diagnostics source.

## Session Rollout JSONL

Rollout files live under `/Users/adam/.codex/sessions/YYYY/MM/DD/` and are named like:

```text
rollout-2026-05-26T12-53-43-019e656b-c986-7711-9a53-1542d2587865.jsonl
```

Each line is a typed JSON event:

```json
{
  "timestamp": "2026-05-26T17:54:30.295Z",
  "type": "session_meta",
  "payload": {}
}
```

Observed top-level event types:

| Event Type | Purpose | Dashboard Use |
| --- | --- | --- |
| `session_meta` | Session identity and initial environment | Header metadata, repo/cwd, git context, sub-agent source |
| `turn_context` | Per-turn execution context | Approval/sandbox/model state by turn |
| `event_msg` | UI/session lifecycle events | User messages, task lifecycle, token snapshots, agent reports |
| `response_item` | Model stream and tool activity | Assistant messages, reasoning records, tool calls/results |

### `session_meta`

`session_meta` records the stable identity and launch context for a thread:

- `payload.id`
- `payload.timestamp`
- `payload.cwd`
- `payload.originator`
- `payload.cli_version`
- `payload.source`
- `payload.thread_source`
- `payload.model_provider`
- `payload.git.commit_hash`
- `payload.git.branch`
- `payload.git.repository_url`
- `payload.base_instructions.text`

For sub-agent sessions, `payload.source` is an object with a `subagent.thread_spawn` payload:

```json
{
  "source": {
    "subagent": {
      "thread_spawn": {
        "parent_thread_id": "019e5b00-cdc7-7110-bf5e-d46c30637edc",
        "depth": 1,
        "agent_path": null,
        "agent_nickname": "Socrates",
        "agent_role": "worker"
      }
    }
  },
  "thread_source": "subagent"
}
```

Dashboard implications:

- Use `id` as the canonical session/thread id.
- Use `cwd` and `git` fields to group sessions by repo/worktree.
- Use `thread_source` and `source.subagent.thread_spawn` to identify sub-agent sessions.
- Do not display full `base_instructions.text` by default; it is large and may contain sensitive or noisy content.

### `turn_context`

`turn_context` records the execution context for a turn:

- `turn_id`
- `cwd`
- `current_date`
- `timezone`
- `approval_policy`
- `sandbox_policy`
- `permission_profile`
- `model`
- `personality`
- `effort`
- `realtime_active`
- `collaboration_mode.mode`

Dashboard implications:

- Show sandbox and approval settings prominently for active/high-risk sessions.
- Track model and reasoning effort changes over time.
- Use `turn_id` to group events into turn-level timelines.

### `event_msg`

Observed `event_msg.payload.type` values:

| Payload Type | Purpose | Key Data |
| --- | --- | --- |
| `task_started` | Turn/task started | `turn_id`, `started_at`, context window, collaboration mode |
| `user_message` | User message event | `message`, image/local image metadata |
| `agent_message` | Agent-facing emitted message | `message`, `phase`, memory citation |
| `token_count` | Token and rate-limit snapshot | total usage, last usage, context window, rate limits |
| `task_complete` | Turn/task completed | `turn_id`, final message, duration, time to first token |

Dashboard implications:

- Use `user_message`, `agent_message`, and assistant `message` response items to render conversation chronology.
- Use `token_count` to graph token usage over time.
- Use `task_started` and `task_complete` to compute turn duration and time-to-first-token.
- Treat `agent_message` and `task_complete.last_agent_message` as useful summary surfaces for sub-agent completion reports.

### `response_item`

Observed `response_item.payload.type` values:

| Payload Type | Purpose | Key Data |
| --- | --- | --- |
| `message` | Developer/user/assistant message record | `role`, `phase`, `content` |
| `reasoning` | Reasoning stream artifact | summary/encrypted content fields |
| `function_call` | Tool invocation | `call_id`, `name`, `arguments` |
| `function_call_output` | Tool result | `call_id`, `output` |

Dashboard implications:

- Join `function_call` and `function_call_output` by `call_id`.
- Parse `function_call.arguments` as JSON when possible.
- Track tool durations by subtracting call timestamp from output timestamp.
- Extract failed shell commands from `function_call_output.output` by looking for nonzero process exit codes.
- Do not render full tool output by default; show a preview with expansion because outputs can contain sensitive data.

Sub-agent launches are typed tool calls, not only plain text. In a parent rollout, launches appear as `response_item.payload.type = "function_call"` with names such as:

- `spawn_agent`
- `wait_agent`

The child rollout then records its parent in `session_meta.payload.source.subagent.thread_spawn`.

## `state_5.sqlite`

`state_5.sqlite` is the main structured index over threads, sub-agent relationships, and background jobs.

Observed tables:

- `_sqlx_migrations`
- `threads`
- `thread_dynamic_tools`
- `stage1_outputs`
- `jobs`
- `backfill_state`
- `agent_jobs`
- `agent_job_items`
- `thread_spawn_edges`
- `remote_control_enrollments`

Observed row counts on 2026-05-26:

| Table | Rows |
| --- | ---: |
| `threads` | 673 |
| `thread_spawn_edges` | 428 |
| `remote_control_enrollments` | 1 |
| `backfill_state` | 1 |
| `thread_dynamic_tools` | 0 |
| `stage1_outputs` | 0 |
| `jobs` | 0 |
| `agent_jobs` | 0 |
| `agent_job_items` | 0 |

### `threads`

Schema:

```sql
CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    rollout_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    source TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    cwd TEXT NOT NULL,
    title TEXT NOT NULL,
    sandbox_policy TEXT NOT NULL,
    approval_mode TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    has_user_event INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    git_sha TEXT,
    git_branch TEXT,
    git_origin_url TEXT,
    cli_version TEXT NOT NULL DEFAULT '',
    first_user_message TEXT NOT NULL DEFAULT '',
    agent_nickname TEXT,
    agent_role TEXT,
    memory_mode TEXT NOT NULL DEFAULT 'enabled',
    model TEXT,
    reasoning_effort TEXT,
    agent_path TEXT,
    created_at_ms INTEGER,
    updated_at_ms INTEGER,
    thread_source TEXT,
    preview TEXT NOT NULL DEFAULT ''
);
```

Purpose:

- Fast session listing.
- Maps thread ids to rollout files.
- Stores cwd/repo, title, first user message, model, token total, and agent metadata.

Dashboard use:

- Session list and filters.
- Repo/worktree grouping by `cwd`, `git_branch`, and `git_origin_url`.
- Token-heavy session detection from `tokens_used`.
- Active/recent session ordering from `updated_at_ms`.
- User vs sub-agent classification from `thread_source`, `agent_nickname`, and `agent_role`.

Important indexes:

```sql
CREATE INDEX idx_threads_created_at ON threads(created_at DESC, id DESC);
CREATE INDEX idx_threads_updated_at ON threads(updated_at DESC, id DESC);
CREATE INDEX idx_threads_archived ON threads(archived);
CREATE INDEX idx_threads_source ON threads(source);
CREATE INDEX idx_threads_provider ON threads(model_provider);
CREATE INDEX idx_threads_created_at_ms ON threads(created_at_ms DESC, id DESC);
CREATE INDEX idx_threads_updated_at_ms ON threads(updated_at_ms DESC, id DESC);
CREATE INDEX idx_threads_archived_cwd_created_at_ms ON threads(archived, cwd, created_at_ms DESC, id DESC);
CREATE INDEX idx_threads_archived_cwd_updated_at_ms ON threads(archived, cwd, updated_at_ms DESC, id DESC);
```

### `thread_spawn_edges`

Schema:

```sql
CREATE TABLE thread_spawn_edges (
    parent_thread_id TEXT NOT NULL,
    child_thread_id TEXT NOT NULL PRIMARY KEY,
    status TEXT NOT NULL
);
```

Purpose:

- Records parent/child thread relationships for sub-agents.
- `status` values observed include `open` and `closed`.

Dashboard use:

- Agent graph.
- Parent session detail.
- Open sub-agent monitoring.
- Child session drill-down links.

Important index:

```sql
CREATE INDEX idx_thread_spawn_edges_parent_status
    ON thread_spawn_edges(parent_thread_id, status);
```

### `thread_dynamic_tools`

Schema:

```sql
CREATE TABLE thread_dynamic_tools (
    thread_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    input_schema TEXT NOT NULL,
    defer_loading INTEGER NOT NULL DEFAULT 0,
    namespace TEXT,
    PRIMARY KEY(thread_id, position),
    FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
```

Purpose:

- Stores per-thread dynamic tool definitions.

Dashboard use:

- Show which tool surfaces were available to a session.
- Enable tool capability audits.

Current observation:

- No rows were present on 2026-05-26.

### `stage1_outputs`

Schema:

```sql
CREATE TABLE stage1_outputs (
    thread_id TEXT PRIMARY KEY,
    source_updated_at INTEGER NOT NULL,
    raw_memory TEXT NOT NULL,
    rollout_summary TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    rollout_slug TEXT,
    usage_count INTEGER,
    last_usage INTEGER,
    selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
    selected_for_phase2_source_updated_at INTEGER,
    FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
```

Purpose:

- Appears intended for generated memory/summary artifacts derived from rollout files.

Dashboard use:

- Future summary cards if populated.
- Memory/summary reuse analytics.

Current observation:

- No rows were present on 2026-05-26.

### `jobs` and `backfill_state`

Schema:

```sql
CREATE TABLE jobs (
    kind TEXT NOT NULL,
    job_key TEXT NOT NULL,
    status TEXT NOT NULL,
    worker_id TEXT,
    ownership_token TEXT,
    started_at INTEGER,
    finished_at INTEGER,
    lease_until INTEGER,
    retry_at INTEGER,
    retry_remaining INTEGER NOT NULL,
    last_error TEXT,
    input_watermark INTEGER,
    last_success_watermark INTEGER,
    PRIMARY KEY (kind, job_key)
);

CREATE TABLE backfill_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL,
    last_watermark TEXT,
    last_success_at INTEGER,
    updated_at INTEGER NOT NULL
);
```

Purpose:

- Internal background job and backfill bookkeeping.

Dashboard use:

- Optional health/debug page.
- Backfill stuck/error detection.

### `agent_jobs` and `agent_job_items`

Schema:

```sql
CREATE TABLE agent_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    instruction TEXT NOT NULL,
    output_schema_json TEXT,
    input_headers_json TEXT NOT NULL,
    input_csv_path TEXT NOT NULL,
    output_csv_path TEXT NOT NULL,
    auto_export INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    last_error TEXT,
    max_runtime_seconds INTEGER
);

CREATE TABLE agent_job_items (
    job_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    source_id TEXT,
    row_json TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned_thread_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    reported_at INTEGER,
    PRIMARY KEY (job_id, item_id),
    FOREIGN KEY(job_id) REFERENCES agent_jobs(id) ON DELETE CASCADE
);
```

Purpose:

- Appears intended for batch agent jobs over tabular input/output.

Dashboard use:

- Batch job monitoring if populated.
- Per-item assignment to Codex threads through `assigned_thread_id`.
- Failed item retry visibility.

Current observation:

- No rows were present on 2026-05-26.

### `remote_control_enrollments`

Schema:

```sql
CREATE TABLE remote_control_enrollments (
    websocket_url TEXT NOT NULL,
    account_id TEXT NOT NULL,
    app_server_client_name TEXT NOT NULL,
    server_id TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    server_name TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (websocket_url, account_id, app_server_client_name)
);
```

Purpose:

- Stores enrollment information for remote-control/app-server connectivity.

Dashboard use:

- Optional environment/connectivity panel.
- Server identity and freshness checks.

## `logs_2.sqlite`

`logs_2.sqlite` stores structured runtime logs.

Observed row count on 2026-05-26:

- `406,883` rows from `2026-05-17 17:34:12` through `2026-05-26 17:59:44`.

Observed levels:

- `INFO`
- `TRACE`
- `DEBUG`
- `WARN`

Schema:

```sql
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    ts_nanos INTEGER NOT NULL,
    level TEXT NOT NULL,
    target TEXT NOT NULL,
    feedback_log_body TEXT,
    module_path TEXT,
    file TEXT,
    line INTEGER,
    thread_id TEXT,
    process_uuid TEXT,
    estimated_bytes INTEGER NOT NULL DEFAULT 0
);
```

Purpose:

- Structured TUI/runtime logging.
- Includes session loop spans, model transport events, tool dispatch logs, plugin/skill warnings, and threadless process logs.

Dashboard use:

- Warning/error counts by thread.
- Runtime log panel filtered by `thread_id`.
- Noisy target suppression.
- Operational diagnostics for model transport, plugin loading, and tool dispatch.

Important indexes:

```sql
CREATE INDEX idx_logs_ts ON logs(ts DESC, ts_nanos DESC, id DESC);
CREATE INDEX idx_logs_thread_id ON logs(thread_id);
CREATE INDEX idx_logs_thread_id_ts ON logs(thread_id, ts DESC, ts_nanos DESC, id DESC);
CREATE INDEX idx_logs_process_uuid_threadless_ts
    ON logs(process_uuid, ts DESC, ts_nanos DESC, id DESC)
    WHERE thread_id IS NULL;
```

High-volume observed targets:

- `codex_otel.log_only`
- `codex_otel.trace_safe`
- `codex_api::endpoint::responses_websocket`
- `log`
- `opentelemetry_sdk`
- `codex_api::sse::responses`
- `codex_core_skills::loader`
- `codex_core::stream_events_utils`
- `codex_tui::markdown_stream`
- `codex_core::session::handlers`
- `codex_core::session::turn`

## `codex-tui.log`

`/Users/adam/.codex/log/codex-tui.log` is the raw text runtime log. It contains timestamped tracing lines in a format similar to:

```text
2026-05-26T18:00:21.506457Z INFO session_loop{thread_id=...}:... target: message
```

Purpose:

- Raw fallback log for debugging.
- Contains spans, target modules, tool-call lines, warnings, websocket/client events, plugin loader warnings, and sometimes bulky response bodies.

Dashboard use:

- Tail view for advanced debugging.
- Fallback when structured SQLite logs are incomplete.

Recommended treatment:

- Do not parse this as the primary data source.
- Prefer `logs_2.sqlite` for queryable runtime logs.
- Keep this behind an explicit "raw log" view.

## Dashboard Data Model

Recommended normalized entities:

| Entity | Source | Purpose |
| --- | --- | --- |
| `Session` | `state_5.threads` | Fast thread/session listing |
| `Turn` | JSONL `task_started`, `turn_context`, `task_complete` | Turn-level grouping and duration |
| `TranscriptEvent` | JSONL lines | Raw event replay/debugging |
| `Message` | JSONL `message`, `user_message`, `agent_message` | Conversation transcript |
| `ToolCall` | JSONL `function_call` | Tool invocation record |
| `ToolResult` | JSONL `function_call_output` | Tool output record, joined by `call_id` |
| `TokenSnapshot` | JSONL `token_count` | Token and rate-limit timeline |
| `AgentEdge` | `state_5.thread_spawn_edges` | Parent/child agent graph |
| `RuntimeLog` | `logs_2.logs` | Structured operational diagnostics |

### Session

Fields:

- `id`
- `rollout_path`
- `created_at`
- `updated_at`
- `cwd`
- `title`
- `first_user_message`
- `preview`
- `model`
- `reasoning_effort`
- `tokens_used`
- `thread_source`
- `agent_nickname`
- `agent_role`
- `git_sha`
- `git_branch`
- `git_origin_url`
- `archived`

### Turn

Fields:

- `thread_id`
- `turn_id`
- `started_at`
- `completed_at`
- `duration_ms`
- `time_to_first_token_ms`
- `model`
- `reasoning_effort`
- `approval_policy`
- `sandbox_policy`
- `collaboration_mode`
- `last_agent_message`

### Message

Fields:

- `thread_id`
- `turn_id`
- `timestamp`
- `role`
- `phase`
- `text`
- `source_event_type`

Roles/phases should distinguish:

- user input
- assistant commentary
- assistant final answer
- developer/system context
- agent/sub-agent reports

### ToolCall and ToolResult

Tool call fields:

- `thread_id`
- `turn_id`
- `timestamp`
- `call_id`
- `name`
- `arguments_json`

Tool result fields:

- `thread_id`
- `turn_id`
- `timestamp`
- `call_id`
- `output`
- `exit_code` when extractable
- `duration_ms` when joined to a call
- `output_token_count` when extractable from shell output wrapper

Derived fields:

- failed command boolean
- shell command string
- working directory
- max output tokens
- long-running tool indicator

### TokenSnapshot

Fields:

- `thread_id`
- `turn_id`
- `timestamp`
- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `total_tokens`
- `last_input_tokens`
- `last_output_tokens`
- `model_context_window`
- `primary_rate_limit_used_percent`
- `secondary_rate_limit_used_percent`
- `rate_limit_reset_at`
- `plan_type`

### AgentEdge

Fields:

- `parent_thread_id`
- `child_thread_id`
- `status`
- child thread metadata from `threads`
- child rollout path

Derived fields:

- depth
- open/closed status
- child duration
- child token total
- child final report preview

### RuntimeLog

Fields:

- `id`
- `timestamp`
- `level`
- `target`
- `feedback_log_body`
- `module_path`
- `file`
- `line`
- `thread_id`
- `process_uuid`
- `estimated_bytes`

Derived fields:

- warning count by thread
- noisy target classification
- plugin/skill loader warning count
- model transport event count

## Dashboard Views

### 1. Session Overview

Purpose:

- Show all Codex sessions in one scan-friendly table.

Recommended columns:

- Updated time
- Title / first user message
- CWD / repo
- Git branch
- Model
- Reasoning effort
- Tokens used
- Thread source
- Agent role/nickname
- Child agent count
- Open child agent count
- Runtime warning count

Useful filters:

- Repo/cwd
- Date range
- User session vs sub-agent
- Agent role
- Model
- Archived
- Has warnings
- Has failed tool calls
- Token usage threshold

### 2. Session Timeline

Purpose:

- Explain what happened inside one session.

Timeline should merge:

- user messages
- assistant commentary/final messages
- tool calls
- tool outputs
- token snapshots
- task start/complete events
- sub-agent launch/wait events

Default rendering:

- Collapse large tool outputs.
- Show command exit status and duration.
- Highlight failed commands and warnings.
- Show token deltas at turn boundaries.

### 3. Agent Graph

Purpose:

- Show parent session and spawned child sessions.

Recommended presentation:

- Tree view by `thread_spawn_edges`.
- Parent and child cards with status, role, nickname, duration, token count, and final report preview.
- Open child sessions highlighted.

### 4. Diagnostics

Purpose:

- Debug runtime and tool issues.

Recommended panels:

- Runtime warnings by target.
- Recent logs for current `thread_id`.
- Failed shell commands.
- Plugin/skill loader warnings.
- Model transport events.
- Raw log tail fallback from `codex-tui.log`.

### 5. Token and Rate Limit View

Purpose:

- Understand context and rate-limit pressure.

Recommended charts:

- Total token usage over session time.
- Last-turn token usage.
- Cached input token ratio.
- Reasoning output tokens.
- Context window utilization.
- Rate-limit used percent and reset times.

## Suggested Ingestion Strategy

1. Read `state_5.sqlite.threads` for the initial session list.
2. Read `state_5.sqlite.thread_spawn_edges` for agent relationships.
3. Parse rollout JSONL lazily when a session is opened or when indexing changed sessions.
4. Store parsed JSONL-derived facts in a local dashboard cache to avoid reparsing large transcripts repeatedly.
5. Query `logs_2.sqlite.logs` by `thread_id` only when showing diagnostics or computing warning badges.
6. Treat `codex-tui.log` as a raw tail source, not as the canonical data source.

Change detection:

- Use `threads.updated_at_ms` and rollout file mtime/size.
- Reparse only sessions whose metadata or rollout file changed.
- For active sessions, poll the current rollout file incrementally by byte offset.

## Privacy and Safety

These sources can contain sensitive data:

- user prompts
- assistant responses
- tool arguments
- shell commands
- command output
- file paths
- repository URLs
- environment/context metadata
- copied source snippets
- secrets if they were printed in a session

Dashboard defaults should:

- Hide full tool outputs until expanded.
- Redact obvious tokens/secrets where feasible.
- Avoid displaying full base instructions by default.
- Keep all data local unless explicit export is added.
- Provide a clear "raw data" warning before showing unredacted transcript/log content.

## Open Design Questions

1. Should the first implementation optimize for live supervision or post-run audit/debugging?
2. Should the dashboard maintain its own parsed-event cache, or parse JSONL directly on demand for the first version?
3. Should raw tool outputs be searchable by default, or require an explicit sensitive-data mode?
4. Should open sub-agent status come only from `thread_spawn_edges.status`, or should the dashboard also infer liveness from recent log/transcript activity?
5. Should the dashboard support multiple `$CODEX_HOME` roots, or only `/Users/adam/.codex` initially?

## Recommended Initial Implementation

Build a read-only local dashboard with:

- session overview backed by `state_5.sqlite`
- parent/child agent graph backed by `thread_spawn_edges`
- session timeline backed by parsed rollout JSONL
- token timeline backed by JSONL `token_count` events
- diagnostics badges backed by `logs_2.sqlite`

Defer:

- raw `codex-tui.log` parsing
- batch `agent_jobs` UI until those tables are populated
- dynamic tools UI until `thread_dynamic_tools` has rows
- export/sharing features
- mutation controls for sessions or logs

