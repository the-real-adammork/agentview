import { describe, expect, it } from "vitest";

import { classifyExecOutput } from "../../src/backend/rollout/classifyExecOutput";
import type {
  BuildOutputRender,
  ComposeOutputRender,
  DiffOutputRender,
  DiffstatOutputRender,
  GitOutputRender,
  FileOutputRender,
  HttpOutputRender,
  JsonOutputRender,
  LintOutputRender,
  LogOutputRender,
  MatchesOutputRender,
  StatusOutputRender,
  TableOutputRender,
  TestsOutputRender,
  TraceOutputRender,
  TreeOutputRender,
} from "../../src/shared/contracts";

describe("classifyExecOutput — diff", () => {
  const diff = [
    "diff --git a/src/db.rs b/src/db.rs",
    "index e69de29..d95f333 100644",
    "--- a/src/db.rs",
    "+++ b/src/db.rs",
    "@@ -40,3 +40,5 @@ pub fn open() {",
    " context line",
    "-removed line",
    "+added line one",
    "+added line two",
  ].join("\n");

  it("classifies `git diff` output into a per-file unified diff", () => {
    const render = classifyExecOutput("git diff", diff) as DiffOutputRender;
    expect(render.kind).toBe("diff");
    expect(render.files).toHaveLength(1);
    const file = render.files[0];
    expect(file.path).toBe("src/db.rs");
    expect(file.added).toBe(2);
    expect(file.removed).toBe(1);
    expect(file.hunks[0].header).toBe("@@ -40,3 +40,5 @@ pub fn open() {");
    // Marker is stripped: the renderer draws its own +/−/space glyph from `t`.
    expect(file.hunks[0].lines).toEqual([
      { t: "ctx", text: "context line" },
      { t: "del", text: "removed line" },
      { t: "add", text: "added line one" },
      { t: "add", text: "added line two" },
    ]);
  });

  it("detects a diff even when classified from output alone (no command)", () => {
    const render = classifyExecOutput(undefined, diff);
    expect(render?.kind).toBe("diff");
  });
});

describe("classifyExecOutput — tests", () => {
  it("parses a pytest summary with failing names", () => {
    const output = [
      "tests/test_parser.py::test_lazy_resume FAILED",
      "FAILED tests/test_parser.py::test_lazy_resume - assert 1 == 2",
      "FAILED tests/test_parser.py::test_eager - KeyError: 'x'",
      "=========== 2 failed, 42 passed, 1 skipped in 6.20s ===========",
    ].join("\n");
    const render = classifyExecOutput("python -m pytest -q", output) as TestsOutputRender;
    expect(render.kind).toBe("tests");
    expect(render.passed).toBe(42);
    expect(render.failed).toBe(2);
    expect(render.skipped).toBe(1);
    expect(render.durationMs).toBe(6200);
    expect(render.failing).toEqual([
      "tests/test_parser.py::test_lazy_resume",
      "tests/test_parser.py::test_eager",
    ]);
  });

  it("parses a vitest summary line", () => {
    const output = [
      " Test Files  1 failed | 4 passed (5)",
      "      Tests  3 failed | 120 passed (123)",
      "   Duration  2.34s",
    ].join("\n");
    const render = classifyExecOutput("npm test", output) as TestsOutputRender;
    expect(render.kind).toBe("tests");
    expect(render.passed).toBe(120);
    expect(render.failed).toBe(3);
    expect(render.durationMs).toBe(2340);
  });

  it("reads an all-green pytest run as quiet (no failing names)", () => {
    const render = classifyExecOutput(
      "pytest",
      "==== 18 passed in 0.42s ====",
    ) as TestsOutputRender;
    expect(render.kind).toBe("tests");
    expect(render.passed).toBe(18);
    expect(render.failed).toBe(0);
    expect(render.failing).toEqual([]);
  });
});

