import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { cwdFromEscapedProjectName } from "./claudePaths";
import { findSubagentTranscriptFiles } from "./subagentFiles";

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
  /** Best-effort cwd decoded from `<escaped-cwd>`; transcript-stamped cwd wins when present. */
  cwdFromProjectDir: string;
  subagentsDir: string;
  childCount: number;
}

/**
 * Count `agent-*.jsonl` files anywhere below a `subagents/` directory (excluding
 * the `agent-*.meta.json` sidecars). Claude Workflow transcripts live under
 * `subagents/workflows/<run>/`, so discovery must include nested files.
 */
export const countSubagents = async (subagentsDir: string): Promise<number> => {
  const files = await findSubagentTranscriptFiles(subagentsDir);
  return files.length;
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
    const cwdFromProjectDir = cwdFromEscapedProjectName(projectEntry.name);
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

      sessions.push({ sessionId, transcriptPath, projectDir, cwdFromProjectDir, subagentsDir, childCount });
    }
  }

  return sessions;
};
