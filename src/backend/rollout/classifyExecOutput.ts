import type {
  BuildDiagnostic,
  DiffFile,
  DiffHunk,
  FileLine,
  HttpHeader,
  LintFile,
  LintIssue,
  LogCommit,
  MatchFile,
  MatchLine,
  OutputRender,
  StatusFile,
  TraceFrame,
  TreeEntry,
  TreeEntryType,
} from "../../shared/contracts";

/**
 * Classifies a single `exec_command` result into a structured `outputRender`,
 * server-side, so the frontend can render it with a typed component instead of
 * one gray `<pre>` blob. Parsed once during the rollout pass and cached on the
 * owning tool_call. Returns `undefined` when nothing matches — the caller then
 * omits `outputRender` and the UI falls back to the raw preview.
 *
 * Detection blends the command (the strongest signal: `git diff`, `git status
 * --short`, `nl`, `rg`, `curl`, …) with the output shape. Every branch degrades
 * gracefully: if a parser can't make sense of the bytes it bails to the next
 * candidate and ultimately to plain. See
 * docs/design/workflowkit-evangelion/docs/Exec Renderers Handoff.md §2.
 */

// Bounds so a pathological output never blows up the parse pass.
const MAX_PARSE_LINES = 6000;
const MAX_TABLE_ROWS = 500;
const MAX_FILE_LINES = 2000;
const MAX_DIR_ENTRIES = 500;

export function classifyExecOutput(command: string | undefined, output: string | undefined): OutputRender | undefined {
  const text = output ?? "";
  const cmd = normalizeCommand(command ?? "");

  // Order matters: most self-identifying / reliable formats first. Matches runs
  // before file/directory so a search pipeline (`nl … | rg`, `find … | rg`) wins
  // over the file/path-list reading of its first stage.
  return (
    classifyDiff(cmd, text) ??
    classifyHttp(cmd, text) ??
    classifyTests(cmd, text) ??
    classifyStatus(cmd, text) ??
    classifyTable(cmd, text) ??
    classifyMatches(cmd, text) ??
    classifyBuild(cmd, text) ??
    classifyLint(cmd, text) ??
    classifyLog(cmd, text) ??
    classifyJson(cmd, text) ??
    classifyTrace(cmd, text) ??
    classifyFile(cmd, text) ??
    classifyTree(cmd, text) ??
    undefined
  );
}

/**
 * Split a command into pipeline stages on unquoted `|`. Quote-aware so a `|`
 * inside an rg/grep pattern (`rg "a|b"`) is not mistaken for a pipe.
 */
function pipeStages(cmd: string): string[] {
  const stages: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "|" && cmd[i + 1] === "|") {
      // `||` is a logical OR (e.g. `curl … || true`), not an output pipe.
      current += "||";
      i += 1;
    } else if (ch === "|") {
      stages.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  stages.push(current.trim());
  return stages.filter(Boolean);
}

/** Lower-cased program name of a single stage, with any leading path stripped. */
function stageHead(stage: string): string {
  return (stage.split(/\s+/)[0] ?? "").toLowerCase().replace(/.*\//, "");
}

// git global options that sit before the subcommand (`git -C path status`).
const GIT_GLOBALS =
  "(?:\\s+(?:-C\\s+\\S+|-c\\s+\\S+|--git-dir(?:=\\S+|\\s+\\S+)|--work-tree(?:=\\S+|\\s+\\S+)|--no-pager|--no-optional-locks|--literal-pathspecs))*";
/** Matches `git <globals> <subcommand>`, tolerating `-C <path>` and friends. */
const gitSubcommand = (sub: string): RegExp => new RegExp(`^git${GIT_GLOBALS}\\s+${sub}\\b`);

/** Unwrap `bash -lc "…"` / `sh -c '…'` wrappers, strip leading `ENV=val`, and drop a program path. */
function normalizeCommand(raw: string): string {
  let cmd = raw.trim();
  const wrapper = /^(?:[\w./-]*\/)?(?:bash|sh|zsh)\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(cmd);
  if (wrapper) cmd = wrapper[2].trim();
  // Strip leading environment assignments (`FOO=bar BAZ=qux cmd …`).
  cmd = cmd.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, "");
  // Reduce an absolute/relative program path to its basename (`/usr/bin/git` → `git`)
  // so name-anchored classifiers match regardless of how the binary was invoked.
  cmd = cmd.replace(/^(?:\S*\/)?(\S+)/, "$1");
  return cmd.trim();
}

/** Split, dropping a single trailing empty line, with a hard line cap. */
function toLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length > MAX_PARSE_LINES ? lines.slice(0, MAX_PARSE_LINES) : lines;
}

