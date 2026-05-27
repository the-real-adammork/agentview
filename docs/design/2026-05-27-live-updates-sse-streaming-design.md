# Live Updates via Server-Side File Watching + SSE

- **Date:** 2026-05-27
- **Status:** Design approved, pending spec review
- **Topic:** Push live updates to the AgentView UI without manual refresh

## Problem & Context

Today AgentView is entirely **pull-based**. The React frontend (`src/frontend/api/client.ts`)
calls a read-only HTTP API (`src/backend/server.ts`, `node:http` on `127.0.0.1:4317`) via
`fetch`, triggered by `useEffect` on view/session navigation (`App.tsx:178`, `:206`, `:234`).
The only "live" affordance is a manual **Tail** button that advances a `fromByte` cursor on the
timeline (`App.tsx:317`). There is no `setInterval`, no WebSocket, no SSE, and no webhook anywhere.

We want the UI to update on its own — **everything live** (session list *and* the open session's
timeline/tokens/diagnostics), at **near-instant latency (<300ms)**, with the **API server pushing**
rather than the client polling.

### Why "subscribe to SQLite" is not possible here

The originating question was whether the API server can subscribe to SQLite updates directly. It cannot:

1. **The API server is a pure read-only observer.** Both stores open with `{ readOnly: true }`
   against files in `codexHome` — `state_5.sqlite` (`stateStore.ts:258`) and `logs_2.sqlite`
   (`logStore.ts:461`), using Node's built-in `node:sqlite` `DatabaseSync`.
2. **AgentView does not own these databases — Codex does.** The agent process writes them; AgentView
   reads them from a *different process*.

SQLite's only subscribe-like primitive, `sqlite3_update_hook()` (and commit/rollback hooks), fires
**only for writes on the same connection in the same process**. It is blind to writes from other
connections or processes by design. Since Codex writes and AgentView reads across process
boundaries, an update hook would never fire. (`node:sqlite`'s `DatabaseSync` does not expose update
hooks anyway, nor does `better-sqlite3` for cross-process.) SQLite has no cross-process pub/sub or
notification channel of any kind.

**Therefore the only viable mechanism is: detect the file changed → re-query → push the delta.**
There are two write sources, not one — the SQLite DBs (session list, agent graph, diagnostics) **and**
the rollout JSONL files (timeline events, already tailed by byte offset in `liveTail.ts`).

## Goals

- Session list, active timeline, active token series, and diagnostics update with no user action.
- <300ms perceived latency.
- Server-pushed (SSE), reusing existing cursor/tail primitives.
- The live layer is **never load-bearing**: existing fetch-on-navigate behavior remains the fallback
  and the initial-load path.

## Non-Goals (YAGNI)

- No multi-user / many-client scaling. This is a loopback single-user tool; design for a handful of tabs.
- No WebSockets (one-way push is sufficient; SSE fits the existing one-directional model).
- No load/soak testing; no new Playwright e2e beyond existing coverage.
- No change to how Codex writes its data; we only observe.

## Chosen Approach

**`fs.watch` → SSE, incremental deltas.** Edge-triggered file watching for sub-300ms reaction and
idle efficiency, a slow safety-net poll for correctness, SSE fan-out to browsers, and incremental
deltas (via existing cursors) for the unbounded data so cost does not grow with session length.

Approaches considered and rejected:
- **B — watch + SSE, full-snapshot push.** Same plumbing but re-sends the whole timeline on every
  event; wasteful and can exceed 300ms on long sessions. Viable as a first increment; B→C is a clean
  evolution since the plumbing is identical.
- **A — smart client polling, no server push.** Simplest and most portable, but chatty, not actually
  server-push (contrary to the requirement), and wakes the CPU constantly to hit a 300ms feel.

## Architecture & Components

Three new server modules with strictly separated responsibilities, plus one client module. Each unit
is independently testable and does not reach into another's internals.

### Server

1. **`backend/live/watchManager.ts`** — *knows only the filesystem.*
   Watches a set of paths via `fs.watch`, coalesces bursts with a ~75ms debounce, and runs a slow
   ~2s `fs.watchFile` safety-net poll to catch events FSEvents coalesces or drops. Emits abstract
   signals keyed `"state-db"`, `"logs-db"`, `"rollout:<threadId>"`. Reference-counted: the last
   unwatch tears down the OS watcher. No knowledge of SQLite or SSE.

2. **`backend/live/liveHub.ts`** — *knows only subscribers.*
   A registry of open SSE connections, each tagged with interests (always `sessions`/`diagnostics`;
   optionally one active `threadId`). Exposes `subscribe(interest) → handle`, `publish(channel,
   payload)`, `unsubscribe`. Pure fan-out; no files, no DB.

