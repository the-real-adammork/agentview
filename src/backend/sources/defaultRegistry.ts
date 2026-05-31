import { homedir } from "node:os";
import { resolve } from "node:path";

import { resolveCodexHome } from "../codexPaths";
import { resolveClaudeProjectsDir } from "./claudeCode/claudePaths";
import { createClaudeCodeSource } from "./claudeCode/ClaudeCodeSource";
import { createCodexSource } from "./codex/CodexSource";
import { createSourceRegistry, type SourceRegistry } from "./registry";

/**
 * Resolve the CC projects dir, tolerating a missing directory. `resolveClaudeProjectsDir`
 * throws `CLAUDE_PROJECTS_DIR_MISSING` when the configured/default dir is absent; the
 * registry still registers a CC source pointed at that path so `getHealth` reports
 * `available:false` (and the merged list fans out to an empty CC list) rather than
 * crashing the whole registry.
 */
const resolveClaudeProjectsDirTolerant = async (): Promise<string> => {
  try {
    return await resolveClaudeProjectsDir();
  } catch {
    const configured = process.env.CLAUDE_PROJECTS_DIR?.trim();
    return configured && configured.length > 0 ? resolve(configured) : resolve(homedir(), ".claude", "projects");
  }
};

/**
 * Build the per-request source registry, mirroring the existing per-request
 * `openStateStore` lifecycle: each handler constructs a registry, uses it, and
 * `close()`s it in a `finally`. Codex and Claude Code are both registered; the
 * merged fan-out interleaves their sessions and `close()` disposes each source.
 */
export const createDefaultRegistry = async (): Promise<SourceRegistry> => {
  const codexHome = await resolveCodexHome();
  const projectsDir = await resolveClaudeProjectsDirTolerant();
  return createSourceRegistry([createCodexSource({ codexHome }), createClaudeCodeSource({ projectsDir })]);
};