// ── diff ──────────────────────────────────────────────────────────────────
function classifyDiff(cmd: string, text: string): OutputRender | undefined {
  const looksLikeDiff =
    /^diff --git /m.test(text) || (/^--- /m.test(text) && /^\+\+\+ /m.test(text) && /^@@ /m.test(text));
  const commandIsDiff = gitSubcommand("(?:diff|show)").test(cmd);
  if (!looksLikeDiff && !(commandIsDiff && /^@@ /m.test(text))) return undefined;

  const files: DiffFile[] = [];
  let current: DiffFile | undefined;

  const startFile = (path: string): DiffFile => {
    const file: DiffFile = { path, added: 0, removed: 0, hunks: [] };
    files.push(file);
    return file;
  };

  for (const line of toLines(text)) {
    if (line.startsWith("diff --git ")) {
      const parts = line.split(/\s+/);
      const bPath = parts[parts.length - 1] ?? "";
      current = startFile(stripDiffPrefix(bPath));
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = stripDiffPrefix(line.slice(4).trim().replace(/\t.*$/, ""));
      if (!current) current = startFile(path);
      else if (current.path === "/dev/null" || !current.path) current.path = path;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (!current) current = startFile(stripDiffPrefix(line.slice(4).trim().replace(/\t.*$/, "")));
      continue;
    }
    if (line.startsWith("@@")) {
      if (!current) current = startFile("");
      current.hunks.push({ header: line, lines: [] });
      continue;
    }
    if (
      line.startsWith("index ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("similarity ") ||
      line.startsWith("rename ") ||
      line.startsWith("copy ") ||
      line.startsWith("Binary files") ||
      line.startsWith("\\ No newline")
    ) {
      continue;
    }
    const file = current;
    const hunk = file?.hunks[file.hunks.length - 1];
    if (!file || !hunk) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ t: "add", text: line.slice(1) });
      file.added += 1;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ t: "del", text: line.slice(1) });
      file.removed += 1;
    } else {
      hunk.lines.push({ t: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }

  const withHunks = files.filter((file) => file.hunks.length > 0);
  if (withHunks.length === 0) return undefined;
  return { kind: "diff", files: withHunks };
}

function stripDiffPrefix(path: string): string {
  return path.replace(/^[ab]\//, "");
}

/**
 * Parse a Codex `apply_patch` envelope (the tool's *arguments*, not its output)
 * into the unified-diff render so an edit shows its hunks instead of a raw blob:
 *
 *   *** Begin Patch
 *   *** Update File: path        (or Add File / Delete File / Move to)
 *   @@ context
 *   -old line
 *   +new line
 *   *** End Patch
 */
export function classifyPatch(patchText: string | undefined): OutputRender | undefined {
  if (!patchText || !/\*\*\* Begin Patch/.test(patchText)) return undefined;
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let hunk: DiffHunk | undefined;
  for (const line of patchText.split("\n")) {
    const fileHeader = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line) ?? /^\*\*\* (?:Move|Rename) (?:to|File): (.+)$/.exec(line);
    if (fileHeader) {
      current = { path: fileHeader[1].trim(), added: 0, removed: 0, hunks: [] };
      files.push(current);
      hunk = undefined;
      continue;
    }
    if (/^\*\*\* /.test(line)) continue; // Begin/End Patch, Move from, etc.
    if (!current) continue;
    if (line.startsWith("@@")) {
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      hunk = { header: "@@", lines: [] };
      current.hunks.push(hunk);
    }
    if (line.startsWith("+")) {
      hunk.lines.push({ t: "add", text: line.slice(1) });
      current.added += 1;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ t: "del", text: line.slice(1) });
      current.removed += 1;
    } else {
      hunk.lines.push({ t: "ctx", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  const withHunks = files.filter((file) => file.hunks.length > 0);
  if (withHunks.length === 0) return undefined;
  return { kind: "diff", files: withHunks };
}

// ── http (curl / wget) ───────────────────────────────────────────────────────
function classifyHttp(cmd: string, text: string): OutputRender | undefined {
  const statusLine = /^HTTP\/[\d.]+\s+(\d{3})(?:\s+(.*))?$/m.exec(text);
  // The request is HTTP when the *output-producing* stage is curl/wget — the last
  // pipe stage, so `curl … | rg` stays a search, not an HTTP card. A captured
  // response line (`-i`) always wins regardless of piping.
  const stages = pipeStages(cmd);
  const isHttpCommand = /^(?:curl|wget)$/.test(stageHead(stages[stages.length - 1] ?? cmd));
  // `-X`/`--request` sit after a space, so a \b before the dash never matches —
  // anchor on a space/start instead. Default to GET when no method flag is given.
  const method = /(?:^|\s)(?:-X|--request)\s+(\w+)/.exec(cmd)?.[1] ?? "GET";
  const url = extractUrl(cmd);

  if (!statusLine) {
    // No response line (curl without `-i`, or a failed connection). Render what we
    // can still derive: method + URL, plus a transport error or the bare body.
    // Require a URL so `curl --version` / `--help` stay plain.
    if (!isHttpCommand || !url) return undefined;
    const curlError = /^(?:curl|wget):\s*(?:\((\d+)\)\s*)?(.*)$/m.exec(text);
    if (curlError) {
      const detail = `${curlError[1] ? `(${curlError[1]}) ` : ""}${curlError[2].trim()}`.trim();
      return { kind: "http", method, url, error: detail || "request failed" };
    }
    const bodyOnly = text.trim();
    const jsonOnly = /^[[{]/.test(bodyOnly);
    return {
      kind: "http",
      method,
      url,
      json: jsonOnly || undefined,
      body: (jsonOnly ? prettyJson(bodyOnly) : bodyOnly) || undefined,
    };
  }

  const lines = toLines(text);
  const startIndex = lines.findIndex((line) => /^HTTP\/[\d.]+\s+\d{3}/.test(line));
  const headers: HttpHeader[] = [];
  let bodyStart = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (lines[i] === "") {
      bodyStart = i + 1;
      break;
    }
    const sep = lines[i].indexOf(":");
    if (sep > 0) headers.push({ k: lines[i].slice(0, sep).trim().toLowerCase(), v: lines[i].slice(sep + 1).trim() });
  }
  const rawBody = lines.slice(bodyStart).join("\n").trim();
  const contentType = headers.find((header) => header.k === "content-type")?.v;
  const json = /json/i.test(contentType ?? "") || /^[[{]/.test(rawBody);
  // Pretty-print JSON bodies once, server-side, so the renderer shows a readable
  // tree instead of one minified line. Non-JSON (or unparseable) bodies pass through.
  const body = json ? prettyJson(rawBody) : rawBody;

  return {
    kind: "http",
    method,
    url,
    status: Number(statusLine[1]),
    statusText: statusLine[2]?.trim() || undefined,
    contentType,
    json,
    headers: headers.length ? headers : undefined,
    body: body || undefined,
  };
}

function extractUrl(cmd: string): string | undefined {
  return /\bhttps?:\/\/\S+/.exec(cmd)?.[0]?.replace(/['"]/g, "");
}

/** Re-indent a JSON body for readable display; returns the original on any parse failure. */
function prettyJson(body: string): string {
  const trimmed = body.trim();
  if (!trimmed || !/^[[{]/.test(trimmed)) return body;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return body;
  }
}

// ── tests (pytest / vitest / jest / go / cargo) ─────────────────────────────
function classifyTests(cmd: string, text: string): OutputRender | undefined {
  const commandIsRunner =
    /\b(pytest|vitest|jest|mocha|ava)\b/.test(cmd) ||
    /\bgo\s+test\b/.test(cmd) ||
    /\bcargo\s+test\b/.test(cmd) ||
    /\bnpm\s+(?:test|run\s+test)\b/.test(cmd);

  const lines = toLines(text);
  // pytest summary, e.g. "=== 2 failed, 42 passed, 1 skipped in 6.20s ==="
  const pytestLine = lines.find((line) => /\bin\s+\d+(?:\.\d+)?s\b/.test(line) && /\b\d+\s+(?:passed|failed|error)/.test(line));
  // vitest "Tests  3 failed | 120 passed (123)"
  const vitestLine = lines.find((line) => /^\s*Tests\s+/.test(line) && /(?:passed|failed)/.test(line));

  if (!commandIsRunner && !pytestLine && !vitestLine) return undefined;

  const summary = pytestLine ?? vitestLine ?? "";
  const passed = readCount(summary, /(\d+)\s+passed/) ?? 0;
  const failed = readCount(summary, /(\d+)\s+failed/) ?? 0;
  const skipped = readCount(summary, /(\d+)\s+(?:skipped|ignored)/) ?? 0;
  if (!summary && passed === 0 && failed === 0) return undefined;

  const durationSec =
    readFloat(summary, /\bin\s+(\d+(?:\.\d+)?)s\b/) ??
    readFloat(lines.find((line) => /^\s*Duration\s+/.test(line)) ?? "", /(\d+(?:\.\d+)?)s/) ??
    undefined;

  const failing = lines
    .map((line) => /^FAILED\s+(\S+)/.exec(line)?.[1] ?? /^\s*(?:×|✗|FAIL)\s+(.+?)(?:\s+\(\d+\s*ms\))?$/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name));

  return {
    kind: "tests",
    passed,
    failed,
    skipped,
    durationMs: durationSec === undefined ? undefined : Math.round(durationSec * 1000),
    failing: dedupe(failing),
  };
}

function readCount(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : undefined;
}

function readFloat(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : undefined;
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

// ── git status --short ──────────────────────────────────────────────────────
const STATUS_CODE_CHARS = new Set([" ", "M", "A", "D", "R", "C", "U", "?", "!", "T"]);

function classifyStatus(cmd: string, text: string): OutputRender | undefined {
  const isGitStatus = gitSubcommand("status").test(cmd) && /(?:^|\s)(?:--short|-s)\b/.test(cmd);
  if (!isGitStatus) return undefined;

  const files: StatusFile[] = [];
  for (const line of toLines(text)) {
    if (line === "" || line.startsWith("##")) continue;
    if (line.length < 3 || line[2] !== " ") continue;
    const c0 = line[0];
    const c1 = line[1];
    if (!STATUS_CODE_CHARS.has(c0) || !STATUS_CODE_CHARS.has(c1)) continue;
    const code = line.slice(0, 2).trim() || "?";
    files.push({ code, path: line.slice(3) });
  }
  return { kind: "status", files };
}

// ── table (sqlite3 -column and similar) ─────────────────────────────────────
function classifyTable(cmd: string, text: string): OutputRender | undefined {
  const isSqlite = /\bsqlite3\b/.test(cmd);
  const lines = toLines(text);
  const sepIndex = lines.findIndex((line, i) => i > 0 && isDashSeparator(line) && lines[i - 1].trim() !== "");
  if (sepIndex < 1) return undefined;

  const ranges = dashRanges(lines[sepIndex]);
  if (ranges.length < 2 && !isSqlite) return undefined;
  if (ranges.length === 0) return undefined;

  const sliceRow = (line: string) =>
    ranges.map(([start], i) => line.slice(start, ranges[i + 1]?.[0] ?? line.length).trim());

  const columns = sliceRow(lines[sepIndex - 1]);
  if (columns.every((column) => column === "")) return undefined;
  const dataLines = lines.slice(sepIndex + 1).filter((line) => line.trim() !== "");
  const rows = dataLines.slice(0, MAX_TABLE_ROWS).map(sliceRow);

  return { kind: "table", columns, rows, totalRows: dataLines.length };
}

function isDashSeparator(line: string): boolean {
  return /-/.test(line) && /^[\s-]+$/.test(line);
}

function dashRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const regex = /-+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

// ── matches (rg / grep, including pipelines) ────────────────────────────────
function classifyMatches(cmd: string, text: string): OutputRender | undefined {
  // The searcher can be the whole command (`rg foo src`) or the last meaningful
  // stage of a pipeline (`nl file | rg foo`, `cat log | grep -n x`).
  const stages = pipeStages(cmd);
  const searchIndex = stages.findIndex((stage) => /^(?:rg|grep|ag|ack)\b/.test(stage));
  if (searchIndex < 0) return undefined;

  const patterns = grepPatterns(stages[searchIndex]);
  // No filename in stdin-fed output (`… | rg`): attribute to the input file that
  // feeds the searcher (the stage just before it), if we can name one.
  const sourcePath = searchIndex > 0 ? filePath(stages[searchIndex - 1]) : undefined;
  // `nl` / `cat -n` prepend "<n>\t" to every line; once rg/grep adds its own line
  // number the content carries a redundant copy — strip it for a clean match line.
  const stripsLineNumbers = /(?:^|\|)\s*(?:nl|cat\s+-n)\b/.test(cmd);

  const byFile = new Map<string, MatchFile>();
  const order: string[] = [];

  for (const line of toLines(text)) {
    const withPath = /^(.+?):(\d+):([\s\S]*)$/.exec(line);
    const noPath = /^(\d+):([\s\S]*)$/.exec(line);
    let path: string;
    let lineNo: number;
    let content: string;
    if (withPath && !/^\d+$/.test(withPath[1])) {
      [, path, , content] = withPath;
      lineNo = Number(withPath[2]);
    } else if (noPath) {
      path = sourcePath ?? "";
      lineNo = Number(noPath[1]);
      content = noPath[2];
    } else {
      continue;
    }
    if (stripsLineNumbers) {
      const stripped = /^\s*\d+\t([\s\S]*)$/.exec(content);
      if (stripped) content = stripped[1];
    }
    const entry: MatchLine = { n: lineNo, text: content };
    const col = firstHit(content, patterns);
    if (col) entry.col = col;
    let file = byFile.get(path);
    if (!file) {
      file = { path, matches: [] };
      byFile.set(path, file);
      order.push(path);
    }
    file.matches.push(entry);
  }

  if (order.length === 0) return undefined;
  return { kind: "matches", files: order.map((path) => byFile.get(path)!) };
}

/**
 * Literal alternatives to highlight, taken from the first non-flag argument of an
 * rg/grep stage. A simple `a|b|c` alternation yields each literal alternative;
 * non-literal regex bits are dropped (we only highlight what we can find verbatim).
 */
function grepPatterns(stage: string): string[] {
  const tokens = stage.split(/\s+/).slice(1);
  let raw: string | undefined;
  for (const token of tokens) {
    if (token.startsWith("-")) continue;
    raw = token.replace(/^['"]|['"]$/g, "");
    break;
  }
  if (!raw) return [];
  return raw
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && /^[\w\s.+-]+$/.test(part));
}

/** Earliest verbatim occurrence of any pattern in `content` → `[start, end]`. */
function firstHit(content: string, patterns: string[]): [number, number] | undefined {
  let bestStart = -1;
  let bestLen = 0;
  for (const pattern of patterns) {
    const at = content.indexOf(pattern);
    if (at >= 0 && (bestStart < 0 || at < bestStart)) {
      bestStart = at;
      bestLen = pattern.length;
    }
  }
  return bestStart >= 0 ? [bestStart, bestStart + bestLen] : undefined;
}

// ── tree (ls / find / tree) → directory listing ─────────────────────────────
const TREE_HEADS = /^(?:find|fd|ls|tree|exa|eza)$/;
const LS_LONG_MODE = /^[dlbcps-][rwxsStT@.+-]{9}[.@+]?$/;

/** Type from a trailing marker (`ls -p`/`-F`/symlink); defaults to file. */
function entryTypeFromName(name: string): { name: string; type: TreeEntryType } {
  if (/\s(?:->|→)\s/.test(name) || name.endsWith("@")) return { name: name.replace(/@$/, ""), type: "link" };
  if (/[/]$/.test(name)) return { name: name.replace(/\/+$/, ""), type: "dir" };
  if (name.endsWith("*") || name.endsWith("=")) return { name: name.slice(0, -1), type: "file" };
  return { name, type: "file" };
}

function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function classifyTree(cmd: string, text: string): OutputRender | undefined {
  const stages = pipeStages(cmd);
  const head = stageHead(stages[0] ?? "");
  if (!TREE_HEADS.test(head)) return undefined;
  const findType = / -type\s+([dfl])\b/.exec(cmd)?.[1];

  const entries: TreeEntry[] = [];
  for (const raw of toLines(text)) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "" || /^total\s+\d+$/.test(trimmed)) continue;
    if (/^(?:find|fd|ls|tree):\s/.test(trimmed)) continue; // tool error lines

    const tokens = trimmed.split(/\s+/);
    // `ls -l` / `-la` long format: "drwxr-xr-x 1 owner group size mon day time name"
    if (tokens.length >= 9 && LS_LONG_MODE.test(tokens[0])) {
      const lead = tokens[0][0];
      const type: TreeEntryType = lead === "d" ? "dir" : lead === "l" ? "link" : "file";
      const name = tokens.slice(8).join(" ");
      if (!name || name === "." || name === "..") continue;
      const entry: TreeEntry = { name, type, depth: 0 };
      if (type === "file") {
        const sizeToken = tokens[4];
        if (/^\d+$/.test(sizeToken)) entry.size = humanizeBytes(Number(sizeToken));
        else if (sizeToken) entry.size = sizeToken;
      }
      entries.push(entry);
      continue;
    }

    // `tree` command glyphs: "│   ├── name"
    const glyph = /^((?:[│|]\s+|\s{2,})*[├└][─ ]+)(.+)$/.exec(line);
    if (glyph) {
      const depth = Math.max(0, Math.round(glyph[1].replace(/[├└─]/g, " ").replace(/\s+$/, "").length / 4));
      const parsed = entryTypeFromName(glyph[2].trim());
      entries.push({ name: parsed.name, type: parsed.type, depth });
      continue;
    }

    // Plain path (find / `ls` / `ls -p`).
    const parsed = entryTypeFromName(trimmed);
    const type: TreeEntryType = findType === "d" ? "dir" : findType === "l" ? "link" : parsed.type;
    entries.push({ name: parsed.name, type, depth: 0 });
  }

  if (entries.length === 0) return undefined;
  return { kind: "tree", entries: entries.slice(0, MAX_DIR_ENTRIES), totalEntries: entries.length };
}

// ── build (cargo / go / tsc / webpack) ──────────────────────────────────────
function classifyBuild(cmd: string, text: string): OutputRender | undefined {
  const first = pipeStages(cmd)[0] ?? "";
  const head = stageHead(first);
  const sub = (first.split(/\s+/)[1] ?? "").toLowerCase();
  const isBuild =
    (head === "cargo" && /^(?:build|check|rustc)$/.test(sub)) ||
    (head === "go" && sub === "build") ||
    head === "tsc" ||
    head === "rustc" ||
    head === "webpack" ||
    head === "esbuild" ||
    (/^(?:npm|pnpm|yarn|bun)$/.test(head) && /\bbuild\b/.test(first)) ||
    head === "make" ||
    head === "gradle" ||
    head === "mvn";
  if (!isBuild) return undefined;
  const tool = /^(?:npm|pnpm|yarn|bun)$/.test(head) ? "build" : head;

  const diagnostics: BuildDiagnostic[] = [];
  const lines = toLines(text);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // tsc: "src/db.ts(44,14): error TS2339: msg" | "src/db.ts:44:14 - error TS2339: msg"
    let m =
      /^(\S+?)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+)?:?\s*(.*)$/.exec(line) ??
      /^(\S+?):(\d+):(\d+)\s*-\s*(error|warning)\s*(TS\d+)?:?\s*(.*)$/.exec(line);
    if (m) {
      diagnostics.push({
        severity: m[4] === "warning" ? "warning" : "error",
        code: m[5] || undefined,
        file: m[1],
        line: Number(m[2]),
        col: Number(m[3]),
        message: m[6].trim(),
      });
      continue;
    }
    // go: "./file.go:44:14: msg" | "file.go:44: msg"
    m = /^(\.?\/?[\w./-]+\.go):(\d+)(?::(\d+))?:\s*(.+)$/.exec(line);
    if (m) {
      diagnostics.push({ severity: "error", file: m[1], line: Number(m[2]), col: m[3] ? Number(m[3]) : undefined, message: m[4].trim() });
      continue;
    }
    // cargo/rustc: "error[E0599]: msg" then "  --> src/db.rs:44:14"
    m = /^(error|warning)(?:\[([A-Z]\d+)\])?:\s*(.*)$/.exec(line);
    const loc = /^\s*-->\s*(\S+?):(\d+)(?::(\d+))?/.exec(lines[i + 1] ?? "");
    if (m && loc) {
      diagnostics.push({
        severity: m[1] === "warning" ? "warning" : "error",
        code: m[2] || undefined,
        file: loc[1],
        line: Number(loc[2]),
        col: loc[3] ? Number(loc[3]) : undefined,
        message: m[3].trim(),
      });
      continue;
    }
  }

  let errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const tscFound = /Found (\d+) error/.exec(text);
  if (tscFound) errors = Math.max(errors, Number(tscFound[1]));
  const hasSignal =
    diagnostics.length > 0 ||
    /\b(Compiling|Finished|Found \d+ error|webpack \d|Build complete|error TS|error\[|warning:)\b/.test(text);
  if (!hasSignal) return undefined;
  return { kind: "build", tool, errors, warnings, diagnostics: diagnostics.slice(0, 200) };
}

// ── lint (eslint / ruff / clippy) ───────────────────────────────────────────
function classifyLint(cmd: string, text: string): OutputRender | undefined {
  const first = pipeStages(cmd)[0] ?? "";
  const head = stageHead(first);
  const sub = (first.split(/\s+/)[1] ?? "").toLowerCase();
  const named = /\b(eslint|ruff|flake8|pylint|stylelint|biome)\b/.exec(first)?.[1];
  const isLint =
    /^(?:eslint|ruff|flake8|pylint|stylelint|biome)$/.test(head) ||
    (head === "cargo" && sub === "clippy") ||
    (/^(?:npx|npm|pnpm|yarn|bun)$/.test(head) && Boolean(named));
  if (!isLint) return undefined;
  const tool = head === "cargo" ? "clippy" : /^(?:eslint|ruff|flake8|pylint|stylelint|biome)$/.test(head) ? head : named ?? head;

  const byFile = new Map<string, LintFile>();
  const order: string[] = [];
  const add = (path: string, issue: LintIssue) => {
    let file = byFile.get(path);
    if (!file) {
      file = { path, issues: [] };
      byFile.set(path, file);
      order.push(path);
    }
    file.issues.push(issue);
  };

  let currentFile: string | undefined;
  for (const line of toLines(text)) {
    // eslint "stylish": a bare path header line
    if (/^\/?[\w./@-]+\.\w+$/.test(line.trim()) && !/:\d+:\d+/.test(line)) {
      currentFile = line.trim();
      continue;
    }
    // eslint row: "  44:21  warning  message text   rule/id"
    let m = /^\s*(\d+):(\d+)\s+(error|warning|info)\s+(.*?)\s{2,}(\S+)\s*$/.exec(line);
    if (m && currentFile) {
      add(currentFile, { severity: m[3] as LintIssue["severity"], line: Number(m[1]), col: Number(m[2]), message: m[4].trim(), rule: m[5] });
      continue;
    }
    // ruff / flake8: "file.py:line:col: CODE message"
    m = /^(\S+?):(\d+):(\d+):\s*([A-Z]\d+)\s+(.*)$/.exec(line);
    if (m) {
      add(m[1], { severity: "warning", line: Number(m[2]), col: Number(m[3]), rule: m[4], message: m[5].trim() });
      continue;
    }
  }

  const files = order.map((path) => byFile.get(path)!);
  const errors = files.reduce((sum, file) => sum + file.issues.filter((i) => i.severity === "error").length, 0);
  const warnings = files.reduce((sum, file) => sum + file.issues.filter((i) => i.severity === "warning").length, 0);
  return { kind: "lint", tool, errors, warnings, files };
}

// ── log (git log / git blame) ───────────────────────────────────────────────
function classifyLog(cmd: string, text: string): OutputRender | undefined {
  if (!gitSubcommand("(?:log|blame|shortlog)").test(pipeStages(cmd)[0] ?? "")) return undefined;
  const lines = toLines(text);
  const commits: LogCommit[] = [];

  const oneline = /^([0-9a-f]{7,40})\s+(?:\(([^)]+)\)\s+)?(.+)$/;
  for (const line of lines) {
    const m = oneline.exec(line);
    if (m) {
      commits.push({
        hash: m[1].slice(0, 9),
        author: "",
        date: "",
        subject: m[3],
        refs: m[2] ? m[2].split(/,\s*/).flatMap((ref) => ref.split(/\s*->\s*/)) : undefined,
      });
    }
  }

  if (commits.length === 0) {
    // default `git log` block format
    let current: LogCommit | null = null;
    for (const line of lines) {
      let m = /^commit ([0-9a-f]{7,40})/.exec(line);
      if (m) {
        if (current) commits.push(current);
        current = { hash: m[1].slice(0, 9), author: "", date: "", subject: "" };
        continue;
      }
      if (!current) continue;
      if ((m = /^Author:\s*(.+?)\s*(?:<.*>)?$/.exec(line))) current.author = m[1].trim();
      else if ((m = /^Date:\s*(.+)$/.exec(line))) current.date = m[1].trim();
      else if (!current.subject && /^\s{2,}\S/.test(line)) current.subject = line.trim();
    }
    if (current) commits.push(current);
  }

  if (commits.length === 0) return undefined;
  return { kind: "log", total: commits.length, commits: commits.slice(0, 200) };
}

// ── json (jq / cat *.json) ──────────────────────────────────────────────────
function classifyJson(cmd: string, text: string): OutputRender | undefined {
  const stages = pipeStages(cmd);
  const lastHead = stageHead(stages[stages.length - 1] ?? "");
  const firstHead = stageHead(stages[0] ?? "");
  const jsonFile = /(\S+\.json)\b/.exec(cmd)?.[1];
  const isJq = lastHead === "jq";
  const isCatJson = (firstHead === "cat" || firstHead === "bat") && Boolean(jsonFile);
  if (!isJq && !isCatJson) return undefined;
  const body = text.trim();
  if (!/^[[{]/.test(body)) return undefined;
  try {
    const value = JSON.parse(body);
    return { kind: "json", source: jsonFile ? jsonFile.split("/").pop() : undefined, value };
  } catch {
    return undefined;
  }
}

// ── trace (python traceback / rust panic / node error) ──────────────────────
function classifyTrace(cmd: string, text: string): OutputRender | undefined {
  void cmd;
  const lines = toLines(text);

  if (/^Traceback \(most recent call last\):/m.test(text)) {
    const frames: TraceFrame[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const m = /^\s*File "([^"]+)", line (\d+), in (.+)$/.exec(lines[i]);
      if (!m) continue;
      const next = lines[i + 1] ?? "";
      const code = /^\s{2,}\S/.test(next) && !/^\s*File "/.test(next) ? next.trim() : undefined;
      frames.push({
        fn: m[3].trim(),
        file: m[1],
        line: Number(m[2]),
        user: !/(site-packages|dist-packages|lib\/python\d|<frozen)/.test(m[1]),
        code,
      });
    }
    const errLine = [...lines].reverse().find((line) => /^[A-Za-z_][\w.]*(?:Error|Exception|Warning|Interrupt|Exit):/.test(line.trim()));
    const parsed = errLine ? /^([\w.]+):\s*([\s\S]*)$/.exec(errLine.trim()) : null;
    if (frames.length) {
      return { kind: "trace", lang: "python", exception: parsed?.[1] ?? "Exception", message: parsed?.[2]?.trim() ?? "", frames };
    }
  }

  const rustPanic = /thread '[^']*' panicked at\s*(?:'([^']*)'|(.+))/.exec(text);
  if (rustPanic) {
    const frames: TraceFrame[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const fn = /^\s*\d+:\s+(.+)$/.exec(lines[i]);
      const at = /^\s*at\s+(\S+?):(\d+)/.exec(lines[i + 1] ?? "");
      if (fn && at) {
        frames.push({ fn: fn[1].trim(), file: at[1], line: Number(at[2]), user: !/\/rustc\/|\.cargo\/registry/.test(at[1]) });
      }
    }
    return { kind: "trace", lang: "rust", exception: "panicked", message: (rustPanic[1] ?? rustPanic[2] ?? "").trim(), frames };
  }

  if (/^\s*at\s+.+:\d+:\d+\)?$/m.test(text) && /^(?:\w*Error|\w+Exception):/m.test(text)) {
    const errLine = lines.find((line) => /^(?:\w*Error|\w+Exception):/.test(line));
    const parsed = errLine ? /^([\w.]+):\s*([\s\S]*)$/.exec(errLine) : null;
    const frames: TraceFrame[] = [];
    for (const line of lines) {
      const withFn = /^\s*at\s+(.+?)\s+\(([^)]+):(\d+):\d+\)/.exec(line);
      const bare = /^\s*at\s+([^()\s]+):(\d+):\d+$/.exec(line);
      if (withFn) frames.push({ fn: withFn[1].trim(), file: withFn[2], line: Number(withFn[3]), user: !/node_modules|node:internal/.test(withFn[2]) });
      else if (bare) frames.push({ fn: "<anonymous>", file: bare[1], line: Number(bare[2]), user: !/node_modules|node:internal/.test(bare[1]) });
    }
    if (frames.length) return { kind: "trace", lang: "node", exception: parsed?.[1] ?? "Error", message: parsed?.[2]?.trim() ?? "", frames };
  }

  return undefined;
}

// ── file peek (nl / cat / sed -n / head / tail) ─────────────────────────────
function classifyFile(cmd: string, text: string): OutputRender | undefined {
  const isFileProgram = /^(?:nl|cat|sed|head|tail|bat)\b/.test(cmd);
  const lines = toLines(text);
  if (lines.length === 0) return undefined;

  // `nl` (or anything piped through it) emits "<spaces><n>\t<content>".
  const nlMatches = lines.map((line) => /^\s*(\d+)\t([\s\S]*)$/.exec(line));
  const nlHits = nlMatches.filter(Boolean).length;
  if (nlHits >= Math.max(1, Math.floor(lines.length * 0.6))) {
    const parsed: FileLine[] = nlMatches
      .map((match) => (match ? { n: Number(match[1]), text: match[2] } : undefined))
      .filter((entry): entry is FileLine => Boolean(entry))
      .slice(0, MAX_FILE_LINES);
    return { kind: "file", path: filePath(cmd), lines: parsed };
  }

  if (!isFileProgram) return undefined;

  const startLine = sedStartLine(cmd) ?? 1;
  const parsed: FileLine[] = lines
    .slice(0, MAX_FILE_LINES)
    .map((line, i) => ({ n: startLine + i, text: line }));
  return { kind: "file", path: filePath(cmd), startLine, lines: parsed };
}

function sedStartLine(cmd: string): number | undefined {
  const range = /(\d+),(\d+)p/.exec(cmd) ?? /-n\s*['"]?(\d+)/.exec(cmd);
  return range ? Number(range[1]) : undefined;
}

/** Last path-like token (skips flags, quoted ranges, pipes, redirections). */
function filePath(cmd: string): string | undefined {
  const head = cmd.split(/\s*[|;]\s*/)[0];
  const tokens = head.split(/\s+/).slice(1);
  let path: string | undefined;
  for (const token of tokens) {
    if (token.startsWith("-")) continue;
    if (/^['"]/.test(token)) continue; // sed range / script
    if (token.startsWith(">") || token.startsWith("<") || token === "&&") continue;
    if (/^\d+$/.test(token)) continue;
    path = token;
  }
  return path;
}