describe("classifyExecOutput — git status --short", () => {
  it("parses status codes and paths, skipping the branch header", () => {
    const output = [
      "## main...origin/main",
      " M src/app.tsx",
      "A  src/new.tsx",
      "?? scratch/notes.md",
      "R  old.tsx -> new.tsx",
    ].join("\n");
    const render = classifyExecOutput("git status --short --branch", output) as StatusOutputRender;
    expect(render.kind).toBe("status");
    expect(render.files).toEqual([
      { code: "M", path: "src/app.tsx" },
      { code: "A", path: "src/new.tsx" },
      { code: "??", path: "scratch/notes.md" },
      { code: "R", path: "old.tsx -> new.tsx" },
    ]);
  });

  it("represents a clean tree as an empty file list", () => {
    const render = classifyExecOutput("git status -s", "") as StatusOutputRender;
    expect(render.kind).toBe("status");
    expect(render.files).toEqual([]);
  });

  it("unwraps `bash -lc` before matching the command", () => {
    const render = classifyExecOutput('bash -lc "git status --short"', " M a.ts");
    expect(render?.kind).toBe("status");
  });

  it("matches a fully-pathed git with a -C worktree flag (`/usr/bin/git -C … status --short`)", () => {
    const render = classifyExecOutput(
      "/usr/bin/git -C .worktrees/impl-x status --short",
      " M docs/a.yaml\n?? docs/b.jsonl",
    ) as StatusOutputRender;
    expect(render.kind).toBe("status");
    expect(render.files).toEqual([
      { code: "M", path: "docs/a.yaml" },
      { code: "??", path: "docs/b.jsonl" },
    ]);
  });

  it("tolerates git global flags before the subcommand (`git --no-pager -C p status -s`)", () => {
    const render = classifyExecOutput("git --no-pager -C repo status -s", " M x");
    expect(render?.kind).toBe("status");
  });
});

describe("classifyExecOutput — table (sqlite3 -column)", () => {
  it("parses aligned columns using the dashed separator row", () => {
    const output = [
      "target              warnings",
      "------------------  --------",
      "codex_otel.log_only  254011",
      "log                  22014",
    ].join("\n");
    const render = classifyExecOutput(
      'sqlite3 -header -column state.sqlite "select ..."',
      output,
    ) as TableOutputRender;
    expect(render.kind).toBe("table");
    expect(render.columns).toEqual(["target", "warnings"]);
    expect(render.rows).toEqual([
      ["codex_otel.log_only", "254011"],
      ["log", "22014"],
    ]);
    expect(render.totalRows).toBe(2);
  });
});

describe("classifyExecOutput — docker (rides the table renderer)", () => {
  it("parses tab-delimited `docker ps --format 'table …'` output, preserving empty cells", () => {
    const output = [
      "CONTAINER ID\tNAMES\tPORTS\tSTATUS",
      "f9be8f2fc55c\tcontracts-prisma-postgres-1\t0.0.0.0:54322->5432/tcp\tUp About an hour (healthy)",
      "b03d8f1a9c72\tcontracts-migrate-1\t\tExited (0) 8 minutes ago",
    ].join("\n");
    const render = classifyExecOutput(
      "docker ps --format 'table {{.ID}}\\t{{.Names}}\\t{{.Ports}}\\t{{.Status}}'",
      output,
    ) as TableOutputRender;
    expect(render.kind).toBe("table");
    expect(render.columns).toEqual(["CONTAINER ID", "NAMES", "PORTS", "STATUS"]);
    expect(render.rows).toEqual([
      ["f9be8f2fc55c", "contracts-prisma-postgres-1", "0.0.0.0:54322->5432/tcp", "Up About an hour (healthy)"],
      ["b03d8f1a9c72", "contracts-migrate-1", "", "Exited (0) 8 minutes ago"],
    ]);
    expect(render.totalRows).toBe(2);
  });

  it("parses fixed-width `docker compose ps` columns, keeping an empty PORTS cell", () => {
    // Build perfectly-aligned fixed-width rows so the fixture can't drift.
    const widths = [32, 32, 28];
    const fw = (cells: string[]) =>
      cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join("");
    const output = [
      fw(["NAME", "STATUS", "PORTS", "SERVICE"]),
      fw(["contracts-prisma-postgres-1", "Up About an hour (healthy)", "0.0.0.0:54322->5432/tcp", "postgres"]),
      fw(["contracts-migrate-1", "Exited (0) 8 minutes ago", "", "migrate"]),
    ].join("\n");
    const render = classifyExecOutput("docker compose ps", output) as TableOutputRender;
    expect(render.kind).toBe("table");
    expect(render.columns).toEqual(["NAME", "STATUS", "PORTS", "SERVICE"]);
    expect(render.rows).toEqual([
      ["contracts-prisma-postgres-1", "Up About an hour (healthy)", "0.0.0.0:54322->5432/tcp", "postgres"],
      ["contracts-migrate-1", "Exited (0) 8 minutes ago", "", "migrate"],
    ]);
    expect(render.totalRows).toBe(2);
  });

  it("drops a repeated header row when two listings are concatenated", () => {
    const output = [
      "CONTAINER ID\tNAMES\tSTATUS",
      "f9be8f2fc55c\tpg-1\tUp 6 seconds (healthy)",
      "CONTAINER ID\tNAMES\tSTATUS",
      "6c829413b595\tpg-1\tUp 32 seconds (healthy)",
    ].join("\n");
    const render = classifyExecOutput(
      "docker ps --format 'table {{.ID}}\\t{{.Names}}\\t{{.Status}}'",
      output,
    ) as TableOutputRender;
    expect(render.rows).toEqual([
      ["f9be8f2fc55c", "pg-1", "Up 6 seconds (healthy)"],
      ["6c829413b595", "pg-1", "Up 32 seconds (healthy)"],
    ]);
    expect(render.totalRows).toBe(2);
  });

  it("does not table-ify docker output piped into a filter (the header is gone)", () => {
    const output = "04b9c2463904 nerdy-phase2-postgres 127.0.0.1:55432->5432/tcp";
    const render = classifyExecOutput(
      "docker ps --format '{{.ID}} {{.Names}} {{.Ports}}' | rg '543'",
      output,
    );
    expect(render?.kind).not.toBe("table");
  });
});

