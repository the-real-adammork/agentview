---
date: 2026-06-04
topic: send-prompts-into-running-agent-sessions
focus: "research how to send messages/prompts into a running claude-code or codex session, including launch flags"
mode: repo-grounded
---

# Ideation: Send Prompts Into Running Agent Sessions

## Grounding Context

AgentView is a local Electron/Vite/React observability app for Codex and Claude Code sessions. The package metadata describes it as an "AgentView desktop observability app"; existing design docs show the active product direction is ingesting both Codex rollouts and Claude Code JSONL sessions through normalized backend contracts.

The strongest local relevance is that AgentView already treats "agent send" as a first-class display operation in `src/backend/rollout/classifyCall.ts`, mapping `send_input`/`send` calls to `{ kind: "agent", op: "send" }`. Current source-adapter design also frames Claude Code support as read-only ingestion of `~/.claude/projects/.../*.jsonl` and Codex support as read-only ingestion of `$CODEX_HOME` state and rollout logs. A write/control surface would be a product boundary change, not a parser-only extension.

External research was primary-source focused:

- Codex app-server is the supported deep-integration protocol. It uses JSON-RPC over stdio, WebSocket, or Unix socket transports and exposes `turn/start`, `turn/steer`, `thread/inject_items`, `turn/interrupt`, process APIs, and shell-command APIs. Source: https://developers.openai.com/codex/app-server
- Codex remote connections let another signed-in Codex device or ChatGPT mobile send follow-up instructions, approvals, and steering messages to the host, but official mobile setup is App-led, not CLI-led. Source: https://developers.openai.com/codex/remote-connections
- The installed local Codex CLI exposes experimental `codex app-server`, `codex remote-control`, `codex --remote`, and non-interactive `codex exec`/`codex exec resume` surfaces.
- Claude Code CLI supports an initial prompt, `-p/--print`, `--input-format stream-json`, `--output-format stream-json`, `--resume`, `--continue`, `--remote-control`, `claude remote-control`, `claude agents`, `claude attach`, `claude --bg`, and background-session reply flows. Source: https://code.claude.com/docs/en/cli-usage
- Claude Code Agent SDK supports multi-turn sessions through Python `ClaudeSDKClient` and TypeScript `continue: true`; Python also supports interrupt-capable continuous conversations. Source: https://code.claude.com/docs/en/agent-sdk/sessions
- Claude Code agent view supports peeking/replying to background sessions, attaching to them, moving existing sessions to the background with `/bg`, and dispatching directly from the shell with `claude --bg`. Source: https://code.claude.com/docs/en/agent-view

## Topic Axes

- Codex supported protocol control
- Claude supported protocol control
- Running terminal / PTY injection
- AgentView product integration boundary
- Operational safety and session identity

## Ranked Ideas

### 1. Codex App-Server Client For Real Follow-Ups

**Description:** Build or prototype against `codex app-server` instead of trying to type into an existing TUI. Start app-server on stdio, Unix socket, or localhost WebSocket, create or load a thread, send normal follow-ups with `turn/start`, and steer an active in-flight turn with `turn/steer`.
**Axis:** Codex supported protocol control
**Basis:** external: OpenAI app-server docs define JSON-RPC transports and show `turn/start` with text input plus `turn/steer` for active turns.
**Rationale:** This is the only Codex path I found that cleanly separates "start a new turn" from "append user input to the current active turn." It also gives AgentView a first-party event stream rather than relying on terminal scraping.
**Downsides:** App-server is a deeper client implementation than a shell wrapper. WebSocket mode is explicitly experimental/unsupported and needs auth care if exposed beyond loopback.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 2. Claude Code Background Sessions As The Human-Compatible Control Surface

**Description:** Launch Claude Code sessions into background mode (`claude --bg "task"`), or move an existing interactive session into the background with `/bg`. Use `claude agents` to monitor, peek, reply, and attach; use `claude attach <id>` when a full TUI is needed.
**Axis:** Claude supported protocol control
**Basis:** external: Claude agent-view docs describe background sessions that keep running without a terminal attached, reply from peek, attach/detach, `/bg`, and `claude --bg`.
**Rationale:** If the goal is "send a prompt to a running Claude Code session," background sessions are the supported CLI-level answer. They are designed for exactly that lifecycle: dispatch, leave running, later reply or attach.
**Downsides:** Replying is exposed through the interactive agent view rather than a simple documented `claude send <id> "..."` command. Scriptability may require SDK use or terminal automation unless Anthropic exposes a stable background-session API.
**Confidence:** 85%
**Complexity:** Low for manual use, Medium for automation
**Status:** Unexplored

