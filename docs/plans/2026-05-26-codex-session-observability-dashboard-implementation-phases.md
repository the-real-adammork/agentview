# Codex Session Observability Dashboard Implementation Phases

**Technical Design:** `docs/designs/2026-05-26-codex-session-observability-dashboard.md`  
**Requirements:** `docs/design/2026-05-26-codex-session-observability-dashboard.md`, `docs/design/workflowkit-evangelion/Engineering Handoff.html`  
**Status:** Reviewed  
**Last Updated:** 2026-05-27

---

## Phase Proposal

| Phase | Goal | Builds On | Phase Owner Scope | Sub-Agent Lanes | App Surface Included | Smoke Test | Service Wiring | E2E Readiness | Phase Acceptance Automation | Acceptance Packet | Planned Output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phase 1 - Fixture Shell And Contract | Bootstrap the Vite/React/Node/TypeScript app and prove all five views render from fixture data through the typed API contract. | None | Scaffold, shared contracts, fixture transport, app chrome, design tokens, first Playwright harness. | UI shell lane, contract/test harness lane; serialized package/config edits. | React shell, local API health, fixture ObservatoryApi, five route shells. | `npm run dev:all` plus Playwright opens every view from fixture data. | UI -> transport -> fixture API; no Codex source reads yet. | Create Playwright early. | Playwright smoke against fixture mode plus unit/typecheck. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-1.md` | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-1-fixture-shell.md` |
| Phase 2 - Read-Only Sessions Index | Replace fixture Sessions with real read-only `state_5.sqlite` listing, filters, health, and child/open counts while keeping detail views fixture-backed. | Phase 1 fixture shell and transport. | Codex path guard, read-only SQLite state store, Sessions API/client/UI integration, first-paint performance proof. | Backend source lane and Sessions UI lane can overlap after contracts stabilize. | Sessions view, header counts, health/status surfaces. | Sessions list renders real or temp-fixture DB rows sorted by updated desc without JSONL parsing. | UI -> HTTP client -> state store -> read-only SQLite; graph counts from `thread_spawn_edges`. | Extend existing Playwright with temp `$CODEX_HOME`. | Playwright Sessions flow plus integration tests for SQLite fixtures. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-2.md` | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-2-sessions-index.md` |
| Phase 3 - Rollout Timeline And Cache | Add streaming JSONL parsing, redaction, derived cache, Timeline rendering, collapsed tool outputs, and selected-session tail polling. | Phase 2 real session lookup and transport. | Rollout stream/parser/cache, timeline APIs/client, Timeline UI, parser/privacy tests, E2E selected-session detail. | Parser/cache lane and Timeline UI lane can overlap after event contracts are fixed. | Timeline view, selected session detail, live appended rows for rollout files. | Opening a real or fixture rollout shows normalized events, joined tool output, scrubber ticks, redacted previews, and warm cache reuse. | UI -> timeline API -> thread lookup -> rollout stream/cache -> redaction -> Timeline. | Extend Playwright to open selected session and inspect timeline. | Playwright Timeline flow plus parser/cache integration tests. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-3.md` | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-3-timeline-cache.md` |
| Phase 4 - Agent Graph And Tokens | Build Agent Graph and Tokens from state edges plus parsed rollout facts, including depth limits, token empty states, and drill-down navigation. | Phase 3 cached parsed rollout facts. | Graph/token API methods, React graph/token views, layout constraints, contract reuse, E2E navigation. | Graph lane and Tokens lane can run in parallel; shared parsed-facts contract is serialized. | Agent Graph view, Tokens view, cross-view navigation. | Root/depth graph and token charts render for fixture and real cached data; node/session drill-down opens Timeline. | UI -> graph/token APIs -> state edges + threads + rollout cache. | Extend Playwright with graph/tokens routes. | Playwright Graph/Tokens flows plus unit tests for derived graph/token series. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-4.md` | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-4-graph-tokens.md` |
| Phase 5 - Diagnostics, Raw Tail, And Hardening | Add structured diagnostics, async warning badges, advanced raw tail, and final performance/privacy/accessibility/error hardening across all five views. | Phases 1-4 working dashboard surfaces. | Logs store/API, Diagnostics UI, badge hydration, raw tail guard, missing-source behavior, final QA gates. | Diagnostics lane and hardening lane can overlap; API/error envelope edits are serialized. | Diagnostics view, async badges, raw advanced tail, cross-view failure states. | Diagnostics filters work against `logs_2.sqlite`; warning badges hydrate after first paint; all five views pass final E2E/a11y/privacy/perf checks. | UI -> diagnostics API -> read-only logs DB/raw log; Sessions badges -> diagnostics summary; error envelopes across sources. | Playwright is already established and becomes the full acceptance gate. | Full Playwright suite, integration tests, axe/accessibility checks, performance/privacy regression commands. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-5.md` | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md` |
| Corrective Slice - API Design Data Gap Closure | Align the implemented API/server normalization with the WorkflowKit Evangelion handoff expectations for observed rollout envelopes, token metadata, graph metadata, diagnostics logs, and failed-command facts. | Phase 5 completed dashboard and follow-up design/API gap review. | Shared contract enrichment, observed-shape fixtures, rollout parser fixes, logs schema adapter, graph/token/diagnostics payload enrichment, UI consumption proof, acceptance packet. | Contract baseline is serialized; rollout parser and logs schema adapter can run in parallel after contracts; UI consumption runs after API enrichment. | Existing Sessions, Timeline, Agent Graph, Tokens, and Diagnostics views. | Temp observed-schema Codex fixtures prove the app consumes enriched API payloads for all affected views. | UI -> local API -> observed `state_5.sqlite`, rollout JSONL, `logs_2.sqlite`, rollout cache, and raw preview-safe payloads. | Reuse Playwright and temp `$CODEX_HOME` fixture setup. | Focused unit/integration/Playwright/privacy commands for the corrected API data paths. | `docs/qa/phase-acceptance/2026-05-27-observatory-api-design-data-gap-closure.md` | `docs/plans/2026-05-27-observatory-api-design-data-gap-closure.md` |

