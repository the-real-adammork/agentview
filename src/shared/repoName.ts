const repoNameFromOrigin = (origin: string): string | null => {
  let value = origin.trim();
  if (!value) {
    return null;
  }

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // strip protocol (https://, ssh://, git://)
  value = value.replace(/^[^/@]+@/, ""); // strip userinfo / scp user@ prefix
  value = value.replace(/\/+$/, ""); // strip trailing slashes
  value = value.replace(/\.git$/i, ""); // strip the .git suffix

  return value.split(/[/:]/).filter(Boolean).at(-1) ?? null;
};

const pathBasename = (cwd: string): string =>
  cwd
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .filter(Boolean)
    .at(-1) ?? cwd;

/**
 * Resolves the human-facing repository name for a session.
 *
 * Prefers the actual repo name parsed from the git origin URL (so worktrees and
 * monorepo subdirectories of the same repo collapse together), and falls back to
 * the working directory's basename when no origin URL is recorded.
 */
export const deriveRepoName = (gitOriginUrl: string | null | undefined, cwd: string): string => {
  const fromOrigin = gitOriginUrl ? repoNameFromOrigin(gitOriginUrl) : null;
  return fromOrigin ?? pathBasename(cwd);
};
