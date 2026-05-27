import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

export class CodexPathError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CodexPathError";
    this.code = code;
  }
}

export interface ResolveCodexHomeOptions {
  env?: Record<string, string | undefined>;
  homeDir?: string;
}

const ensureInside = (root: string, candidate: string) => {
  if (candidate === root || candidate.startsWith(`${root}${sep}`)) {
    return candidate;
  }

  throw new CodexPathError(
    "CODEX_PATH_TRAVERSAL",
    `Codex source path resolves outside CODEX_HOME: ${candidate}`,
  );
};

export const resolveCodexHome = async ({
  env = process.env,
  homeDir = homedir(),
}: ResolveCodexHomeOptions = {}) => {
  const configuredHome = env.CODEX_HOME?.trim();
  const codexHome = configuredHome && configuredHome.length > 0 ? configuredHome : resolve(homeDir, ".codex");

  try {
    return await realpath(resolve(codexHome));
  } catch (error) {
    throw new CodexPathError(
      "CODEX_HOME_MISSING",
      `Unable to resolve CODEX_HOME at ${resolve(codexHome)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const resolveCodexSourcePath = async (codexHome: string, sourcePath: string) => {
  const root = await realpath(resolve(codexHome));

  if (isAbsolute(sourcePath)) {
    throw new CodexPathError(
      "CODEX_PATH_TRAVERSAL",
      `Absolute Codex source paths are not allowed: ${sourcePath}`,
    );
  }

  return ensureInside(root, resolve(root, sourcePath));
};
