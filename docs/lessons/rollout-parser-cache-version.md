# Rollout Parser Changes Need Cache-Version Verification

## Problem
Rollout parser changes can look correct in unit tests while the live API still serves old parsed facts from disk cache. The cache is keyed by source path, mtime, size, cache schema, and parser version, so changing parser behavior without changing `ROLLOUT_PARSER_VERSION` can leave real sessions rendering stale event shapes.

## Solution
Bump `ROLLOUT_PARSER_VERSION` whenever a Codex rollout parser change affects `CachedRolloutFacts`, including event kinds, previews, derived facts, structured render payloads, or warnings. Restart the API and verify a real `/api/timeline` response shows the new parser version and expected event shape before treating the UI as verified.

## Playbook
- Before editing `src/backend/rollout/parseRollout.ts` or parser helpers that feed cached facts, decide whether the normalized timeline payload changes.
- If cached facts change, bump `ROLLOUT_PARSER_VERSION` in `src/backend/rollout/parseRollout.ts`.
- After restarting the API, request a real timeline such as `/api/timeline?threadId=<thread-id>` and confirm `parserVersion` and the new event shape are present.
- Keep focused parser/unit tests, but do not rely on them alone for real-session cache behavior.

## Evidence
- `src/backend/rollout/parseRollout.ts` - the subagent notification parser change needed a parser-version bump before the live API stopped serving stale cached facts.
