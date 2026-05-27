import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const frontendDir = join(root, "src", "frontend");
const allowedTokenFile = join(frontendDir, "styles", "tokens.css");
const rawHexPattern = /#[0-9a-fA-F]{3,8}\b/g;
const externalRuntimePattern = /(@import\s+url\(|https?:\/\/|\/\/)/i;

const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (/\.(css|tsx?|jsx?)$/.test(path)) {
      files.push(path);
    }
  }
}

walk(frontendDir);

const violations = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const displayPath = relative(root, file);

  if (file !== allowedTokenFile) {
    const rawHex = source.match(rawHexPattern);
    if (rawHex) {
      violations.push(`${displayPath}: raw hex color outside src/frontend/styles/tokens.css`);
    }
  }

  if (externalRuntimePattern.test(source)) {
    violations.push(`${displayPath}: external runtime asset or font reference`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("style token check passed");
