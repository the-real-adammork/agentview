import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const backendRoot = join(root, "src", "backend");
const frontendRoot = join(root, "src", "frontend");
const sourceRoots = [backendRoot, frontendRoot];
const disallowedEndpointPattern = /\/api\/(?:export|editor|commands?|telemetry)\b/i;
const remoteAssetPattern = /https?:\/\/(?!127\.0\.0\.1(?::|\/|$)|localhost(?::|\/|$))/i;

const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (/\.(tsx?|jsx?|css)$/.test(path)) {
      files.push(path);
    }
  }
}

for (const sourceRoot of sourceRoots) {
  walk(sourceRoot);
}

const violations = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const displayPath = relative(root, file);

  if (disallowedEndpointPattern.test(source)) {
    violations.push(`${displayPath}: disallowed export/editor/command/telemetry endpoint reference`);
  }

  if (file.startsWith(frontendRoot) && remoteAssetPattern.test(source)) {
    violations.push(`${displayPath}: non-local runtime URL reference`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("privacy check passed");