describe("classifyExecOutput — docker compose up (compose lifecycle)", () => {
  it("collapses the lifecycle stream to one terminal-state row per resource + a pull chip", () => {
    const output = [
      "Network myproj-app_default Creating",
      "Network myproj-app_default Created",
      "Volume myproj-app_pgdata Creating",
      "Volume myproj-app_pgdata Created",
      "Container myproj-app-postgres-1 Creating",
      "Container myproj-app-postgres-1 Created",
      "Container myproj-app-postgres-1 Starting",
      "Container myproj-app-postgres-1 Started",
      " a1b2c3d4e5f6 Pulling fs layer 0B",
      " a1b2c3d4e5f6 Download complete 0B",
      " 9988776655ff Pulling fs layer 0B",
      " 9988776655ff Download complete 0B",
    ].join("\n");
    const r = classifyExecOutput("docker compose up -d", output) as ComposeOutputRender;
    expect(r.kind).toBe("compose");
    expect(r.resources).toEqual([
      { type: "network", name: "default", state: "created" },
      { type: "volume", name: "pgdata", state: "created" },
      { type: "container", name: "postgres-1", state: "started" },
    ]);
    expect(r.pull).toEqual({ layers: 2, done: 2 });
  });

  it("marks an errored container red and has no pull chip when nothing was pulled", () => {
    const output = [
      "Network app_default Creating",
      "Network app_default Created",
      "Container app-postgres-1 Started",
      "Container app-migrate-1 Starting",
      "Container app-web-1 Error",
      "dependency failed to start: container app-web-1 exited (1)",
    ].join("\n");
    const r = classifyExecOutput("set -o pipefail; docker compose up", output) as ComposeOutputRender;
    expect(r.kind).toBe("compose");
    expect(r.resources).toEqual([
      { type: "network", name: "default", state: "created" },
      { type: "container", name: "postgres-1", state: "started" },
      { type: "container", name: "migrate-1", state: "starting" },
      { type: "container", name: "web-1", state: "error" },
    ]);
    expect(r.pull).toBeUndefined();
  });

  it("does not treat `docker compose ps` (a table) as compose", () => {
    const r = classifyExecOutput("docker compose ps", "Network app_default Created");
    expect(r?.kind).not.toBe("compose");
  });
});

describe("classifyExecOutput — git diff --name-status (rides the status renderer)", () => {
  it("parses tab-separated M/A/D codes, rendering renames as old → new", () => {
    const output = [
      "M\tapps/server/src/app.ts",
      "A\tapps/web/src/components/CameraDiagnosticsPanel.tsx",
      "D\tapps/web/src/old/Removed.tsx",
      "R100\tapps/web/src/Old.tsx\tapps/web/src/New.tsx",
    ].join("\n");
    const render = classifyExecOutput(
      "git diff --name-status impl/foo...impl/bar",
      output,
    ) as StatusOutputRender;
    expect(render.kind).toBe("status");
    expect(render.files).toEqual([
      { code: "M", path: "apps/server/src/app.ts" },
      { code: "A", path: "apps/web/src/components/CameraDiagnosticsPanel.tsx" },
      { code: "D", path: "apps/web/src/old/Removed.tsx" },
      { code: "R", path: "apps/web/src/Old.tsx → apps/web/src/New.tsx" },
    ]);
  });

  it("tolerates `git -C <path> diff --name-status`", () => {
    const render = classifyExecOutput(
      "/usr/bin/git -C /repo diff --name-status HEAD~1",
      "M\tsrc/index.ts",
    ) as StatusOutputRender;
    expect(render.kind).toBe("status");
    expect(render.files).toEqual([{ code: "M", path: "src/index.ts" }]);
  });
});

