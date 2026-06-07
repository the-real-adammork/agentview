import { readdir } from "node:fs/promises";
import { join } from "node:path";

export interface ClaudeSubagentTranscriptFile {
  id: string;
  name: string;
  dir: string;
  path: string;
  sortKey: string;
}

const isAgentTranscript = (name: string): boolean => name.startsWith("agent-") && name.endsWith(".jsonl");

export const findSubagentTranscriptFiles = async (subagentsDir: string): Promise<ClaudeSubagentTranscriptFile[]> => {
  const files: ClaudeSubagentTranscriptFile[] = [];

  const walk = async (dir: string, relativeDir = ""): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);
      const relativePath = relativeDir ? join(relativeDir, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(path, relativePath);
      } else if (entry.isFile() && isAgentTranscript(entry.name)) {
        files.push({
          id: entry.name.slice(0, -".jsonl".length),
          name: entry.name,
          dir,
          path,
          sortKey: relativePath,
        });
      }
    }
  };

  await walk(subagentsDir);
  return files.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
};
