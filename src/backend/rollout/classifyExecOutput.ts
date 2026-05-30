import type {
  DiffFile,
  FileLine,
  HttpHeader,
  MatchFile,
  MatchLine,
  OutputRender,
  StatusFile,
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
    classifyFile(cmd, text) ??
    classifyDirectory(cmd, text) ??
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
  for (const ch of cmd) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
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

/** Unwrap `bash -lc "…"` / `sh -c '…'` wrappers and strip leading `ENV=val`. */
function normalizeCommand(raw: string): string {
  let cmd = raw.trim();
  const wrapper = /^(?:[\w./-]*\/)?(?:bash|sh|zsh)\s+-l?c\s+(['"])([\s\S]*)\1\s*$/.exec(cmd);
  if (wrapper) cmd = wrapper[2].trim();
  // Strip leading environment assignments (`FOO=bar BAZ=qux cmd …`).
  cmd = cmd.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, "");
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
  const commandIsDiff = /^git(?:\s+-C\s+\S+)?\s+(?:diff|show)\b/.test(cmd);
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

// ── http (curl / wget -i) ───────────────────────────────────────────────────
function classifyHttp(cmd: string, text: string): OutputRender | undefined {
  const statusLine = /^HTTP\/[\d.]+\s+(\d{3})(?:\s+(.*))?$/m.exec(text);
  if (!statusLine) return undefined;

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
    // `-X`/`--request` sit after a space, so a \b before the dash never matches —
    // anchor on a space/start instead. Default to GET when no method flag is given.
    method: /(?:^|\s)(?:-X|--request)\s+(\w+)/.exec(cmd)?.[1] ?? "GET",
    url: extractUrl(cmd),
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
  const isGitStatus = /^git(?:\s+-C\s+\S+)?\s+status\b/.test(cmd) && /(?:^|\s)(?:--short|-s)\b/.test(cmd);
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

// ── directory (find / fd / ls) → flat path list ─────────────────────────────
function classifyDirectory(cmd: string, text: string): OutputRender | undefined {
  const stages = pipeStages(cmd);
  const head = stageHead(stages[0] ?? "");
  if (!/^(?:find|fd|ls)$/.test(head)) return undefined;
  // `ls -l` long listings are mode/owner/size rows, not a clean path list — skip.
  if (head === "ls" && /(?:^|\s)-\w*l/.test(stages[0])) return undefined;

  const entries: string[] = [];
  for (const line of toLines(text)) {
    const entry = line.trim();
    if (entry === "") continue;
    // Tool error lines ("find: …: Permission denied") are not entries.
    if (/^(?:find|fd|ls):\s/.test(entry)) continue;
    entries.push(entry);
  }
  if (entries.length === 0) return undefined;
  return { kind: "directory", entries: entries.slice(0, MAX_DIR_ENTRIES), totalEntries: entries.length };
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