describe("classifyExecOutput — git show <ref>:<path> (rides the file renderer)", () => {
  it("renders a blob as a file peek with synthesized line numbers and the blob path", () => {
    const output = ['worker: "abc"', 'run_id: "123"', 'task: "Task 6"'].join("\n");
    const render = classifyExecOutput(
      "/usr/bin/git show impl/phase-1:docs/runs/worker.yaml",
      output,
    ) as FileOutputRender;
    expect(render.kind).toBe("file");
    expect(render.path).toBe("docs/runs/worker.yaml");
    expect(render.totalLines).toBe(3);
    expect(render.lines).toEqual([
      { n: 1, text: 'worker: "abc"' },
      { n: 2, text: 'run_id: "123"' },
      { n: 3, text: 'task: "Task 6"' },
    ]);
  });

  it("leaves a commit `git show <sha>` (no :path) to the diff/git renderers", () => {
    const render = classifyExecOutput("git show HEAD", "commit abc\nAuthor: x\n");
    expect(render?.kind).not.toBe("file");
  });
});

describe("classifyExecOutput — file peek", () => {
  it("parses `nl` line-numbered output keeping real line numbers", () => {
    const output = ["     1\timport os", "     2\timport sys", "     3\t", "     4\tdef main():"].join("\n");
    const render = classifyExecOutput("nl -ba src/main.py", output) as FileOutputRender;
    expect(render.kind).toBe("file");
    expect(render.path).toBe("src/main.py");
    expect(render.lines).toEqual([
      { n: 1, text: "import os" },
      { n: 2, text: "import sys" },
      { n: 3, text: "" },
      { n: 4, text: "def main():" },
    ]);
  });

  it("synthesizes line numbers from a `sed -n` range", () => {
    const output = ["pub fn open_readonly() {", "    let db = 1;", "}"].join("\n");
    const render = classifyExecOutput("sed -n '40,46p' src/db.rs", output) as FileOutputRender;
    expect(render.kind).toBe("file");
    expect(render.path).toBe("src/db.rs");
    expect(render.lines[0]).toEqual({ n: 40, text: "pub fn open_readonly() {" });
    expect(render.lines[2]).toEqual({ n: 42, text: "}" });
  });
});

describe("classifyExecOutput — matches (rg / grep)", () => {
  it("groups `path:line:text` matches by file", () => {
    const output = [
      "src/a.ts:88:  if (foo) bar",
      "src/a.ts:90:  foo()",
      "src/b.ts:12:foo here",
    ].join("\n");
    const render = classifyExecOutput('rg -n "foo" src', output) as MatchesOutputRender;
    expect(render.kind).toBe("matches");
    expect(render.files).toHaveLength(2);
    expect(render.files[0].path).toBe("src/a.ts");
    expect(render.files[0].matches).toEqual([
      { n: 88, text: "  if (foo) bar", col: [6, 9] },
      { n: 90, text: "  foo()", col: [2, 5] },
    ]);
    expect(render.files[1].path).toBe("src/b.ts");
    expect(render.files[1].matches[0]).toMatchObject({ n: 12, text: "foo here" });
  });
});

describe("classifyExecOutput — matches via pipe (… | rg / grep)", () => {
  it("classifies `nl file | rg` as matches: strips nl numbering, highlights the matched alternative", () => {
    const output = [
      "205:   205\t  if (config.faucetPort !== null) {",
      "206:   206\t    args.push(\"--faucet-port\", String(config.faucetPort));",
    ].join("\n");
    const render = classifyExecOutput(
      'nl -ba services/local-demo/src/validator.ts | rg -n "faucet-port|faucetPort"',
      output,
    ) as MatchesOutputRender;
    expect(render.kind).toBe("matches");
    expect(render.files).toHaveLength(1);
    // No filename in the rg output → attribute to the upstream source file.
    expect(render.files[0].path).toBe("services/local-demo/src/validator.ts");
    const matches = render.files[0].matches;
    expect(matches[0].n).toBe(205);
    // The redundant nl "205\t" prefix is stripped from the displayed line.
    expect(matches[0].text).toBe("  if (config.faucetPort !== null) {");
    // The alternative that actually appears is highlighted.
    const [start, end] = matches[0].col as [number, number];
    expect(matches[0].text.slice(start, end)).toBe("faucetPort");
  });

  it("classifies `cmd | grep -n pattern` stdin output as matches with the source file", () => {
    const render = classifyExecOutput(
      "cat services/local-demo/admin-api.log | grep -n ERROR",
      "12:ERROR boom\n40:ERROR again",
    ) as MatchesOutputRender;
    expect(render.kind).toBe("matches");
    expect(render.files[0].path).toBe("services/local-demo/admin-api.log");
    expect(render.files[0].matches[0]).toMatchObject({ n: 12, text: "ERROR boom" });
    const [start, end] = render.files[0].matches[0].col as [number, number];
    expect("ERROR boom".slice(start, end)).toBe("ERROR");
  });
});

