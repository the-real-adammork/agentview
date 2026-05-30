import { describe, expect, it } from "vitest";

import { classifyExecOutput } from "../../src/backend/rollout/classifyExecOutput";
import type {
  DiffOutputRender,
  DirectoryOutputRender,
  FileOutputRender,
  HttpOutputRender,
  MatchesOutputRender,
  StatusOutputRender,
  TableOutputRender,
  TestsOutputRender,
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

describe("classifyExecOutput — directory (find / ls / fd)", () => {
  it("parses a `find … | head` path list into directory entries", () => {
    const output = [
      ".local-demo-playwright-admin/state.json",
      ".local-demo-playwright-admin/user-a.json",
      ".local-demo-playwright-admin/phoenix-accounts/8ebc.json",
    ].join("\n");
    const render = classifyExecOutput(
      "find .local-demo-playwright-admin -maxdepth 2 -type f -print | head -20",
      output,
    ) as DirectoryOutputRender;
    expect(render.kind).toBe("directory");
    expect(render.entries).toEqual([
      ".local-demo-playwright-admin/state.json",
      ".local-demo-playwright-admin/user-a.json",
      ".local-demo-playwright-admin/phoenix-accounts/8ebc.json",
    ]);
    expect(render.totalEntries).toBe(3);
  });

  it("classifies one-path-per-line `ls` output and skips error lines", () => {
    const render = classifyExecOutput(
      "ls -1 src",
      "a.ts\nb.ts\nsub/\nfind: missing: No such file or directory",
    ) as DirectoryOutputRender;
    expect(render.kind).toBe("directory");
    expect(render.entries).toEqual(["a.ts", "b.ts", "sub/"]);
  });

  it("defers to matches when a find pipeline ends in a searcher", () => {
    const render = classifyExecOutput("find . -type f | rg -n needle", "src/a.ts:3:has needle here");
    expect(render?.kind).toBe("matches");
  });

  it("leaves `ls -l` long listings as plain (not a clean path list)", () => {
    const output = ["total 8", "-rw-r--r--  1 adam staff  12 May 29 11:00 a.ts"].join("\n");
    expect(classifyExecOutput("ls -l", output)).toBeUndefined();
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

  it("reads the method from -X / --request flags (not just defaulting to GET)", () => {
    const output = ["HTTP/1.1 201 Created", "content-type: application/json", "", "{}"].join("\n");
    const post = classifyExecOutput("curl -s -i -X POST http://localhost:8787/markets/mint", output) as HttpOutputRender;
    expect(post.method).toBe("POST");
    const del = classifyExecOutput("curl -i --request DELETE https://api.test/x", output) as HttpOutputRender;
    expect(del.method).toBe("DELETE");
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
