# Codex Session Observability Dashboard Phase Breakup Review

**Technical Design:** `docs/designs/2026-05-26-codex-session-observability-dashboard.md`  
**Phases Document:** `docs/plans/2026-05-26-codex-session-observability-dashboard-implementation-phases.md`  
**Review Date:** 2026-05-26  
**Blocking Status:** Not blocking

## Findings

| ID | Severity | Finding | Recommendation | Disposition |
| --- | --- | --- | --- | --- |
| PBR-1 | Low | The design sequencing puts live selected-session tail in the final diagnostics/tail step, but the implementation mechanics depend on rollout byte offsets and cache append behavior introduced with Timeline. | Move selected rollout `tailThread` into the Timeline/cache phase and keep raw `codex-tui.log` tail in Diagnostics. | Revised in phases document and Phase 3/Phase 5 plans. |
| PBR-2 | Low | The prototype includes many shared visual primitives that could tempt a standalone design-system phase. That would be a horizontal split with no useful dashboard workflow. | Establish core tokens/chrome/components in Phase 1, then port view-specific primitives in the view phases that need them. | Accepted in Phase 1 and later phase file maps. |
| PBR-3 | Low | Diagnostics plus final hardening is broad. | Keep them together because Diagnostics is the last required view and final QA needs every source/view present; bound the phase with Diagnostics and hardening sub-agent lanes. | Accepted in Phase 5 execution contract. |

## Coverage Matrix

| Design Responsibility | Phase Coverage | Judgment |
| --- | --- | --- |
| Bootstrap Vite/React/Node/shared contract/test setup | Phase 1 | Covered as a fixture-backed vertical slice. |
| Prototype visual/product intent and five required views | Phase 1 seeds all views; Phases 2-5 make them real | Covered without a separate UI-only phase. |
| Read-only `$CODEX_HOME`, state DB, schema checks, fast Sessions | Phase 2 | Covered with no JSONL first paint. |
| Rollout stream parsing, parser tolerance, cache, redaction | Phase 3 | Covered before dependent views consume parsed facts. |
| Timeline rows, scrubber, collapsed output, selected-session tail | Phase 3 | Covered as one coherent detail workflow. |
| Agent Graph and Tokens from edges/cache | Phase 4 | Covered after parsed facts are available. |
| Structured diagnostics, warning badges, raw advanced tail | Phase 5 | Covered after all prior surfaces exist. |
| Privacy, performance, accessibility, partial-error hardening | Phases 1-5, final gate in Phase 5 | Covered with early obligations and final cross-view enforcement. |

## Phase Boundary Review

- The phase set avoids horizontal backend-only/frontend-only splits. Each phase has a runnable user/runtime surface and a browser or service smoke test.
- Phase 1 is intentionally fixture-backed because the repository has no runtime code; it still proves browser-to-local-API wiring and establishes the E2E harness.
- Phase 2 makes the first real Codex source useful end to end and preserves the product requirement that first paint does not parse JSONL.
- Phase 3 is the smallest coherent increment for detailed transcript inspection because parser, cache, redaction, Timeline UI, and selected rollout tail share the same rollout source mechanics.
- Phase 4 can safely split Graph and Tokens into sub-agent lanes because both consume stable Phase 3 facts and have largely disjoint UI/API files.
- Phase 5 is a substantial final integration phase but bounded by one remaining view, source-specific warning badges/raw tail, and cross-view hardening.

## Recommended Plan Edits

1. Keep selected rollout tail in Phase 3 and explicitly name raw TUI tail as Phase 5 only.
2. Ensure every plan has an early Playwright or equivalent E2E extension when new user/runtime wiring appears.
3. Keep the design-system work tied to the view that consumes it rather than creating a separate component-library phase.
4. In Phase 5, require named automated commands for accessibility, privacy, and performance so hardening is not a manual catch-all.

All recommended edits are reflected in the generated implementation plans.