describe("classifyExecOutput — tree (ls / find / tree)", () => {
  it("parses `ls -la` long format into typed entries with humanized file sizes", () => {
    const output = [
      "total 8",
      "drwxr-xr-x  28 adam staff      896 May 30 10:00 sessions",
      "-rw-r--r--   1 adam staff 12582912 May 30 10:00 state_5.sqlite",
      "lrwxr-xr-x   1 adam staff       14 May 30 10:00 current -> state_5.sqlite",
    ].join("\n");
    const render = classifyExecOutput("ls -la ~/.codex", output) as TreeOutputRender;
    expect(render.kind).toBe("tree");
    expect(render.entries).toEqual([
      { name: "sessions", type: "dir", depth: 0 },
      { name: "state_5.sqlite", type: "file", depth: 0, size: "12 MB" },
      { name: "current -> state_5.sqlite", type: "link", depth: 0 },
    ]);
    expect(render.totalEntries).toBe(3);
  });

  it("parses `find … | head` paths as files at depth 0, skipping error lines", () => {
    const render = classifyExecOutput(
      "find .local -maxdepth 2 -type f -print | head -20",
      ".local/state.json\n.local/user.json\nfind: .local/x: Permission denied",
    ) as TreeOutputRender;
    expect(render.kind).toBe("tree");
    expect(render.totalEntries).toBe(2);
    expect(render.entries[0]).toEqual({ name: ".local/state.json", type: "file", depth: 0 });
  });

  it("marks trailing-slash entries (`ls -p`) as directories", () => {
    const render = classifyExecOutput("ls -p src", "a.ts\nsub/\nb.ts") as TreeOutputRender;
    expect(render.entries.map((entry) => [entry.name, entry.type])).toEqual([
      ["a.ts", "file"],
      ["sub", "dir"],
      ["b.ts", "file"],
    ]);
  });

  it("defers to matches when a find pipeline ends in a searcher", () => {
    const render = classifyExecOutput("find . -type f | rg -n needle", "src/a.ts:3:has needle here");
    expect(render?.kind).toBe("matches");
  });
});

describe("classifyPatch — apply_patch envelope", () => {
  it("parses Update/Add/Delete files with hunks into a diff render", async () => {
    const { classifyPatch } = await import("../../src/backend/rollout/classifyExecOutput");
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/app.ts",
      "@@ function main()",
      "-  const x = 1;",
      "+  const x = 2;",
      "   return x;",
      "*** Add File: src/new.ts",
      "+export const y = 3;",
      "*** End Patch",
    ].join("\n");
    const render = classifyPatch(patch) as DiffOutputRender;
    expect(render.kind).toBe("diff");
    expect(render.files).toHaveLength(2);
    expect(render.files[0]).toMatchObject({ path: "src/app.ts", added: 1, removed: 1 });
    expect(render.files[0].hunks[0].lines).toEqual([
      { t: "del", text: "  const x = 1;" },
      { t: "add", text: "  const x = 2;" },
      { t: "ctx", text: "  return x;" },
    ]);
    expect(render.files[1]).toMatchObject({ path: "src/new.ts", added: 1 });
  });

  it("returns undefined for non-patch text", async () => {
    const { classifyPatch } = await import("../../src/backend/rollout/classifyExecOutput");
    expect(classifyPatch("just some output")).toBeUndefined();
    expect(classifyPatch(undefined)).toBeUndefined();
  });
});

