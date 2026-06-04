// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

type CompileStep = {
  label: string;
  command: string;
  args: string[];
};

type CompileElectronAppScript = {
  createCompileSteps(options?: {
    hasNodeModules?: boolean;
    cleanInstall?: boolean;
    skipInstall?: boolean;
    dist?: boolean;
  }): CompileStep[];
  runCompileSteps(
    steps: CompileStep[],
    runStep?: (step: CompileStep) => Promise<void>,
  ): Promise<void>;
};

const { createCompileSteps, runCompileSteps } =
  // @ts-expect-error The compile script is dependency-free .mjs so it can run before npm install.
  (await import("../../scripts/compile-electron-app.mjs")) as CompileElectronAppScript;

describe("compile Electron app script", () => {
  it("installs missing dependencies, checks types, builds, and packages the app", async () => {
    const steps = createCompileSteps({ hasNodeModules: false });

    expect(steps.map((step: CompileStep) => step.label)).toEqual([
      "Install dependencies",
      "Typecheck",
      "Build renderer and Electron",
      "Package Electron app",
    ]);
    expect(steps.map((step: CompileStep) => [step.command, step.args])).toEqual([
      ["npm", ["ci"]],
      ["npm", ["run", "typecheck"]],
      ["npm", ["run", "build"]],
      ["npm", ["exec", "electron-builder", "--", "--dir"]],
    ]);
  });

  it("does not reinstall dependencies when node_modules already exists", () => {
    const steps = createCompileSteps({ hasNodeModules: true });

    expect(steps.map((step: CompileStep) => step.label)).toEqual([
      "Typecheck",
      "Build renderer and Electron",
      "Package Electron app",
    ]);
  });

  it("stops at the first failed compile step", async () => {
    const steps = createCompileSteps({ hasNodeModules: true });
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("build failed"));

    await expect(runCompileSteps(steps, run)).rejects.toThrow("build failed");
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([step]) => step.label)).toEqual([
      "Typecheck",
      "Build renderer and Electron",
    ]);
  });
});