3. **`backend/live/liveSources.ts`** — *the glue.*
   On a `watchManager` signal, re-queries via **long-lived read-only stores** (one `StateStore`, one
   `LogStore`, opened once and reused — not per-request) plus the existing `tailRolloutFile`, builds
   the payload, and hands it to `liveHub.publish`. Owns **per-subscription cursor state** (rollout
   byte offset, log cursor, session high-water mark).

4. **`backend/api/stream.ts`** — `handleStreamApiRequest` for `GET /api/stream?threadId=…`.
   Sets SSE headers (`text/event-stream`, `keep-alive`, existing loopback CORS from `http.ts`),
   registers the connection with `liveHub`, asks `watchManager` to watch the thread's rollout + the
   two DBs, streams named events, and cleans up watches/subscription on socket close. Slots into the
   existing `handleXApiRequest` chain in `server.ts`.

### Client

5. **`frontend/api/liveStream.ts`** — an `EventSource` wrapper: opens `/api/stream`, parses named
   events into typed callbacks, handles reconnect and cursor resync on reconnect.

6. **Wiring in `App.tsx`** — initial load stays the existing `fetch` (first paint unchanged); the
   stream applies deltas via the *existing* state setters: `setSessions`, the `setTimelinePayload`
   append-merge already at `App.tsx:157`, `setTokenSeries`, and diagnostics state.

### SSE channels (named events)

| Channel | Payload | Trigger | Shape |
|---|---|---|---|
| `sessions` | full session-list snapshot (~100 rows) | `state-db` | snapshot replace |
| `timeline` | new events + `nextByteOffset` | `rollout:<id>` | delta append |
| `tokens` | token series for active thread | `rollout:<id>` | snapshot replace |
| `diagnostics` | summary snapshot + new-log rows since cursor | `logs-db` | snapshot + delta |
| `ready` | baseline established | on subscribe | control |
| `heartbeat` | `: keep-alive` comment ~every 20s | timer | control |
| `error` | typed degradation notice (feed degraded, fall back to manual refresh) | store reopen failure | control |

## Data Flow & Cursor Model

### Trigger → query → push paths

1. **Session list** (`state_5.sqlite` write → `state-db`). Re-run `listSessions` with the
   connection's stored filter; push the full snapshot. Rows mutate in place (token totals, child
   counts), so this is not append-only and diffing ~100 rows is not worth it: snapshot replace. The
   WAL signal is coarse ("DB changed", not which thread) — fine for a full re-query; debounce makes a
   write burst one query.

