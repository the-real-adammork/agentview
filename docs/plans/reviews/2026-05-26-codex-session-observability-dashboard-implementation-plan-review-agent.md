# Codex Session Observability Dashboard Implementation Plan Review

**Review Scope:** consolidated review of the implementation phases document and Phase 1-5 plan documents against the technical design and requirements sources.

**Technical Design:** `docs/designs/2026-05-26-codex-session-observability-dashboard.md`  
**Phases Document:** `docs/plans/2026-05-26-codex-session-observability-dashboard-implementation-phases.md`  
**Requirements:** `docs/design/2026-05-26-codex-session-observability-dashboard.md`, `docs/design/workflowkit-evangelion/Engineering Handoff.html`

## Findings

### Finding 1: Medium - Phase 5 diagnostics omits failed-command summary behavior required by the design

**Affected plans:** `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`

**Evidence:**
- The technical design explicitly sequences Phase 5 to add "structured Diagnostics from `logs_2.sqlite`, async warning badges, failed command summaries, and advanced raw `codex-tui.log` tail" (`docs/designs/2026-05-26-codex-session-observability-dashboard.md:456`).
- Error handling also requires Diagnostics to show rollout-derived failed tools when `logs_2.sqlite` is missing (`docs/designs/2026-05-26-codex-session-observability-dashboard.md:448`).
- Phase 5 service wiring covers structured diagnostics, warning badges, raw tail, partial errors, and final hardening, but no failed-command/failed-tool diagnostics row (`docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md:65`-`69`).
- Phase 5 Task 1 only asserts warning counts and loudest targets (`...phase-5-diagnostics-hardening.md:90`-`104`), and Task 2 E2E only asserts filters, scope, loudest links, badges, and raw tail (`...phase-5-diagnostics-hardening.md:125`-`139`).

**Impact:** The plan set can complete all gates while missing one of the required Diagnostics panels and the specified fallback path from parsed rollout facts.

**Recommended plan edits:**
- Add a Phase 5 service-wiring row for `Failed command summaries`, with surface `Diagnostics failed-command panel`, service `getDiagnosticsSummary` plus cached rollout failed-tool facts, persistence `rollout cache` and optional `logs_2.sqlite`, and E2E/integration evidence.
- Add failed-command summary assertions to Task 1 or Task 2 and the Phase Acceptance Gate.
- Ensure the acceptance packet records behavior when `logs_2.sqlite` is unavailable but Phase 3 cached rollout failed-tool facts exist.

### Finding 2: Medium - Runtime no-network/font restrictions are not explicitly planned or gated

**Affected plans:** Phase 1 and Phase 5, especially `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-1-fixture-shell.md` and `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`

**Evidence:**
- The technical design forbids "telemetry, export, external fonts loaded at runtime, remote assets, command execution, or editor-launch behavior" in v0.1 and says prototype Google Fonts must be self-hosted or replaced (`docs/designs/2026-05-26-codex-session-observability-dashboard.md:412`).
- Phase 1 ports the prototype visual shell and styles but does not name a self-host/system-font requirement in the File Map, task acceptance, or acceptance gate (`...phase-1-fixture-shell.md:50`-`60`, `...phase-1-fixture-shell.md:143`-`170`, `...phase-1-fixture-shell.md:241`-`256`).
- Phase 5 `privacy:check` verifies redaction, base-instruction absence, raw gating, local path allowlists, and no export/editor/command endpoints, but does not explicitly verify no external fonts, remote assets, or telemetry/network egress (`...phase-5-diagnostics-hardening.md:256`-`257`).

**Impact:** The implementation could accidentally retain prototype Google Fonts or another runtime network dependency and still satisfy the written plan gates.

**Recommended plan edits:**
- In Phase 1 Task 3, require replacing external font links with local/system stacks or self-hosted assets and add a focused test or static check.
- In Phase 5 `privacy:check`, require a Playwright network assertion or static bundle check that blocks remote fonts, remote assets, telemetry, export endpoints, editor-launch endpoints, and command-execution endpoints.
- Add the no-network/runtime-assets rule to the Phase 5 acceptance packet evidence.

### Finding 3: Medium - Phase 5 parallelism is unsafe around shared contracts, API client, app shell, path guards, and E2E files

**Affected plans:** `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-5-diagnostics-hardening.md`