describe("classifyExecOutput — http (curl)", () => {
  it("parses an HTTP response with headers and a JSON body", () => {
    const output = [
      "HTTP/1.1 200 OK",
      "content-type: application/json",
      "content-length: 23",
      "",
      '{ "status": "healthy" }',
    ].join("\n");
    const render = classifyExecOutput("curl -i http://localhost:4317/v1/health", output) as HttpOutputRender;
    expect(render.kind).toBe("http");
    expect(render.status).toBe(200);
    expect(render.statusText).toBe("OK");
    expect(render.url).toBe("http://localhost:4317/v1/health");
    expect(render.json).toBe(true);
    expect(render.headers).toContainEqual({ k: "content-type", v: "application/json" });
    // JSON bodies are pretty-printed server-side for readable display.
    expect(render.body).toBe('{\n  "status": "healthy"\n}');
  });

  it("pretty-prints a minified JSON body for readable display", () => {
    const output = [
      "HTTP/1.1 200 OK",
      "content-type: application/json",
      "",
      '{"status":"healthy","exporters":{"otlp":"ok"},"queue_depth":0}',
    ].join("\n");
    const render = classifyExecOutput("curl -i http://localhost:4317/v1/health", output) as HttpOutputRender;
    expect(render.json).toBe(true);
    expect(render.body).toBe(
      ['{', '  "status": "healthy",', '  "exporters": {', '    "otlp": "ok"', "  },", '  "queue_depth": 0', "}"].join("\n"),
    );
  });

  it("leaves a non-JSON body untouched", () => {
    const output = ["HTTP/1.1 200 OK", "content-type: text/plain", "", "plain text body"].join("\n");
    const render = classifyExecOutput("curl -i http://localhost/x", output) as HttpOutputRender;
    expect(render.body).toBe("plain text body");
  });

  it("renders a transport error for a curl that never connected (no status line)", () => {
    const render = classifyExecOutput(
      "curl -fsS --max-time 5 http://127.0.0.1:23101/health || true",
      "curl: (7) Failed to connect to 127.0.0.1 port 23101 after 0 ms: Couldn't connect to server",
    ) as HttpOutputRender;
    expect(render.kind).toBe("http");
    expect(render.method).toBe("GET");
    expect(render.url).toBe("http://127.0.0.1:23101/health");
    expect(render.status).toBeUndefined();
    expect(render.error).toContain("(7)");
    expect(render.error).toContain("Failed to connect");
  });

  it("renders method/url/body for a curl without -i (body only, no headers)", () => {
    const render = classifyExecOutput(
      "curl -fsS http://localhost:8787/health",
      '{"status":"ok","port":8787}',
    ) as HttpOutputRender;
    expect(render.kind).toBe("http");
    expect(render.method).toBe("GET");
    expect(render.url).toBe("http://localhost:8787/health");
    expect(render.status).toBeUndefined();
    expect(render.json).toBe(true);
    expect(render.body).toBe('{\n  "status": "ok",\n  "port": 8787\n}');
  });

  it("reads the method on a headerless POST", () => {
    const render = classifyExecOutput(
      "curl -sS -X POST http://localhost:8787/markets --data '{}'",
      "created",
    ) as HttpOutputRender;
    expect(render.method).toBe("POST");
    expect(render.url).toBe("http://localhost:8787/markets");
    expect(render.body).toBe("created");
  });

  it("does not render non-request curl invocations (no URL) as http", () => {
    expect(classifyExecOutput("curl --version", "curl 8.4.0 (x86_64-apple-darwin)")).toBeUndefined();
  });

  it("leaves a curl piped into a searcher as matches, not http", () => {
    const render = classifyExecOutput("curl -s http://x/list | rg -n needle", "3:has needle here");
    expect(render?.kind).toBe("matches");
  });

  it("reads the method from -X / --request flags (not just defaulting to GET)", () => {
    const output = ["HTTP/1.1 201 Created", "content-type: application/json", "", "{}"].join("\n");
    const post = classifyExecOutput("curl -s -i -X POST http://localhost:8787/markets/mint", output) as HttpOutputRender;
    expect(post.method).toBe("POST");
    const del = classifyExecOutput("curl -i --request DELETE https://api.test/x", output) as HttpOutputRender;
    expect(del.method).toBe("DELETE");
  });
});

describe("classifyExecOutput — build (cargo / tsc / go)", () => {
  it("parses tsc diagnostics with code, file, and position", () => {
    const output = [
      "src/db.ts(44,14): error TS2339: Property 'busy_timeout' does not exist on type 'Database'.",
      "Found 1 error in src/db.ts:44",
    ].join("\n");
    const render = classifyExecOutput("tsc --noEmit", output) as BuildOutputRender;
    expect(render.kind).toBe("build");
    expect(render.tool).toBe("tsc");
    expect(render.errors).toBe(1);
    expect(render.diagnostics[0]).toMatchObject({ severity: "error", code: "TS2339", file: "src/db.ts", line: 44, col: 14 });
  });

  it("parses a cargo code frame into a snippet with a caret span, plus the build duration", () => {
    const output = [
      "error[E0599]: no method named `busy_timeout` found for struct `Connection`",
      "  --> src/db.rs:44:14",
      "   |",
      "44 |     conn.busy_timeout(Duration::from_millis(5000))?;",
      "   |          ^^^^^^^^^^^^ method not found",
      "   |",
      "",
      "    Finished release [optimized] target(s) in 11.20s",
    ].join("\n");
    const render = classifyExecOutput("cargo build --release", output) as BuildOutputRender;
    expect(render.kind).toBe("build");
    expect(render.durationMs).toBe(11200);
    expect(render.diagnostics).toHaveLength(1);
    expect(render.diagnostics[0]).toMatchObject({ severity: "error", code: "E0599", file: "src/db.rs", line: 44, col: 14 });
    expect(render.diagnostics[0].snippet).toEqual([
      { n: 44, text: "    conn.busy_timeout(Duration::from_millis(5000))?;", caret: [9, 21] },
    ]);
  });

  it("parses a multi-line cargo frame (context line + offending line)", () => {
    const output = [
      "error[E0277]: the trait `FromSql` is not implemented",
      "  --> src/query.rs:88:9",
      "   |",
      "87 |     let row = stmt.next()?;",
      "88 |         row.get::<_, Depth>(4)?",
      "   |         ^^^^^^^^^^^^^^^^^^^ trait not satisfied",
      "",
    ].join("\n");
    const render = classifyExecOutput("cargo check", output) as BuildOutputRender;
    expect(render.diagnostics[0].snippet).toEqual([
      { n: 87, text: "    let row = stmt.next()?;" },
      { n: 88, text: "        row.get::<_, Depth>(4)?", caret: [8, 27] },
    ]);
  });

  it("ignores non-build commands", () => {
    expect(classifyExecOutput("echo build", "build")).toBeUndefined();
  });
});

