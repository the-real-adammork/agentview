# Designer brief — two candidate renderers

**Source:** audit of `docs/design/agentview-other-133.jsonl` (the 133-row "Other" tool-type export — events with no custom renderer).
**Status of the rest of that bucket:** already resolved in code. `docker ps`/`compose ps` → **table** (with a STATUS health dot), `git diff --name-status` → **status**, `git show <ref>:<path>` → **file**. Everything else (`date`, `set …>file`, `write_stdin` I/O, misc singletons) is correctly **plain** — no card warranted.

These two are the only genuinely *new shapes* left. Both are **low-frequency**, so treat this as "nice to have / decide if worth a card," not a must-build.

---

## 1. Docker Compose lifecycle progress

### What it is
The streaming step-progress Docker Compose emits while bringing a stack up: image-layer pulls, then resource lifecycle transitions (Network → Volume → Container, each cycling `Creating → Created → Starting → Started`, or `Recreate → Recreated → Started`).

### When it occurs / frequency
`docker compose up -d`, and inside `set -o pipefail; { … docker compose up … }` QA-setup blocks. Also leaks into `write_stdin` as raw image-pull progress. **~4–6 rows** in this 133-row sample. It's noisy and repetitive (one line per layer per state change).

### Real data available

**(a) Resource lifecycle** — the useful part. Each line is `<ResourceType> <name> <State>`:
```
Network   impl-phase-1-…-contracts-prisma_default            Creating
Network   impl-phase-1-…-contracts-prisma_default            Created
Volume    impl-phase-1-…_nerdy-postgres-data                 Creating
Volume    impl-phase-1-…_nerdy-postgres-data                 Created
Container impl-phase-1-…-contracts-prisma-postgres-1         Creating
Container impl-phase-1-…-contracts-prisma-postgres-1         Created
Container impl-phase-1-…-contracts-prisma-postgres-1         Starting
Container impl-phase-1-…-contracts-prisma-postgres-1         Started
```
Recreate variant: `Container … Recreate → Recreated → Starting → Started`.

**(b) Image pull progress** — the noisy part (often hundreds of lines, by layer hash):
```
0814fd5186c4 Pulling fs layer 0B
9e86f6b8bd4b Download complete 0B
e0f64b82520a Downloading 1.049MB
…
```

### Structured data we could extract
```ts
interface ComposeOutputRender {
  kind: "compose";
  resources: {                  // collapse (a) to terminal state per resource
    type: "network" | "volume" | "container" | "image";
    name: string;               // strip the long project prefix for display
    state: "creating" | "created" | "starting" | "started" | "recreated" | "healthy" | "error";
  }[];
  pull?: { layers: number; done: number };  // collapse (b) to "14 layers · 14 pulled"
}
```
The win is **collapsing the stream into terminal state per resource** — the 8-line Container churn becomes one `● Container postgres-1 · Started` row; the 200-line pull becomes one `↓ 14 layers pulled` line.

### Fit with existing layouts
- **Closest reuse: `status` (StatusView).** Its `code + path` rows map cleanly onto a `state-dot + resource-name` list. A compose render could literally be StatusView with a colored lifecycle dot (green `Started/Healthy`, amber `Starting`, red `Error`) instead of an M/A/D glyph — same vocabulary as the docker `table` STATUS dot we just shipped, so it'd feel native.
- **Why not `log`/`trace`:** those preserve every line; the value here is the opposite — *deduping* the stream to final states.

### Recommendation
**Low priority.** If built, do it as a **`status`-style state list** (reuse the dot + row vocabulary), and **drop image-pull lines** to a single summary chip. Only worth it if compose-up traffic grows; otherwise plain is acceptable.

---

## 2. `tool_search` — tool-discovery call

### What it is
A distinct tool type (`tool_search_call` + `tool_search_output`, not `exec_command`): the agent searches the available tool catalog by query, and gets back a tree of **namespaces → function definitions**.

### When it occurs / frequency
**1 occurrence** in this sample. Rare today, but structurally unlike anything we render — it's neither an exec output nor a normal tool call.

### Real data available
**Call:**
```json
{ "query": "spawn sub-agent worker goal codex general-purpose agent", "limit": 8 }
```
**Output:** a namespace tree:
```
multi_agent_v1 — "Tools for spawning and managing sub-agents."
  ├ spawn_agent   (params: agent_type, model, items, message, reasoning_effort, service_tier…)
  ├ close_agent
  ├ resume_agent
  ├ wait_agent
  └ send_input
```
Each function carries `name`, `description` (often long), `parameters` (JSON Schema).

### Structured data we could extract
```ts
interface ToolSearchCallRender {
  kind: "tool_search";
  query: string;
  limit?: number;
  namespaces: {
    name: string;
    description?: string;
    functions: { name: string; summary?: string }[];   // summary = first line of description
  }[];
  resultCount: number;  // total functions, drives "+N" overflow
}
```

### Fit with existing layouts
- **This is a CALL renderer, not an exec output** — it belongs beside `read`/`search_call`/`fetch`/`agent`, dispatched on `callRender.kind`.
- **Closest reuse: `search_call` call-line** (`⌕ query  ·  N hits`) for the collapsed inline form: `⌕ "spawn sub-agent…" · 5 tools`.
- **Expanded form has no existing analog:** the namespace → function tree. Nearest visual is the `tree` renderer's indented hierarchy, but the node content (function name + param chips) is richer than a filename. This is the part that **needs design**.

### Recommendation
**Lowest priority (n=1).** If it recurs, render the **collapsed line via the existing `search_call` vocabulary** and design only the **expanded namespace/function tree** (function name + truncated summary + param-name chips). Until then, leave plain.

---

## TL;DR for the designer
| Shape | Freq | Build? | If built, reuse… | New design needed |
|---|---|---|---|---|
| Compose lifecycle | ~4–6 | Optional | `status` dot-list + a pull summary chip | minimal — just the state-dot tones |
| `tool_search` | 1 | Only if it recurs | `search_call` line for collapsed form | the expanded namespace→function tree |
