# Use The Repo Playwright Harness First

## Problem
AgentView already has a Playwright harness that owns API startup, Vite startup, fixture data, and isolated ports. Reaching first for the in-app Browser plugin or ad hoc Playwright against manually started servers bypasses that repeatable setup and can turn normal UI verification into server and port debugging.

## Solution
For AgentView UI verification, start with the repo's Playwright command: `npm run e2e`, or a focused grep such as `npm run e2e -- --grep @timeline`. Add or extend an e2e spec and fixture when a feature needs browser proof; reserve ad hoc Playwright for supplemental real-data smoke checks after the canonical harness passes or when explicitly testing a real local session outside fixtures.

## Playbook
- Check `playwright.config.ts` before manually starting UI servers; it already starts the API and Vite web server.
- Use `npm run e2e` for full browser verification, or a focused grep for the affected flow.
- When a feature is not covered by fixtures, extend the relevant `tests/e2e` fixture/spec so future agents can rerun the same proof.
- Use ad hoc Playwright only as supplemental evidence for real local data that the fixture harness intentionally does not cover.

## Evidence
- `playwright.config.ts` - defines the API and Vite web servers, isolated ports, and fixture `CODEX_HOME` used by `npm run e2e`.
