# Codex Session Observability Dashboard Implementation Plan Review

**Technical Design:** `docs/designs/2026-05-26-codex-session-observability-dashboard.md`  
**Phases Document:** `docs/plans/2026-05-26-codex-session-observability-dashboard-implementation-phases.md`  
**Review Date:** 2026-05-26  
**Blocking Status:** Not blocking

## Findings

| ID | Severity | Finding | Affected Plans | Recommendation | Disposition |
| --- | --- | --- | --- | --- | --- |
| IPR-1 | Low | `tailThread` is implemented in Phase 3 rather than the design's final diagnostics/tail sequencing. This is a sequencing deviation but technically coherent because selected rollout tail shares parser/cache byte-offset logic. | Phase 3, Phase 5 | Document the deviation and keep raw `codex-tui.log` tail in Phase 5. | Accepted; phases document records the deviation and rationale. |
| IPR-2 | Low | Phase 5 could become a broad hardening bucket if commands are not explicit. | Phase 5 | Require named `typecheck`, `test`, `e2e`, `a11y`, `perf:all`, and `privacy:check` gates plus packet evidence. | Accepted in Phase 5 acceptance gate. |

No High or Medium findings.

## Coverage Matrix

| Design Area | Plan Coverage | Review Judgment |
| --- | --- | --- |
| App bootstrap, contracts, local API boundary, future IPC shape | Phase 1 | Covered with shared `ObservatoryApi`, fixture API, and typed envelopes. |
| Sessions from `state_5.sqlite`, `thread_spawn_edges`, filters, fast first paint | Phase 2 | Covered with read-only state store, SQL fixtures, Playwright, and perf guard. |
| Rollout JSONL streaming, parser, cache, redaction, Timeline, scrubber | Phase 3 | Covered with unit/integration/E2E/perf tasks and cache invalidation. |
| Agent Graph and Tokens from edges/cache | Phase 4 | Covered with disjoint graph/token lanes and cross-view navigation. |
| Diagnostics from `logs_2.sqlite`, warning badges, raw TUI fallback | Phase 5 | Covered with logs store/API, UI, badges, and advanced raw tail. |
| Privacy/security: local-only, read-only, path guard, redacted previews, raw gating | Phases 1-5 | Covered, with final privacy gate in Phase 5. |
| Accessibility and visual constraints | Phases 1-5 | Covered through Phase 1 tokens/chrome, per-view tasks, and Phase 5 a11y gate. |
| Performance: 500 rows, streaming parse, cache, diagnostics paging, live row caps | Phases 2-5 | Covered by phase-specific and final perf commands. |
| Error handling and partial data states | Phases 2-5 | Covered as sources are introduced and consolidated in Phase 5. |

## Phase Boundary Review

- The plans are sequential and build on verified behavior: fixture shell -> real Sessions -> real Timeline/cache -> Graph/Tokens -> Diagnostics/hardening.
- No plan is purely backend or purely frontend. Each phase includes the UI/API/persistence/test work needed for a smoke-testable state.
- Sub-agent lanes are bounded and few: contract/test harness, UI shell, backend source, Sessions UI, parser/cache, Timeline UI, Graph, Tokens, Diagnostics, and Hardening. Integration-heavy packet and final wiring work stays with the phase owner.
- Cross-plan dependencies are explicit through acceptance packets and phase boundaries.
- Tauri packaging, export, editor launch, mutation controls, multi-root selection, and optional Codex tables remain out of scope.

## Recommended Plan Edits

All findings were resolved in the generated plan files before this review artifact was finalized. No additional plan edits are required before execution.

## Severity Counts

- High: 0
- Medium: 0
- Low: 2

## Execution Readiness

The plan set is ready for `$implementation-execution` in phase order. Execution should begin with Phase 1 only, produce its acceptance packet, and then proceed to Phase 2 using Phase 1's verified scripts and harness as the baseline.