2. **Active timeline** (`<rolloutPath>` write → `rollout:<threadId>`). The delta path. `liveSources`
   holds the connection's last `nextByteOffset` and calls `tailRolloutFile({ path, threadId,
   fromByte })` exactly as `timeline.ts:139`, pushes only the new events + new `nextByteOffset`, and
   advances the cursor. Client appends (same merge as `App.tsx:157`). An hour-old rollout still ships
   only its tail.

3. **Tokens + diagnostics.** Tokens derive from the same rollout, so `rollout:<threadId>` also
   recomputes the bounded token series and pushes a `tokens` snapshot. Diagnostics ride the
   `logs-db` signal: push a fresh bounded `diagnostics` summary snapshot plus log rows newer than the
   connection's last log cursor (reusing `logStore`'s existing `nextCursor` primitive).

### Cursor ownership

Cursors live **per SSE connection, server-side**, seeded at subscribe time. The watch signal is
global ("rollout changed"), but each connection may be at a different offset (two tabs, one
scrolled back). Per-connection cursors mean each subscriber gets exactly its own tail; fan-out is
"for each subscriber interested in this thread, tail from *their* offset and send *their* delta",
not one shared payload.

On subscribe, `liveSources` establishes baselines (`nextByteOffset`, newest log id, current session
snapshot) and sends `ready`. The client's *initial* data still comes from its normal `fetch` on
mount; the stream delivers strictly "everything after the baseline". To avoid a gap or double
delivery, the client sends its current `nextByteOffset` (and newest log id) as query params on the
`EventSource` URL so the server baselines to exactly the client's position.

### Switching active session

The client **closes and reopens `EventSource`** with the new `threadId` (EventSource is GET-only, so
no in-band control channel). Thread switches are human-paced and rare; `watchManager` ref-counting
drops the old thread's rollout watch automatically. (A bidirectional control channel was considered
and rejected as unnecessary complexity.)

## Connection Lifecycle & Error Handling

**Lifecycle**
- **Heartbeat:** `: keep-alive` comment ~every 20s so idle intermediaries/the browser do not drop the socket.
- **Reconnect:** `EventSource` auto-reconnects; on reopen the client re-sends its current
  `nextByteOffset` + newest log id as query params so the server re-baselines exactly — no gap, no
  duplicates. We do **not** use SSE `Last-Event-ID`; query-param cursors are the source of truth and
  survive a server restart.
- **Cleanup:** on socket `close`, `stream.ts` unsubscribes from `liveHub` and decrements
  `watchManager` ref counts. Last subscriber for a thread tears down its rollout watch. The two DB
  watches are process-lifetime (there is always at least the `sessions` interest).

**Failure handling — degrade, never crash the feed**
- **`fs.watch` unavailable/throws:** the ~2s `fs.watchFile` safety-net poll covers correctness;
  `fs.watch` is pure latency optimization. On error, log once and lean on the poll.
- **Rollout truncated/rotated:** `tailRolloutFile` already detects `fromByte > size` and restarts
  from 0 with a warning (`liveTail.ts:25`). Surface that warning on the `timeline` channel; the
  client resets its events to the fresh tail rather than appending.
- **A query throws** (DB locked mid-write, transient): catch inside `liveSources`, skip that push,
  keep the connection open; the next signal or safety-net poll retries. WAL readers do not block on
  writers, so this should be near-impossible, but it is handled.
- **Store/connection died** (DB file replaced): `liveSources` lazily reopens its long-lived store on
  the next signal if a query fails; if reopen fails, push a typed `error` event so the UI shows
  "live feed degraded" and falls back to manual refresh.
- **Slow client / backpressure:** if `response.write` returns `false`, drop *coalescable* snapshot
  channels (`sessions`, `tokens`, `diagnostics`) for that tick — the next push supersedes them — but
  **never** drop `timeline` deltas (append-only; gaps corrupt state). If the timeline buffer backs
  up, close the connection and let the client reconnect + re-baseline.

**Concurrency assumption:** loopback single-user tool, designed for a handful of tabs. One shared
`watchManager` per file, fan-out in `liveHub`, no connection cap beyond the backpressure rule.

**Kill switch:** `AGENTVIEW_LIVE=0` (default on) disables streaming and falls back entirely to
today's fetch-on-navigate behavior, so the live layer is never load-bearing.

## Testing

The component split lets each unit be tested without a browser or a live agent.

**Unit (vitest)**
- **`watchManager`** — temp dir + real file writes: debounce coalesces a burst into one signal; the
  right signal key fires (`state-db` vs `rollout:<id>`); ref-counting tears down on last unwatch; the
  safety-net poll still fires when `fs.watch` is stubbed to no-op. Fake timers for debounce/poll windows.
- **`liveHub`** — pure logic: subscribers receive only interested channels; per-connection isolation
  (two subscribers at different offsets get different payloads); unsubscribe stops delivery;
  backpressure drops snapshots but never `timeline` deltas.
- **`liveSources`** — highest value. Fixture SQLite DBs + temp rollout file (mirroring existing
  `parseRollout`/`tailRolloutFile` coverage): a rollout append yields a `timeline` delta with correct
  `nextByteOffset` and only new events; truncation resets; session-write yields a full snapshot;
  log-write yields summary + new-rows-since-cursor; a thrown query is swallowed and retried.

**Integration**
- Real `http` server against a temp `codexHome`; a Node SSE client; append to rollout/DB files on
  disk; assert bytes arrive as the right named events end-to-end. Then drop and reconnect with a
  stale cursor → assert re-baseline with no gap and no duplicates.

**Frontend**
- `liveStream.ts` against a mock `EventSource`: named events route to the right callbacks; reconnect
  re-sends cursors.
- React test: `timeline` delta merges through the existing append path (`App.tsx:157`); `sessions`
  snapshot replaces — i.e., the stream reuses the state model the fetch path already exercises.

## Affected / New Files

**New (server):** `backend/live/watchManager.ts`, `backend/live/liveHub.ts`,
`backend/live/liveSources.ts`, `backend/api/stream.ts`.
**New (client):** `frontend/api/liveStream.ts`.
**Modified:** `backend/server.ts` (register `handleStreamApiRequest`), `frontend/App.tsx` (subscribe
+ route deltas into existing setters), `shared/contracts.ts` (SSE channel payload types). Reuses
`tailRolloutFile`, `resolveRolloutPath`, `resolveCodexHome`, `openStateStore`, `openLogStore`,
`getRolloutFactsWithCache`, and the existing CORS helper.