describe("classifyExecOutput — lint (eslint / ruff)", () => {
  it("parses eslint stylish output grouped by file", () => {
    const output = ["src/app.tsx", "  44:21  warning  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any", ""].join("\n");
    const render = classifyExecOutput("eslint src", output) as LintOutputRender;
    expect(render.kind).toBe("lint");
    expect(render.warnings).toBe(1);
    expect(render.files[0].path).toBe("src/app.tsx");
    expect(render.files[0].issues[0]).toMatchObject({ severity: "warning", line: 44, col: 21, rule: "@typescript-eslint/no-explicit-any" });
  });

  it("parses ruff `file:line:col: CODE message`", () => {
    const render = classifyExecOutput("ruff check .", "app.py:12:5: F401 `os` imported but unused") as LintOutputRender;
    expect(render.kind).toBe("lint");
    expect(render.files[0]).toMatchObject({ path: "app.py" });
    expect(render.files[0].issues[0]).toMatchObject({ line: 12, col: 5, rule: "F401" });
  });
});

describe("classifyExecOutput — log (git log)", () => {
  it("parses `--oneline` with refs", () => {
    const output = ["a3f81c2 (HEAD -> main, origin/main) timeline: scope toggle", "7be09d4 renderers: add http view"].join("\n");
    const render = classifyExecOutput("git log --oneline -n 20", output) as LogOutputRender;
    expect(render.kind).toBe("log");
    expect(render.total).toBe(2);
    expect(render.commits[0]).toMatchObject({ hash: "a3f81c2", subject: "timeline: scope toggle" });
    expect(render.commits[0].refs).toEqual(["HEAD", "main", "origin/main"]);
  });

  it("parses the default block format with author + date", () => {
    const output = ["commit a3f81c2def", "Author: Adam <a@x.com>", "Date:   Sat May 30 10:00:00 2026", "", "    timeline: scope toggle", ""].join("\n");
    const render = classifyExecOutput("git log", output) as LogOutputRender;
    expect(render.commits[0]).toMatchObject({ hash: "a3f81c2de", author: "Adam", subject: "timeline: scope toggle" });
  });
});

describe("classifyExecOutput — json (jq / cat *.json)", () => {
  it("classifies `cat *.json` output as pretty-printed json with a source", () => {
    const render = classifyExecOutput("cat config/health.json", '{"otlp":"ok","queue_depth":0}') as JsonOutputRender;
    expect(render.kind).toBe("json");
    expect(render.source).toBe("health.json");
    expect(render.value).toEqual({ otlp: "ok", queue_depth: 0 });
  });

  it("classifies `… | jq` output", () => {
    const render = classifyExecOutput("cat x | jq '.'", '{"a":1}') as JsonOutputRender;
    expect(render.kind).toBe("json");
    expect(render.value).toEqual({ a: 1 });
  });

  it("falls through when the jq output is not a single JSON value", () => {
    expect(classifyExecOutput("echo hi | jq -r .name", "alpha\nbeta")).toBeUndefined();
  });
});

describe("classifyExecOutput — trace (python / rust)", () => {
  it("parses a python traceback into frames + exception", () => {
    const output = [
      "Traceback (most recent call last):",
      '  File "ingest.py", line 22, in <module>',
      "    main()",
      '  File "/usr/lib/python3.12/json/__init__.py", line 5, in loads',
      "    return _default_decoder.decode(s)",
      "ValueError: Expecting value: line 1 column 1 (char 0)",
    ].join("\n");
    const render = classifyExecOutput("python ingest.py", output) as TraceOutputRender;
    expect(render.kind).toBe("trace");
    expect(render.lang).toBe("python");
    expect(render.exception).toBe("ValueError");
    expect(render.message).toContain("Expecting value");
    expect(render.frames[0]).toMatchObject({ fn: "<module>", file: "ingest.py", line: 22, user: true });
    expect(render.frames[1].user).toBe(false); // stdlib frame dimmed
  });

  it("parses a rust panic", () => {
    const output = ["thread 'main' panicked at 'called `Result::unwrap()` on an `Err` value', src/main.rs:22:14"].join("\n");
    const render = classifyExecOutput("./target/release/app", output) as TraceOutputRender;
    expect(render.kind).toBe("trace");
    expect(render.lang).toBe("rust");
    expect(render.message).toContain("Result::unwrap()");
  });
});