**Evidence:**
- The Phase Execution Contract says Diagnostics and Hardening/QA can overlap after route/error-envelope stability (`...phase-5-diagnostics-hardening.md:24`-`29`), while Codex Efficiency Rules warn to delegate only when write sets do not overlap (`...phase-5-diagnostics-hardening.md:35`-`39`).
- Task 2 modifies `DiagnosticsView`, `SessionsView`, `App`, `frontend/api/client`, `backend/api/diagnostics`, `backend/codexPaths`, and shared styles (`...phase-5-diagnostics-hardening.md:114`-`118`).
- Task 3, planned parallel with Task 2, modifies `shared/contracts`, `redaction`, `backend/codexPaths`, `App`, and all affected view error states, and shares the same `diagnostics-hardening.spec.ts` test file (`...phase-5-diagnostics-hardening.md:147`-`151`).

**Impact:** Two sub-agents can concurrently edit the same source and test surfaces, especially `App`, `codexPaths`, diagnostics E2E, error envelopes, and frontend API behavior. That creates merge churn and a real risk of incompatible privacy/error semantics.

**Recommended plan edits:**
- Make Task 3 phase-owner only until the error envelope, redaction, and path-guard changes are committed.
- Let Task 2 run after Task 1 and after the Task 3 contract/path-guard decisions are complete, or split Task 3 into a contract/source-safety pre-task and a later view-state hardening task.
- Reserve `tests/e2e/diagnostics-hardening.spec.ts`, `src/frontend/App.tsx`, `src/backend/codexPaths.ts`, and `src/frontend/api/client.ts` to the phase owner during integration checkpoints.

### Finding 4: Low - Autonomy tables include routine local setup/tooling as escalation categories

**Affected plans:** all phase plans, most clearly Phases 1-5 autonomy tables.

**Evidence:**
- The implementation-planning reference allows escalation for credentials/secrets, paid/vendor setup, product/legal/security decisions, destructive production actions, real customer data access, or unavailable devices/services after agent-owned attempts. Routine local setup should remain agent-owned workflow.
- Phase 1 escalates Node/npm toolchain and browser automation runtime (`...phase-1-fixture-shell.md:45`-`46`).
- Phase 2 escalates SQLite native dependency installation/build (`...phase-2-sessions-index.md:46`).
- Phase 3 escalates cache directory write permission (`...phase-3-timeline-cache.md:46`).
- Phase 4 escalates graph layout library installation (`...phase-4-graph-tokens.md:45`).
- Phase 5 escalates accessibility/performance browser tooling (`...phase-5-diagnostics-hardening.md:47`).

**Impact:** The plans mostly keep these agent-owned, but placing routine setup and package/tool installation in `Autonomy And Escalation` blurs the allowed exception model and can cause phase owners to stop earlier than intended.

**Recommended plan edits:**
- Move routine local setup/tooling items into `Test Mode Disclosure`, prerequisites, or acceptance-packet evidence.
- Keep `Autonomy And Escalation` limited to allowed categories, such as private real data requirements or user-required vendor/product/security decisions.
- For unavailable local tooling, state that the phase owner documents the failure and uses repo-supported alternatives when possible, without treating routine install/build work as an external escalation.

### Finding 5: Low - Phase 1 lint fallback weakens a required design-token gate

**Affected plans:** `docs/plans/2026-05-26-codex-session-observability-dashboard-phase-1-fixture-shell.md`

**Evidence:**
- The design requires component styles to use CSS custom properties and limits raw hex values to token definitions and palette overrides (`docs/designs/2026-05-26-codex-session-observability-dashboard.md:221`).
- Phase 1 acceptance says lint should catch raw component hex "if the lint rule is available", otherwise the packet records a targeted `rg` check (`...phase-1-fixture-shell.md:248`-`249`).

**Impact:** The acceptance gate can pass with an ad hoc evidence note instead of a reproducible command that future phases inherit.

**Recommended plan edits:**
- Add a deterministic script such as `npm run lint:styles` or `npm run tokens:check` in Phase 1.
- Require later phases to run the same script when they modify `src/frontend/styles/*` or component styles.

## Coverage Matrix

