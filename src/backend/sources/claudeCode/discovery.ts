import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * A Claude Code (CC) transcript discovered on disk. The `sessionId` is the
 * `<uuid>` from the `.jsonl` filename; `subagentsDir` is the conventional sibling
 * dir (`<uuid>/subagents`) whether or not it exists. `childCount` is the number of
 * `agent-*.jsonl` files in that dir (count only this phase; real child rows + edges
 * land in Phase 5).
 */
export interface DiscoveredClaudeSession {
  sessionId: string;
  transcriptPath: string;
  projectDir: string;
  subagentsDir: string;
  childCount: number;
}

/**
 * Count `agent-*.jsonl` files in a `subagents/` directory (excluding the
 * `agent-*.meta.json` sidecars). Returns 0 when the directory does not exist.
 */
export const countSubagents = async (subagentsDir: string): Promise<number> => {
  let entries: Dirent[];
  try {
    entries = await readdir(subagentsDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let count = 0;
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith("agent-") && entry.name.endsWith(".jsonl")) {
      count += 1;
    }
  }
  return count;
};

/**
 * Glob `<projectsDir>/<escaped-cwd>/*.jsonl` into one `DiscoveredClaudeSession`
 * each. Dependency-free (`node:fs/promises` only — no glob package, mirroring the
 * Codex code). The sibling `<uuid>/` dirs (and any nested `subagents/`) are
 * ignored as top-level rows. Returns an empty list when the projects dir is
 * missing/unreadable so the merged session fan-out tolerates an absent CC dir.
 */
export const discoverClaudeSessions = async (projectsDir: string): Promise<DiscoveredClaudeSession[]> => {
  let projectEntries: Dirent[];
  try {
    projectEntries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: DiscoveredClaudeSession[] = [];

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;

    const projectDir = join(projectsDir, projectEntry.name);
    let transcriptEntries: Dirent[];
    try {
      transcriptEntries = await readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const transcriptEntry of transcriptEntries) {
      if (!transcriptEntry.isFile() || !transcriptEntry.name.endsWith(".jsonl")) continue;

      const sessionId = transcriptEntry.name.slice(0, -".jsonl".length);
      const transcriptPath = join(projectDir, transcriptEntry.name);
      const subagentsDir = join(projectDir, sessionId, "subagents");
      const childCount = await countSubagents(subagentsDir);

      sessions.push({ sessionId, transcriptPath, projectDir, subagentsDir, childCount });
    }
  }

  return sessions;
};