describe("classifyExecOutput — diffstat (git diff --stat)", () => {
  it("parses per-file ± and the totals line", () => {
    const output = [
      "apps/server/src/app.ts | 13 ++",
      "apps/web/src/App.tsx  | 40 ++++----",
      " 2 files changed, 49 insertions(+), 4 deletions(-)",
    ].join("\n");
    const render = classifyExecOutput("git diff --stat HEAD --", output) as DiffstatOutputRender;
    expect(render.kind).toBe("diffstat");
    expect(render.files.map((f) => f.path)).toEqual(["apps/server/src/app.ts", "apps/web/src/App.tsx"]);
    expect(render.totals).toEqual({ files: 2, insertions: 49, deletions: 4 });
  });

  it("does not fire for a plain `git diff` (that's the unified diff renderer)", () => {
    expect(classifyExecOutput("git diff", "apps/a.ts | 2 +-")).not.toMatchObject({ kind: "diffstat" });
  });
});

describe("classifyExecOutput — git ops", () => {
  it("commit → branch, sha, subject, stat", () => {
    const r = classifyExecOutput(
      'git commit -m "chore: start"',
      "[impl/phase-1 82891db] chore: start\n 5 files changed, 67 insertions(+), 33 deletions(-)",
    ) as GitOutputRender;
    expect(r).toMatchObject({ kind: "git", sub: "commit", branch: "impl/phase-1", shortSha: "82891db", subject: "chore: start", filesChanged: 5, insertions: 67, deletions: 33 });
  });

  it("add → staged paths from the command", () => {
    const r = classifyExecOutput("git add src/a.ts src/b.ts", "") as GitOutputRender;
    expect(r).toMatchObject({ kind: "git", sub: "add", staged: ["src/a.ts", "src/b.ts"] });
  });

  it("worktree → ok with branch + HEAD", () => {
    const r = classifyExecOutput(
      "git worktree add ../wt/x impl/x",
      "Preparing worktree (new branch 'impl/x')\nHEAD is now at a42f41e chore: scaffold",
    ) as GitOutputRender;
    expect(r).toMatchObject({ kind: "git", sub: "worktree", ok: true, branch: "impl/x", head: "a42f41e" });
  });

  it("worktree → failure carries the error", () => {
    const r = classifyExecOutput(
      "git worktree add ../wt/y impl/y",
      "Preparing worktree (new branch 'impl/y')\nfatal: cannot lock ref 'refs/heads/impl/y'",
    ) as GitOutputRender;
    expect(r).toMatchObject({ kind: "git", sub: "worktree", ok: false, branch: "impl/y" });
    expect(r.error).toContain("cannot lock ref");
  });

  it("merge → strategy + embedded diffstat", () => {
    const r = classifyExecOutput(
      "git merge --no-ff impl/x",
      "Merge made by the 'ort' strategy.\n .env.example | 8 +\n apps/server/src/app.ts | 38 ++\n 2 files changed, 46 insertions(+)",
    ) as GitOutputRender;
    expect(r).toMatchObject({ kind: "git", sub: "merge", strategy: "ort" });
    expect(r.diffstat?.files).toHaveLength(2);
    expect(r.diffstat?.totals?.files).toBe(2);
  });

  it("branch / rev-parse → branch + sha chips", () => {
    const r = classifyExecOutput(
      "git branch --show-current && git rev-parse HEAD^{commit}",
      "impl/phase-1-diagnostics-foundation\n82891db4c9a1",
    ) as GitOutputRender;
    expect(r).toMatchObject({ kind: "git", sub: "branch", branch: "impl/phase-1-diagnostics-foundation", sha: "82891db4c9a1" });
  });
});

describe("classifyExecOutput — plain fallback", () => {
  it("returns undefined when nothing matches", () => {
    expect(classifyExecOutput("echo hi", "hi\nthere")).toBeUndefined();
  });

  it("returns undefined for empty output of an unstructured command", () => {
    expect(classifyExecOutput("date +%F", "2026-05-29")).toBeUndefined();
  });
});