| Design / Requirement Area | Plan Coverage | Review Notes |
| --- | --- | --- |
| Bootstrap Vite/React/Node/shared contracts | Phase 1 | Strong vertical fixture shell with Playwright established early. |
| Five view shell and prototype visual baseline | Phase 1, extended in Phases 2-5 | Mostly covered; no-network/font replacement needs explicit gate. |
| Read-only `state_5.sqlite` Sessions index | Phase 2 | Covered with temp SQLite fixtures, path guard, first-paint perf, filters, and child/open counts. |
| No JSONL on Sessions first paint | Phase 2 and Phase 3 acceptance | Covered explicitly. |
| Streaming rollout parser, redaction, cache | Phase 3 | Covered with unit/integration/perf/E2E and selected-session tail. |
| Timeline UI, scrubber, collapsed tool outputs | Phase 3 | Covered. |
| Agent Graph and Tokens | Phase 4 | Covered with graph/token APIs and E2E. Depth-2 default matches technical design; deeper auto-layout from the prototype handoff is effectively deferred by the design. |
| Structured Diagnostics, warning badges, raw tail | Phase 5 | Mostly covered, but failed-command summaries and rollout-derived fallback are missing. |
| Privacy/security boundaries | Phases 2, 3, 5 | Redaction, path guards, raw gating, no command/editor/export endpoints covered; external fonts/assets/telemetry gate is weak. |
| Accessibility and reduced motion | Phases 1 and 5 | Covered by final a11y gate; Phase 1 includes early shell semantics. |
| Performance | Phases 2, 3, 5 | Sessions and rollout perf covered early; final graph/diagnostics/live-tail perf covered in Phase 5. |
| Error handling and partial data | Phase 5 | Covered late but with automated gates. Missing failed-tools fallback detail should be added. |
| E2E harness | Phase 1 onward | Playwright is established early and extended per integration phase. |

## Phase Boundary Review

- The phase sequence is vertical and smoke-testable. Phase 1 brings up the fixture app, Phase 2 makes Sessions real, Phase 3 makes selected Timeline real, Phase 4 completes Graph/Tokens, and Phase 5 completes Diagnostics and hardening.
- There is no major horizontal backend-first/frontend-later split. Each real source is paired with the browser surface and E2E evidence in the same phase.
- Moving selected-session rollout tail into Phase 3 is acceptable because it shares byte-offset/cache semantics with Timeline. Raw TUI tail remains correctly scoped to Phase 5.
- Phase sizes are coherent for one long-running phase owner. Phase 5 is the broadest, but the plan has bounded diagnostics and hardening lanes; the unsafe parallel write-set issue should be fixed before execution.
- No plan task materially escapes its phase boundary. Phase 5 hardening is intentionally cross-cutting but remains within v0.1 completion scope.

## Execution Contract Review

- Every plan has a `Phase Execution Contract`, task-level `Execution` lines, `Service Wiring Matrix`, task-level `Service Wiring Rows Covered`, `E2E Harness Readiness`, `Agent-Run Acceptance`, `Test Mode Disclosure`, and `Phase Acceptance Gate`.
- Delegation is not overly granular. Plans use one or two sub-agent lanes plus phase-owner integration work, which is appropriate for Codex execution.
- Integration checkpoints are present after delegated work, but Phase 5 needs stronger serialization around shared contracts, path guards, app shell, and E2E files.
- Autonomy sections exist, but several entries should be moved out of escalation tables because they are routine local setup/tooling rather than allowed external exception categories.

## Verification Review

- Web phases use Playwright or Playwright-backed scripts, and the harness is established in Phase 1 rather than deferred to the end.
- E2E coverage is added as service wiring lands, not as a late-only QA task.
- Phase acceptance gates cover their listed service-wiring rows.
- Main verification gaps are failed-command Diagnostics coverage, runtime no-network/no-external-fonts privacy gating, and deterministic style-token linting.

## Recommended Plan Edits

1. Update Phase 5 service wiring, tasks, and acceptance gate for failed-command summaries and `logs_2.sqlite`-missing fallback from rollout cache.
2. Add explicit no external fonts/assets/telemetry checks to Phase 1 and Phase 5, with reproducible commands or Playwright network assertions.
3. Serialize Phase 5 Task 2 and Task 3 shared write sets, or split Task 3 so contract/path-guard hardening lands before Diagnostics UI work.
4. Move routine local setup/tooling items out of `Autonomy And Escalation`; keep only allowed escalation categories.
5. Replace Phase 1's conditional raw-hex lint fallback with a deterministic style-token check that later phases inherit.

## Severity Counts

| Severity | Count |
| --- | ---: |
| High | 0 |
| Medium | 3 |
| Low | 2 |

## Blocking Status

**Blocking:** Yes. The Medium findings should be resolved before implementation execution because they can allow required diagnostics behavior, privacy/network constraints, or Phase 5 integration safety to fail while the written acceptance gates still pass.