## Coverage Check

| Technical Design Section | Covered By Phase(s) | Notes |
| --- | --- | --- |
| Goal, Context, Non-Goals, Human Decisions | Phases 1-5 | Read-only, local-only, no export/telemetry/editor launch is enforced throughout. |
| Proposed Architecture, API / Transport, Ingest Worker | Phases 1-3, 5 | Phase 1 defines the transport-neutral contract; later phases replace fixture handlers with real sources. |
| Responsibilities | Phases 1-5 | Responsibilities map directly to vertical slices instead of frontend/backend-only phases. |
| Data Flow / Control Flow | Phases 2-5 | First paint, detail parse, graph/tokens, diagnostics, and tail flow are introduced in dependency order. |
| Storage / State, Configuration | Phases 2-3, 5 | `$CODEX_HOME`, allowlists, read-only DBs, cache directory, parser thresholds, and tail caps are covered. |
| UI, Design System Constraints, Accessibility Obligations | Phases 1-5 | Phase 1 establishes tokens/chrome; later phases enforce per-view obligations and final checks. |
| Data Contracts | Phases 1-5 | Shared contracts start in Phase 1 and expand with each real source. |
| Design handoff/API data fidelity | Corrective Slice | Follow-up plan closes discovered gaps between WorkflowKit handoff field expectations and the API server's real data payloads. |
| Parsing And Cache Strategy | Phase 3, Phase 4 | Parser/cache facts unlock Timeline first, then Graph/Tokens reuse them. |
| Privacy And Security | Phases 1-5 | Local-only API, path guard, preview redaction, collapse defaults, raw advanced gating, and no source writes. |
| Performance Strategy | Phases 2-5 | Sessions first paint, streaming parse, cache warm/cold, graph layout, diagnostics paging, and live row caps. |
| Error Handling | Phases 2-5 | Typed partial errors expand with every source and are consolidated in hardening. |
| Sequencing | Phases 1-5 | Preserved with one consolidation: live selected-session tail lands with Timeline; structured diagnostics lands in Phase 5. |
| Verification Strategy | Phases 1-5 | Unit, integration, Playwright, performance, privacy, and accessibility checks are introduced as the relevant wiring appears. |
| Risks And Tradeoffs, Open Questions | Phases 2-5 | Schema drift, source locks, sensitive raw data, graph depth, and port orchestration are explicitly planned. |

## Phase Breakup Review

| Finding | Severity | Recommendation | Disposition |
| --- | --- | --- | --- |
| Live tail appears in the design sequencing with Diagnostics, but selected-session tailing depends on rollout byte offsets and should be proven while Timeline cache semantics are introduced. | Low | Move `tailThread` into Phase 3 and reserve raw TUI log tail for Phase 5. | Revised. Phase 3 includes selected rollout tail; Phase 5 includes raw `codex-tui.log` tail. |
| The prototype has many visual primitives that could become an isolated design-system-only phase. | Low | Keep token/chrome primitives in Phase 1 and require each later view to port only the primitives it needs. | Accepted. Avoids a horizontal UI-library phase. |
| Diagnostics and final hardening are related but broad. | Low | Keep them together because diagnostics is the final required view and the same phase needs cross-source error, privacy, and accessibility acceptance. | Accepted with bounded sub-agent lanes. |

Review artifact: `docs/plans/reviews/2026-05-26-codex-session-observability-dashboard-phase-breakup-review.md`

## Ready Phase Boundaries

