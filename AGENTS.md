## Lessons

### Rollout Parser Changes Need Cache-Version Verification

Rollout parser changes can pass unit tests while the live API serves stale parsed facts from disk cache. When parser behavior changes cached timeline facts, bump `ROLLOUT_PARSER_VERSION` and verify a real `/api/timeline` response reports the new parser version and expected event shape.

See [Rollout Parser Changes Need Cache-Version Verification](docs/lessons/rollout-parser-cache-version.md) for the solution/playbook.

### Use The Repo Playwright Harness First

AgentView has a Playwright harness that owns API startup, Vite startup, fixture data, and isolated ports. For normal UI verification, use `npm run e2e` or a focused grep before reaching for manually started servers or ad hoc browser scripts.

See [Use The Repo Playwright Harness First](docs/lessons/use-repo-playwright-harness-first.md) for the solution/playbook.
