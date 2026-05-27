# Codex Session Observability Dashboard Phase 1 Implementation Plan

**Goal:** Bootstrap the TypeScript app, local API boundary, shared contracts, fixture transport, five-view shell, visual tokens, and E2E harness.

**Phase Boundary:** This phase delivers a working fixture-backed Observatory shell only. Later phases replace fixture handlers with read-only Codex sources while preserving the contracts, scripts, route structure, and visual foundation created here.

**Verification:** `npm install`, `npm run typecheck`, `npm run test -- --run`, `npm run lint`, `npm run tokens:check`, `npm run e2e`

**Smoke-Testable Outcome:** A developer can run the local app, open every required view, see persistent hazard/status chrome, and verify browser-to-fixture API wiring through Playwright.

**Phase Acceptance:** Playwright launches the Vite app and local API, visits Sessions, Timeline, Agent Graph, Tokens, and Diagnostics in fixture mode, and saves `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-1.md`.

## Phase Execution Contract

**Execution Model:** One long-running phase owner agent owns the phase from kickoff through acceptance. Sub-agents may implement bounded tasks, but the phase owner remains responsible for sequencing, integration, verification, the acceptance packet, and downstream assumptions.

**Phase Owner Responsibilities:**
- Maintain the phase branch/worktree and current understanding of completed work.
- Keep package/config edits serialized because all later tasks depend on the scripts and module layout.
- Integrate sub-agent results promptly and rerun typecheck, unit tests, lint, and Playwright after each lane returns.
- Keep the phase acceptance packet current enough that a context handoff can resume from files, not chat history.
- Block only for allowed escalations.

**Sub-Agent Delegation Map:**
| Lane | Task(s) | Delegation Decision | Can Run In Parallel With | Shared Resources / Collision Risk | Integration Checkpoint |
| --- | --- | --- | --- | --- | --- |
| Contract/test harness | Task 2, Task 4 | one sub-agent after Task 1 | UI shell lane | `src/shared/*`, `tests/*`, `playwright.config.ts` | `npm run typecheck && npm run test -- --run && npm run e2e` |
| UI shell | Task 3 | one sub-agent after Task 1 and Task 2 contracts | Contract/test harness after contract shape is fixed | `src/frontend/*`, `src/frontend/styles/*` | Browser smoke screenshots and Playwright view navigation |
| Integration | Task 5 | phase-owner only | None | All app files and acceptance packet | Full command set and packet update |

**Long-Running Handoff:**
- Handoff path: `docs/handoffs/2026-05-26-codex-session-observability-dashboard-phase-1-handoff.md`
- Required contents: current task status, branch/worktree, sub-agent results, verification evidence, service-wiring coverage, acceptance packet status, blockers/escalations, and exact restart instructions.

## Codex Efficiency Rules

- Keep scaffold/config work with the phase owner to avoid conflicting package and script edits.
- Delegate only the contract/test harness and UI shell lanes after exact file ownership is clear.
- Do not implement real Codex file, SQLite, JSONL, or log access in this phase.

## Autonomy And Escalation

| Escalation | Needed By | Agent-Owned Attempt First | Escalate Only If | Blocking Behavior |
| --- | --- | --- | --- | --- |
| None expected | Not applicable | Local toolchain setup, dependency install, and Playwright browser setup are agent-owned implementation work and must be handled through repo scripts or documented alternatives. | Not applicable. | No external escalation is planned for this phase. |

---

## File Map

- Create: `package.json` - scripts and dependencies for Vite, React, TypeScript, Node API, Vitest, lint, and Playwright.
- Create: `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts` - app, test, and E2E configuration.
- Create: `src/shared/contracts.ts` - transport-neutral request/response envelopes, five-view contracts, fixture entity types, and `ObservatoryApi`.
- Create: `src/shared/redaction.ts` - deterministic preview redaction stub and tests target for later phases.
- Create: `src/backend/server.ts`, `src/backend/api/fixtures.ts` - local-only API server and fixture handlers.
- Create: `src/frontend/main.tsx`, `src/frontend/App.tsx`, `src/frontend/api/client.ts`, `src/frontend/views/*.tsx`, `src/frontend/components/*.tsx`, `src/frontend/styles/*.css` - fixture-backed React app shell ported from prototype primitives.
- Create: `src/fixtures/observatoryFixtures.ts` - typed fixture data derived from `docs/design/workflowkit-evangelion/mock.js`.
- Create: `tests/unit/*.test.ts`, `tests/e2e/observatory-shell.spec.ts`, `scripts/check-style-tokens.mjs` - contract, redaction, fixture, deterministic style-token/runtime asset checks, and browser smoke coverage.
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-1.md` - acceptance evidence packet.

## Service Wiring Matrix

| Flow | User/Runtime Surface | API/Service | Persistence | Jobs/Queues | External/Local Integration | Required Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| App health | Browser app boot | `getHealth()` fixture/local handler | None | None | Local Node API bound to loopback | Playwright sees healthy status chrome and API response test passes. |
| Fixture sessions navigation | Sessions row click and primary nav | `ObservatoryApi` fixture methods | Fixture module | None | Vite dev server + local API | Playwright navigates through all five views without network errors. |
| Visual shell | App shell and shared components | React components/styles | None | None | Prototype files as source reference | DOM assertions for hazard strip/status bar/tables/focusable nav. |
| Runtime asset safety | App shell and bundled styles | Style-token check and Playwright network guard | None | None | Local bundle only | `npm run tokens:check` rejects raw component hex and runtime external fonts/assets. |

## E2E Harness Readiness

Create Playwright in Task 4 before feature integration is complete so every later phase can extend the same browser harness. The harness must start the local API and Vite app through repo scripts and avoid relying on manually running servers.

### Task 1: Bootstrap Package, Scripts, And TypeScript Layout

**Depends On:** None

**Execution:** phase-owner; parallel with none; checkpoint `npm run typecheck`

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`
- Create: `src/frontend/main.tsx`, `src/backend/server.ts`, `src/shared/contracts.ts`
- Test: `tests/unit/contracts.test.ts`