| Phase | Final Smoke-Testable Outcome | Phase Owner Scope | Sub-Agent Lanes | Service Wiring | E2E Readiness | Phase Acceptance Automation | Acceptance Packet | Builds On | Later Phases Can Assume | Out Of Scope | Plan Document |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Phase 1 - Fixture Shell And Contract | Fixture-backed Observatory app runs with all five views, persistent chrome, typed contract, local API health, and Playwright smoke. | One owner coordinates scaffold, contracts, fixture data, app shell, scripts, and acceptance packet. | UI shell; contract/test harness. | Browser -> fixture transport/API health. | Create Playwright immediately. | `npm run test`, `npm run typecheck`, `npm run e2e`. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-1.md` | None | Stable scripts, contracts, route shell, visual tokens, fixture E2E harness. | Real Codex reads, parser, graph logic, diagnostics. | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-1-fixture-shell.md` |
| Phase 2 - Read-Only Sessions Index | Real Sessions view uses read-only `state_5.sqlite`/`thread_spawn_edges`, filters compose, and no JSONL is parsed on first paint. | One owner coordinates backend state source, Sessions UI, temp DB fixtures, performance evidence, and packet. | Backend state source; Sessions UI. | Browser -> HTTP client -> state store -> read-only SQLite. | Extend Phase 1 Playwright with temp `$CODEX_HOME`. | `npm run test -- --run`, `npm run e2e -- sessions`, first-paint perf check. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-2.md` | Phase 1 | Real session contract, path guard, state DB schema checks, fast list behavior. | JSONL detail parsing, logs DB diagnostics, raw tail. | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-2-sessions-index.md` |
| Phase 3 - Rollout Timeline And Cache | Selected session Timeline loads from streamed/cached JSONL with redacted previews, joined tools, scrubber, collapse defaults, and selected rollout tail. | One owner coordinates parser/cache, detail APIs, Timeline UI, redaction, and packet. | Parser/cache; Timeline UI. | Browser -> timeline API -> thread lookup -> rollout stream/cache -> UI. | Extend Playwright to select a row and inspect Timeline. | Parser/cache tests plus Playwright Timeline flow. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-3.md` | Phase 2 | Cached parsed rollout facts, redaction helper, Timeline event model, tail-by-offset behavior. | Graph/Tokens rendering, logs DB diagnostics, raw TUI tail. | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-3-timeline-cache.md` |
| Phase 4 - Agent Graph And Tokens | Agent Graph and Tokens render from state edges and cached rollout facts with drill-down navigation and empty states. | One owner coordinates graph/token APIs, derived facts, UI layout, and packet. | Graph; Tokens. | Browser -> graph/token APIs -> state edges + rollout cache. | Extend Playwright with graph/tokens flows. | Unit tests plus Playwright Graph/Tokens navigation. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-4.md` | Phase 3 | Graph contract, token series contract, cross-view navigation, depth-2 behavior. | Structured logs, raw TUI tail, full hardening. | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-4-graph-tokens.md` |
| Phase 5 - Diagnostics, Raw Tail, And Hardening | Diagnostics uses `logs_2.sqlite`, Sessions badges hydrate asynchronously, raw tail is advanced-only, and all five views pass final gates. | One owner coordinates logs API/UI, badge hydration, raw tail safety, error handling, performance/privacy/a11y final acceptance. | Diagnostics; hardening/QA. | Browser -> diagnostics API -> logs DB/raw log; cross-view error envelopes. | Existing Playwright becomes full five-view suite. | Full test/e2e/a11y/perf/privacy command set. | `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-5.md` | Phase 4 | Complete v0.1 read-only dashboard ready for implementation review. | Tauri packaging, export/sharing, mutation controls, multi-root selector. | `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md` |
| Corrective Slice - API Design Data Gap Closure | Existing views consume API payloads that match the WorkflowKit handoff expectations for observed Codex source data. | One owner coordinates contract enrichment, parser/log-store correction, API payload enrichment, UI consumption proof, and packet. | Rollout parser; logs schema adapter; graph/tokens API; UI consumption after API enrichment. | Browser -> local API -> observed state DB, rollout JSONL, logs DB, rollout cache. | Reuse Playwright with observed-shape temp `$CODEX_HOME`. | `npm run typecheck`, `npm run test -- --run`, focused Playwright, `npm run privacy:check`. | `docs/qa/phase-acceptance/2026-05-27-observatory-api-design-data-gap-closure.md` | Phase 5 and gap review | Observed rollout envelopes, logs schema, token metadata, graph metadata, joined tool facts, and failed-command facts are represented in API payloads. | New product surfaces, Tauri packaging, raw unredacted reveal, export/sharing, source mutation. | `docs/plans/2026-05-27-observatory-api-design-data-gap-closure.md` |