### 3. Claude Agent SDK For Programmatic Multi-Turn Control

**Description:** For automation, launch Claude Code through the Agent SDK instead of a human TUI. In Python, hold one `ClaudeSDKClient` and call `client.query(...)` repeatedly; in TypeScript, use `query(..., { options: { continue: true } })` or resume by session ID.
**Axis:** Claude supported protocol control
**Basis:** external: Claude SDK session docs state Python `ClaudeSDKClient` tracks session IDs across calls and TypeScript `continue: true` resumes the most recent session in the directory.
**Rationale:** This is cleaner than injecting keystrokes into a running `claude` process. It gives a controllable loop, streamed messages, session continuity, and, in Python, interrupt support.
**Downsides:** It is not literally controlling an already-open human terminal session. It controls a Claude Code agent session owned by the SDK process.
**Confidence:** 88%
**Complexity:** Medium
**Status:** Unexplored

### 4. Claude `stream-json` Print Mode For A Long-Lived Pipe

**Description:** Launch `claude -p --input-format stream-json --output-format stream-json --verbose` and keep stdin open. Send one JSONL user message per follow-up; read stream-json output for responses and tool events.
**Axis:** Claude supported protocol control
**Basis:** external: Claude CLI docs list `--input-format stream-json`; local `claude --help` confirms the flag is "realtime streaming input" and pairs it with `--print`/stream-json output.
**Rationale:** This is the closest documented Claude CLI shape to "send messages into a running process" without using a TUI. It should fit a small bridge process well.
**Downsides:** It is print/SDK mode, not interactive TUI mode. Current help indicates streaming input is text-user-message oriented; approvals and rich UI affordances may need separate handling.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 5. Codex Remote Connections For Cross-Device Human Steering

**Description:** Use the Codex App remote-connections feature when the requirement is human steering from another device rather than local automation. The host provides files, credentials, tools, sandboxing, and approvals; the remote client sends prompts/follow-ups.
**Axis:** Codex supported protocol control
**Basis:** external: OpenAI remote-connections docs say remote users can start or continue threads, send follow-up instructions, answer questions, approve actions, and steer active work.
**Rationale:** For phone/laptop handoff, this is a supported end-user path and avoids exposing raw app-server transports.
**Downsides:** Official docs say mobile setup starts from the Codex App, not from the CLI or IDE extension. The installed CLI has experimental `remote-control`, but that looks less stable than the App-led path.
**Confidence:** 76%
**Complexity:** Low for manual use, High for embedding
**Status:** Unexplored

### 6. PTY/Tmux Keystroke Injection As A Last-Resort Adapter

**Description:** If an already-running TUI must be controlled and no supported API owns that session, launch it inside a controlled PTY/tmux pane from the start, then inject text with tmux `send-keys` or a PTY library.
**Axis:** Running terminal / PTY injection
**Basis:** reasoned: TUIs read from their controlling terminal. A wrapper that owns the PTY can write keystrokes to that terminal, but it is blind to application state unless paired with screen scraping or logs.
**Rationale:** This may work for demos, local operator tools, or emergency control of an existing terminal workflow.
**Downsides:** Fragile across UI changes, focus state, prompts, multiline input, slash commands, approvals, alternate-screen behavior, and terminal resize. It should not be the default integration for AgentView.
**Confidence:** 55%
**Complexity:** Medium to High
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Append lines directly to Codex or Claude JSONL logs | Not grounded as a supported input mechanism; likely corrupts or desynchronizes persisted history. |
| 2 | Send normal stdin to an already-running TUI process by process id | Too vague and generally impossible unless you own the controlling terminal/PTY. |
| 3 | Use only `codex exec resume` / `claude -c -p` for all follow-ups | Useful for sequential automation, but does not steer an active in-flight turn. |
| 4 | Expose Codex app-server on a LAN without auth | Unsafe; OpenAI docs warn about non-loopback WebSocket exposure and recommend auth/VPN/SSH-style controls. |
| 5 | Treat AgentView session ingestion as a write API | Scope overrun for current read-only ingestion architecture; would need an explicit control-plane design. |

## Practical Recommendation

If you want a robust AgentView feature, prototype two lanes:

1. Codex lane: `codex app-server --listen stdio://` or a loopback Unix/WebSocket transport, then JSON-RPC `turn/start` and `turn/steer`.
2. Claude lane: use the Claude Agent SDK or `claude -p --input-format stream-json --output-format stream-json` for automation; use `claude --bg`/`claude agents` for human-controlled background sessions.

Avoid PTY injection except as a clearly labeled compatibility bridge for sessions launched under AgentView's own terminal wrapper.