**Service Wiring Rows Covered:**
- App health

**Agent-Run Acceptance:**
- Automation command: `npm install && npm run typecheck`
- Expected result: dependencies install and TypeScript resolves the frontend, backend, and shared projects.
- Evidence to collect: dependency install summary, TypeScript output, generated lockfile.

**Test Mode Disclosure:**
- Automated tests: mocked fixtures
- Production/dev path exercised: yes, repo scripts and TypeScript module graph
- Mock-only risk: no real Codex source access exists yet
- Required real dependencies: Node/npm local runtime
- Blocking if unavailable: yes, no app can be bootstrapped without it

- [ ] Step 1: Add the package/config scaffold and a minimal compile-time contract smoke test.
- [ ] Step 2: Run `npm run typecheck` and confirm missing app files or script errors fail before implementation is complete.
- [ ] Step 3: Implement the smallest Vite/React/backend/shared module graph.
- [ ] Step 4: Run `npm run typecheck` and `npm run test -- --run`.
- [ ] Step 5: Commit this task. Suggested message: `chore: scaffold observatory app`

### Task 2: Define Shared Contracts And Fixture Data

**Depends On:** Task 1

**Execution:** sub-agent lane: Contract/test harness; parallel with Task 3 after contract exports are agreed; checkpoint `npm run test -- --run tests/unit/contracts.test.ts`

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/shared/redaction.ts`
- Create: `src/fixtures/observatoryFixtures.ts`
- Test: `tests/unit/contracts.test.ts`, `tests/unit/redaction.test.ts`

**Service Wiring Rows Covered:**
- Fixture sessions navigation

**Agent-Run Acceptance:**
- Automation command: `npm run test -- --run tests/unit/contracts.test.ts tests/unit/redaction.test.ts`
- Expected result: fixture data satisfies `SessionSummary`, `TimelineEvent`, `AgentGraph`, `TokenSeries`, and `RuntimeLog` contracts.
- Evidence to collect: Vitest output and fixture count summary.

**Test Mode Disclosure:**
- Automated tests: mocked fixtures
- Production/dev path exercised: no, contract-only fixture path
- Mock-only risk: schema drift in real Codex sources remains untested until later phases
- Required real dependencies: none beyond local test runtime
- Blocking if unavailable: no

- [ ] Step 1: Write tests that fixture payloads satisfy the shared contracts and `ApiResult<T>` envelope.
- [ ] Step 2: Run focused tests and confirm missing fields fail.
- [ ] Step 3: Port representative mock data into typed fixtures and add a conservative redaction helper stub.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: add observatory shared contracts`

### Task 3: Port The Fixture-Backed Five-View Shell

**Depends On:** Task 1, Task 2

**Execution:** sub-agent lane: UI shell; parallel with Task 4; checkpoint `npm run typecheck`

**Files:**
- Modify: `src/frontend/App.tsx`, `src/frontend/api/client.ts`
- Create: `src/frontend/views/SessionsView.tsx`, `src/frontend/views/TimelineView.tsx`, `src/frontend/views/AgentGraphView.tsx`, `src/frontend/views/TokensView.tsx`, `src/frontend/views/DiagnosticsView.tsx`
- Create: `src/frontend/components/Panel.tsx`, `src/frontend/components/Chrome.tsx`, `src/frontend/components/SegBar.tsx`, `src/frontend/components/ShortId.tsx`
- Create: `src/frontend/styles/tokens.css`, `src/frontend/styles/app.css`
- Create: `scripts/check-style-tokens.mjs`
- Test: `tests/unit/app-shell.test.tsx`

