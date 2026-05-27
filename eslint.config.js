import js from "@eslint/js";
import tseslint from "typescript-eslint";

const browserGlobals = {
  document: "readonly",
  fetch: "readonly",
  HTMLElement: "readonly",
  URL: "readonly",
  window: "readonly",
};

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
};

export default tseslint.config(
  {
    ignores: [
      ".worktrees/**",
      "coverage/**",
      "dist/**",
      "docs/design/**",
      "docs/implementation-runs/**",
      "docs/qa/artifacts/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/frontend/**/*.{ts,tsx}", "tests/unit/**/*.{ts,tsx}"],
    languageOptions: {
      globals: browserGlobals,
    },
  },
  {
    files: [
      "*.config.{js,ts}",
      "eslint.config.js",
      "scripts/**/*.{js,mjs,cjs}",
      "src/backend/**/*.ts",
      "tests/e2e/**/*.ts",
    ],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
);
