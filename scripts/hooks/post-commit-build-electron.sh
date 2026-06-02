#!/usr/bin/env bash
set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" || exit 0

echo "post-commit: rebuilding Electron entrypoints..."

if npm run build:electron; then
  echo "post-commit: Electron rebuild complete."
else
  echo "post-commit: Electron rebuild failed; commit was already created." >&2
fi

exit 0
