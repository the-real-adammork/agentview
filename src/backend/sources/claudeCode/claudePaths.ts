import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve, sep } from "node:path";

/**
 * Path resolution for Claude Code (CC) transcripts, mirroring `src/backend/codexPaths.ts`.
 * CC transcripts live under `~/.claude/projects/<escaped-cwd>/<session-uuid>.jsonl`
 * (override the projects root via `CLAUDE_PROJECTS_DIR`). The traversal guard keeps
 * every resolved transcript path inside the projects root so an attacker-controlled
 * session id cannot escape it.
 */
export class ClaudePathError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ClaudePathError";
    this.code = code;
  }
}

export interface ResolveClaudeProjectsDirOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

const ensureInside = (root: string, candidate: string) => {
  if (candidate === root || candidate.startsWith(`${root}${sep}`)) {
    return candidate;
  }

  throw new ClaudePathError(
    "CLAUDE_PATH_TRAVERSAL",
    `Claude source path resolves outside CLAUDE_PROJECTS_DIR: ${candidate}`,
  );
};

/**
 * Resolve the CC projects directory: `CLAUDE_PROJECTS_DIR` when set, else
 * `<homeDir>/.claude/projects`. Returns the realpath; throws a typed
 * `ClaudePathError` (`CLAUDE_PROJECTS_DIR_MISSING`) when the directory does not exist.
 */
export const resolveClaudeProjectsDir = async ({
  env = process.env,
  homeDir = homedir(),
}: ResolveClaudeProjectsDirOptions = {}) => {
  const configured = env.CLAUDE_PROJECTS_DIR?.trim();
  const projectsDir = configured && configured.length > 0 ? configured : resolve(homeDir, ".claude", "projects");

  try {
    return await realpath(resolve(projectsDir));
  } catch (error) {
    throw new ClaudePathError(
      "CLAUDE_PROJECTS_DIR_MISSING",
      `Unable to resolve CLAUDE_PROJECTS_DIR at ${resolve(projectsDir)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

/**
 * Escape an absolute cwd into a CC project directory name, replacing `/` and `.`
 * with `-` (e.g. `/Users/adam/Projects/agentview` → `-Users-adam-Projects-agentview`).
 */
export const escapeCwd = (cwd: string) => cwd.replace(/[/.]/g, "-");

/**
 * Best-effort inverse of Claude Code's project directory escape. The encoding is
 * lossy because real hyphens, path separators, and dots can all collapse to `-`.
 * Use this only as a fallback when transcript lines do not stamp `cwd`.
 */
export const cwdFromEscapedProjectName = (projectName: string): string => {
  if (!projectName) return "";
  const withHiddenSegments = projectName.replaceAll("--", "/.");
  const decoded = withHiddenSegments.replaceAll("-", "/").replace(/\/+/g, "/");
  return decoded.startsWith("/") ? decoded : `/${decoded}`;
};

export const cwdFromProjectDir = (projectDir: string): string => cwdFromEscapedProjectName(basename(projectDir));

/**
 * Resolve a transcript-relative path under the projects root, rejecting absolute
 * paths and any path that escapes the root via traversal.
 */
export const resolveClaudeSessionPath = async (projectsDir: string, relPath: string) => {
  const root = await realpath(resolve(projectsDir));

  if (isAbsolute(relPath)) {
    throw new ClaudePathError(
      "CLAUDE_PATH_TRAVERSAL",
      `Absolute Claude source paths are not allowed: ${relPath}`,
    );
  }

  return ensureInside(root, resolve(root, relPath));
};
