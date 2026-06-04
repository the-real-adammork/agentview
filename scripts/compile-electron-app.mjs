#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const usage = `Usage: npm run compile:electron -- [options]

Compiles the full Electron app into release/.

Options:
  --clean-install  Run npm ci even when node_modules already exists.
  --skip-install   Do not install dependencies before compiling.
  --dist           Run electron-builder's configured distribution target instead of --dir.
  --help           Show this help message.
`;

export function createCompileSteps({
  hasNodeModules = existsSync(path.join(repoRoot, "node_modules")),
  cleanInstall = false,
  skipInstall = false,
  dist = false,
} = {}) {
  const steps = [];

  if (!skipInstall && (cleanInstall || !hasNodeModules)) {
    steps.push({
      label: "Install dependencies",
      command: npmCommand,
      args: ["ci"],
    });
  }

  steps.push(
    {
      label: "Typecheck",
      command: npmCommand,
      args: ["run", "typecheck"],
    },
    {
      label: "Build renderer and Electron",
      command: npmCommand,
      args: ["run", "build"],
    },
    {
      label: dist ? "Package Electron distribution" : "Package Electron app",
      command: npmCommand,
      args: dist
        ? ["exec", "electron-builder"]
        : ["exec", "electron-builder", "--", "--dir"],
    },
  );

  return steps;
}

export async function runCompileSteps(steps, runStep = runCommand) {
  for (const step of steps) {
    await runStep(step);
  }
}

function parseArgs(args) {
  const options = {
    cleanInstall: false,
    skipInstall: false,
    dist: false,
  };

  for (const arg of args) {
    if (arg === "--clean-install") {
      options.cleanInstall = true;
    } else if (arg === "--skip-install") {
      options.skipInstall = true;
    } else if (arg === "--dist") {
      options.dist = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, options };
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.cleanInstall && options.skipInstall) {
    throw new Error("--clean-install and --skip-install cannot be used together.");
  }

  return { help: false, options };
}

function runCommand(step) {
  console.log(`\n> ${step.label}`);
  console.log(`$ ${[step.command, ...step.args].join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const suffix =
        signal == null ? `exit code ${code}` : `signal ${signal}`;
      reject(new Error(`${step.label} failed with ${suffix}.`));
    });
  });
}

async function main() {
  const { help, options } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log(usage);
    return;
  }

  const steps = createCompileSteps(options);
  await runCompileSteps(steps);

  console.log("\nElectron compile complete. Output is in release/.");
}

const directRunPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (directRunPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  });
}