**Service Wiring Rows Covered:**
- Fixture sessions navigation
- Visual shell
- Runtime asset safety

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run tests/unit/app-shell.test.tsx && npm run tokens:check`
- Expected result: all views render from fixtures with persistent top hazard strip and bottom status bar; component styles use CSS variables; external runtime fonts/assets are absent or self-hosted.
- Evidence to collect: test output and screenshots if available.

**Test Mode Disclosure:**
- Automated tests: mocked fixtures
- Production/dev path exercised: yes, React rendering and fixture transport
- Mock-only risk: no real API latency or source errors yet
- Required real dependencies: local browser only for later Playwright task
- Blocking if unavailable: no

- [ ] Step 1: Write a render test for five nav buttons, app chrome, real table headers, and active row state.
- [ ] Step 2: Run the focused test and confirm shell/components are missing.
- [ ] Step 3: Implement the fixture-backed UI shell using CSS variables, square 1px panels/tables, uppercase chrome, tabular numerals, reduced-motion gates, local/system font stacks or self-hosted assets, and no raw component hex outside token definitions.
- [ ] Step 4: Run focused verification.
- [ ] Step 5: Commit this task. Suggested message: `feat: add fixture observatory shell`

### Task 4: Add Local API Fixture Server And Playwright Harness

**Depends On:** Task 1, Task 2

**Execution:** sub-agent lane: Contract/test harness; parallel with Task 3; checkpoint `npm run e2e`

**Files:**
- Modify: `src/backend/server.ts`
- Create: `src/backend/api/fixtures.ts`
- Create: `playwright.config.ts`, `tests/e2e/observatory-shell.spec.ts`
- Modify: `package.json`

**Service Wiring Rows Covered:**
- App health
- Fixture sessions navigation

**Agent-Run Acceptance:**
- Automation command: `npm run e2e`
- Expected result: Playwright starts the app/API, verifies health, navigates all five views, and fails on unexpected non-local runtime network requests.
- Evidence to collect: Playwright report path, trace/video/screenshot paths when configured.

**Test Mode Disclosure:**
- Automated tests: mocked fixtures through real local HTTP/dev server
- Production/dev path exercised: yes, local dev runtime and browser
- Mock-only risk: real Codex source reads are not exercised
- Required real dependencies: Playwright browser runtime installed by repo script
- Blocking if unavailable: yes for phase completion

- [ ] Step 1: Write a Playwright spec that visits the app, asserts local API health, clicks every primary view, and records/fails unexpected non-local network requests.
- [ ] Step 2: Run `npm run e2e` and confirm it fails before server/harness wiring exists.
- [ ] Step 3: Implement the fixture API server, dev orchestration script, and Playwright config.
- [ ] Step 4: Run `npm run e2e`.
- [ ] Step 5: Commit this task. Suggested message: `test: add observatory browser smoke`

### Task 5: Integrate Phase 1 Acceptance Packet

**Depends On:** Task 1, Task 2, Task 3, Task 4

**Execution:** phase-owner; parallel with none; checkpoint full command set

**Files:**
- Create: `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-1.md`
- Modify: any files needed for integration fixes from Tasks 1-4

**Service Wiring Rows Covered:**
- App health
- Fixture sessions navigation
- Visual shell

**Agent-Run Acceptance:**
- Automation command: `npm run typecheck && npm run test -- --run && npm run lint && npm run tokens:check && npm run e2e`
- Expected result: all Phase 1 checks pass and the acceptance packet records command outputs and evidence paths.
- Evidence to collect: command summaries, Playwright artifact paths, known fixture-only boundaries.

**Test Mode Disclosure:**
- Automated tests: mocked fixtures
- Production/dev path exercised: yes, local dev runtime and browser
- Mock-only risk: no real Codex source integration until Phase 2
- Required real dependencies: Node/npm and Playwright browser runtime
- Blocking if unavailable: yes

- [ ] Step 1: Create the acceptance packet template and list service-wiring rows.
- [ ] Step 2: Run the full command set and confirm any integration failures are visible.
- [ ] Step 3: Apply final integration fixes only inside Phase 1 scope.
- [ ] Step 4: Rerun the full command set and update the packet with evidence.
- [ ] Step 5: Commit this task. Suggested message: `docs: record phase 1 acceptance`

## Phase Acceptance Gate

**Acceptance Commands:**
- Run: `npm run typecheck`
  Expected: TypeScript compiles frontend, backend, shared, and test code.
- Run: `npm run test -- --run`
  Expected: unit/component tests pass.
- Run: `npm run lint`
  Expected: lint passes.
- Run: `npm run tokens:check`
  Expected: deterministic style-token check passes: raw hex values are limited to token/palette definitions, component styles use CSS variables, and runtime external font/asset references are absent unless self-hosted in the repo.
- Run: `npm run e2e`
  Expected: Playwright verifies API health, all five fixture-backed views, and no unexpected non-local runtime network requests.

**Required Service Wiring Coverage:**
- App health - Playwright and API test cover the local health route.
- Fixture sessions navigation - Playwright covers all five views through fixture transport.
- Visual shell - DOM/component tests cover persistent chrome, table semantics, focusable nav, and reduced-motion class handling.
- Runtime asset safety - `tokens:check` covers component color discipline and no external runtime fonts/assets.

**Acceptance Packet:** `docs/qa/phase-acceptance/2026-05-26-codex-session-observability-dashboard-phase-1.md`

**Completion Rule:** The phase cannot be marked complete until the commands pass, every applicable service-wiring row has evidence, and the acceptance packet exists with current commit evidence.