## Execution Order

1. Phase 1 - Fixture Shell And Contract
2. Phase 2 - Read-Only Sessions Index
3. Phase 3 - Rollout Timeline And Cache
4. Phase 4 - Agent Graph And Tokens
5. Phase 5 - Diagnostics, Raw Tail, And Hardening
6. Corrective Slice - API Design Data Gap Closure

## Deferred Work And Escalations

- Deferred out of v0.1: Tauri packaging, native installer/updater, export/sharing, editor launch or command execution, mutation controls, full-text indexing of all tool output, multi-root `$CODEX_HOME`, dynamic tools UI, stage1/job/batch job/remote-control optional tables.
- Expected escalation categories in plans are limited to user-required validation against unavailable private Codex source data and product/security decisions only if implementation discovers a privacy behavior not answered by the design.
- Initial plan artifacts were generated locally in this session; a consolidated planning review agent then reviewed the plan set and its blocking findings were accepted and patched.

## Generated Implementation Plans

- `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-1-fixture-shell.md` - Bootstrap a fixture-backed app shell, typed contract, scripts, and Playwright harness.
- `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-2-sessions-index.md` - Wire real read-only Sessions index from `state_5.sqlite`.
- `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-3-timeline-cache.md` - Add rollout streaming, parser/cache, Timeline, redaction, and selected-session tail.
- `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-4-graph-tokens.md` - Add Agent Graph and Tokens from state edges and cached rollout facts.
- `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md` - Add Diagnostics, warning badges, raw tail, and final hardening.
- `docs/plans/2026-05-27-observatory-api-design-data-gap-closure.md` - Correct API/server normalization gaps discovered between the WorkflowKit handoff and implemented data payloads.

## Consolidated Review

Review artifacts:
- `docs/plans/reviews/2026-05-26-codex-session-observability-dashboard-implementation-plan-review.md`
- `docs/plans/reviews/2026-05-26-codex-session-observability-dashboard-implementation-plan-review-agent.md`
- `docs/plans/reviews/2026-05-26-codex-session-observability-dashboard-implementation-plan-review-rerun-2.md`

Plan review finding 1: Low - selected-session `tailThread` moved earlier than the design sequencing.  
Affected plan(s): `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-3-timeline-cache.md`, `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`  
Design/phase source: `Sequencing`, `Data Flow / Control Flow`  
Recommended edit: Keep rollout tail in Phase 3 because it shares cache byte-offset logic; keep raw TUI log tail in Phase 5.  
Disposition: revised and documented in phase breakup review.

Plan review finding 2: Low - final hardening can become vague unless commands and acceptance packets are explicit.  
Affected plan(s): `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`  
Design/phase source: `Verification Strategy`, `Accessibility Obligations`, `Privacy And Security`  
Recommended edit: Require named automated commands for e2e, accessibility, privacy, and performance, plus an acceptance packet.  
Disposition: accepted in Phase 5 acceptance gate.

Plan review finding 3: Medium - Phase 5 diagnostics omitted failed-command summary behavior.  
Affected plan(s): `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`  
Design/phase source: `Sequencing`, `DiagnosticsView`, `Error Handling`  
Recommended edit: Add failed-command summaries to service wiring, API/UI tasks, fallback behavior, and acceptance evidence.  
Disposition: accepted and patched in Phase 5.

Plan review finding 4: Medium - runtime no-network/font restrictions were not explicitly planned or gated.  
Affected plan(s): `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-1-fixture-shell.md`, `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`  
Design/phase source: `Privacy And Security`, `Design System Constraints`  
Recommended edit: Add deterministic style-token/runtime asset checks and final privacy/network assertions.  
Disposition: accepted and patched in Phases 1 and 5.

Plan review finding 5: Medium - Phase 5 parallelism was unsafe around shared contracts, API client, app shell, path guards, and E2E files.  
Affected plan(s): `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`  
Design/phase source: `Phase Execution Contract`, `Codex Efficiency Rules`  
Recommended edit: Serialize shared source-safety/privacy contract work before Diagnostics UI and reserve cross-cutting files to the phase owner.  
Disposition: accepted and patched in Phase 5.

Plan review finding 6: Low - routine local setup/tooling appeared in escalation tables.  
Affected plan(s): all phase plans  
Design/phase source: `Autonomy Model`, `Autonomy And Escalation`  
Recommended edit: Keep escalation tables limited to allowed external exception categories.  
Disposition: accepted and patched.

Plan review finding 7: Low - Phase 1 style-token lint fallback was not deterministic.  
Affected plan(s): `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-1-fixture-shell.md`  
Design/phase source: `Design System Constraints`  
Recommended edit: Add `npm run tokens:check` as a reproducible gate inherited by later phases.  
Disposition: accepted and patched.
