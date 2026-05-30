import { useEffect, useState } from "react";

import type {
  DiffOutputRender,
  DirectoryOutputRender,
  FileOutputRender,
  HttpOutputRender,
  MatchesOutputRender,
  OutputRender,
  StatusOutputRender,
  TableOutputRender,
  TestsOutputRender,
  TimelineEvent,
} from "../../shared/contracts";

/*
 * exec_command output renderers — reusable presentational components driven by
 * the server-classified `outputRender` JSON. Each renders a capped INLINE
 * preview and, in the modal, the FULL output. No parsing here: the server did
 * it once. Ported from docs/design/workflowkit-evangelion/exec-renderers.jsx.
 *
 * The *View components are pure (props: r + full) and library-grade — not tied
 * to the timeline. ExecOutput / ExecModal adapt a TimelineEvent onto them.
 */

// ── inline caps (single source of truth, mirrored by execOverflow) ──────────
const CAP_DIFF = 6;
const CAP_FILE = 8;
const CAP_MATCHES = 6;
const CAP_TESTS = 2;
const CAP_STATUS = 5;
const CAP_TABLE = 6;
const CAP_HTTP_HEADERS = 3;
const CAP_DIR = 10;
const CAP_PLAIN = 8;

function DiffView({ r, full }: { r: DiffOutputRender; full?: boolean }) {
  let shown = 0;
  return (
    <div className="xr xr-diff">
      {r.files.map((file, fi) => (
        <div className="xr-file" key={fi}>
          <div className="xr-file-hd">
            <span className="path">{file.path}</span>
            <span className="adds">+{file.added}</span>
            <span className="dels">−{file.removed}</span>
          </div>
          {file.hunks.map((hunk, hi) => (
            <div className="xr-hunk" key={hi}>
              <div className="xr-hunk-hd">{hunk.header}</div>
              {hunk.lines.map((line, li) => {
                if (!full && shown >= CAP_DIFF) return null;
                shown += 1;
                return (
                  <div className={`xr-line ${line.t}`} key={li}>
                    <span className="g">{line.t === "add" ? "+" : line.t === "del" ? "−" : " "}</span>
                    <span className="c">{line.text}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TestsView({ r, full }: { r: TestsOutputRender; full?: boolean }) {
  const ok = r.failed === 0;
  const failing = full ? r.failing : r.failing.slice(0, CAP_TESTS);
  return (
    <div className="xr xr-tests" data-ok={ok}>
      <div className="xr-tests-hd">
        <span className="t-pass">✓ {r.passed} passed</span>
        {r.failed > 0 ? <span className="t-fail">✗ {r.failed} failed</span> : null}
        {r.skipped > 0 ? <span className="t-skip">⊘ {r.skipped} skipped</span> : null}
        {r.durationMs !== undefined ? <span className="t-dur num">{(r.durationMs / 1000).toFixed(1)}s</span> : null}
      </div>
      {failing.length > 0 ? (
        <div className="xr-fail-list">
          {failing.map((name, i) => (
            <div className="xr-fail-row" key={i}>
              <span className="x">✗</span>
              <span className="nm">{name}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const statusCodeClass = (code: string) =>
  code === "M" ? "m" : code === "A" ? "a" : code === "D" ? "d" : code === "R" ? "r" : "u";

function StatusView({ r, full }: { r: StatusOutputRender; full?: boolean }) {
  const files = full ? r.files : r.files.slice(0, CAP_STATUS);
  return (
    <div className="xr xr-status">
      {files.map((file, i) => (
        <div className="xr-st-row" key={i}>
          <span className={`xr-st-code ${statusCodeClass(file.code)}`}>{file.code}</span>
          <span className="xr-st-path">{file.path}</span>
        </div>
      ))}
    </div>
  );
}

function TableView({ r, full }: { r: TableOutputRender; full?: boolean }) {
  const rows = full ? r.rows : r.rows.slice(0, CAP_TABLE);
  return (
    <div className="xr xr-table-wrap">
      <table className="xr-table">
        <thead>
          <tr>
            {r.columns.map((column, i) => (
              <th key={i}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td className="num" key={ci}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileView({ r, full }: { r: FileOutputRender; full?: boolean }) {
  const lines = full ? r.lines : r.lines.slice(0, CAP_FILE);
  const start = r.startLine ?? r.lines[0]?.n ?? 1;
  const last = r.lines.length ? r.lines[r.lines.length - 1].n : start;
  return (
    <div className="xr xr-file-peek">
      <div className="xr-fp-hd">
        {r.path ? <span className="path">{r.path}</span> : null}
        <span className="rng num">
          L{start}–{last}
          {r.totalLines ? ` / ${r.totalLines}` : ""}
        </span>
      </div>
      <div className="xr-fp-body">
        {lines.map((line, i) => (
          <div className="xr-fp-line" key={i}>
            <span className="n num">{line.n}</span>
            <span className="c">{line.text === "" ? " " : line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchesView({ r, full }: { r: MatchesOutputRender; full?: boolean }) {
  let shown = 0;
  const renderHit = (text: string, col?: [number, number]) => {
    if (!col) return <span className="c">{text}</span>;
    const [start, end] = col;
    return (
      <span className="c">
        {text.slice(0, start)}
        <span className="hit">{text.slice(start, end)}</span>
        {text.slice(end)}
      </span>
    );
  };
  return (
    <div className="xr xr-matches">
      {r.files.map((file, fi) => {
        if (!full && shown >= CAP_MATCHES) return null;
        const lines = full ? file.matches : file.matches.slice(0, Math.max(0, CAP_MATCHES - shown));
        shown += lines.length;
        return (
          <div className="xr-mt-file" key={fi}>
            <div className="xr-mt-file-hd">
              <span className="path">{file.path}</span>
              <span className="cnt num">{file.matches.length}</span>
            </div>
            {lines.map((match, mi) => (
              <div className="xr-mt-row" key={mi}>
                <span className="ln num">{match.n}</span>
                {renderHit(match.text, match.col)}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DirectoryView({ r, full }: { r: DirectoryOutputRender; full?: boolean }) {
  const entries = full ? r.entries : r.entries.slice(0, CAP_DIR);
  return (
    <div className="xr xr-dir">
      {entries.map((entry, i) => {
        const isDir = entry.endsWith("/");
        const trimmed = isDir ? entry.slice(0, -1) : entry;
        const slash = trimmed.lastIndexOf("/");
        const parent = slash >= 0 ? entry.slice(0, slash + 1) : "";
        const leaf = slash >= 0 ? entry.slice(slash + 1) : entry;
        return (
          <div className={`xr-dir-row${isDir ? " dir" : ""}`} key={i}>
            {parent ? <span className="p">{parent}</span> : null}
            <span className="f">{leaf}</span>
          </div>
        );
      })}
    </div>
  );
}

function HttpView({ r, full }: { r: HttpOutputRender; full?: boolean }) {
  const statusClass = r.status >= 500 ? "s5" : r.status >= 400 ? "s4" : r.status >= 300 ? "s3" : "s2";
  const headers = r.headers ?? [];
  const shownHeaders = full ? headers : headers.slice(0, CAP_HTTP_HEADERS);
  const bodyText = r.body ?? "";
  const body = full ? bodyText : bodyText.split("\n").slice(0, CAP_PLAIN).join("\n");
  return (
    <div className="xr xr-http">
      <div className="xr-http-req">
        <span className="method" data-method={(r.method ?? "GET").toUpperCase()}>
          {(r.method ?? "GET").toUpperCase()}
        </span>
        <span className="url">{r.url}</span>
      </div>
      <div className="xr-http-status">
        <span className={`code ${statusClass}`}>{r.status}</span>
        <span className="reason">{r.statusText ?? ""}</span>
        {r.durationMs !== undefined ? <span className="t num">{r.durationMs}ms</span> : null}
        {r.size !== undefined ? <span className="sz num">{r.size}</span> : null}
      </div>
      {shownHeaders.length > 0 ? (
        <div className="xr-http-hdrs">
          {shownHeaders.map((header, i) => (
            <div className="hrow" key={i}>
              <span className="hk">{header.k}</span>
              <span className="hv">{header.v}</span>
            </div>
          ))}
        </div>
      ) : null}
      {bodyText ? (
        <div className="xr-http-body">
          <div className="bd-lbl">{r.contentType ?? (r.json ? "application/json" : "body")}</div>
          <pre className={`bd${r.json ? " json" : ""}`}>{body}</pre>
        </div>
      ) : null}
    </div>
  );
}

function PlainOut({ text, full }: { text: string; full?: boolean }) {
  const shown = full ? text : text.split("\n").slice(0, CAP_PLAIN).join("\n");
  return <pre className="xr xr-plain">{shown}</pre>;
}

/** The renderer for a given kind, preview or full. Shared by row + modal. */
function RenderOutput({ render, plainText, full }: { render?: OutputRender; plainText: string; full?: boolean }) {
  switch (render?.kind) {
    case "diff":
      return <DiffView r={render} full={full} />;
    case "tests":
      return <TestsView r={render} full={full} />;
    case "status":
      return <StatusView r={render} full={full} />;
    case "table":
      return <TableView r={render} full={full} />;
    case "file":
      return <FileView r={render} full={full} />;
    case "matches":
      return <MatchesView r={render} full={full} />;
    case "directory":
      return <DirectoryView r={render} full={full} />;
    case "http":
      return <HttpView r={render} full={full} />;
    default:
      return <PlainOut text={plainText} full={full} />;
  }
}

// ── overflow: does the inline preview hide anything? returns a label or null ──
export function execOverflow(event: TimelineEvent): string | null {
  const render = event.outputRender;
  if (!render || render.kind === "plain") {
    const lines = plainTextFor(event).split("\n").length;
    return lines > CAP_PLAIN ? `${lines - CAP_PLAIN} more lines` : null;
  }
  switch (render.kind) {
    case "diff": {
      let total = 0;
      render.files.forEach((file) => file.hunks.forEach((hunk) => (total += hunk.lines.length)));
      return total > CAP_DIFF ? `${total - CAP_DIFF} more lines` : null;
    }
    case "tests":
      return render.failing.length > CAP_TESTS ? `${render.failing.length - CAP_TESTS} more failures` : null;
    case "status":
      return render.files.length > CAP_STATUS ? `${render.files.length - CAP_STATUS} more files` : null;
    case "table": {
      const total = render.totalRows ?? render.rows.length;
      return render.rows.length > CAP_TABLE ? `${total - CAP_TABLE} more rows` : null;
    }
    case "file": {
      const total = render.totalLines ?? render.lines.length;
      return render.lines.length > CAP_FILE ? `${total - CAP_FILE} more lines` : null;
    }
    case "matches": {
      const total = render.files.reduce((sum, file) => sum + file.matches.length, 0);
      return total > CAP_MATCHES ? `${total - CAP_MATCHES} more matches` : null;
    }
    case "directory": {
      const total = render.totalEntries ?? render.entries.length;
      return render.entries.length > CAP_DIR ? `${total - CAP_DIR} more paths` : null;
    }
    case "http": {
      const headers = (render.headers ?? []).length;
      const bodyLines = (render.body ?? "").split("\n").length;
      return Math.max(0, headers - CAP_HTTP_HEADERS) + Math.max(0, bodyLines - CAP_PLAIN) > 0 ? "headers + body" : null;
    }
    default:
      return null;
  }
}

/** Plain text used by the plain renderer + the modal RAW toggle. */
function plainTextFor(event: TimelineEvent): string {
  return event.joinedOutputPreview ?? event.outputPreview ?? event.rawPreview ?? "";
}

const rawTextFor = (event: TimelineEvent): string => event.rawPreview ?? plainTextFor(event);

const kindLabel = (event: TimelineEvent): string => {
  const render = event.outputRender;
  const bytes = event.outputBytes ?? plainTextFor(event).length;
  switch (render?.kind) {
    case "diff":
      return "DIFF";
    case "tests":
      return "TEST RESULTS";
    case "status":
      return "GIT STATUS";
    case "table":
      return render.totalRows ? `${render.totalRows} ROWS` : "TABLE";
    case "file":
      return `FILE · ${(render.path ?? "").split("/").pop() ?? ""}`.trim();
    case "matches":
      return `${render.files.reduce((sum, file) => sum + file.matches.length, 0)} MATCHES`;
    case "directory":
      return `${render.totalEntries ?? render.entries.length} PATHS`;
    case "http":
      return `HTTP ${render.status}`;
    default:
      return `STDOUT · ${bytes.toLocaleString("en-US")} bytes`;
  }
};

const isFailed = (event: TimelineEvent): boolean => {
  const exit = event.joinedExitCode ?? event.exitCode;
  return exit !== undefined && exit !== 0;
};

/** True when the output has a structured render or its plain preview overflows. */
export function isExpandable(event: TimelineEvent): boolean {
  return Boolean(event.outputRender && event.outputRender.kind !== "plain") || execOverflow(event) !== null;
}

// ── inline preview + expand bar ─────────────────────────────────────────────
export function ExecOutput({ event, onExpand }: { event: TimelineEvent; onExpand?: () => void }) {
  const render = event.outputRender;
  const kind = render?.kind ?? "plain";
  const overflow = execOverflow(event);
  const fail = isFailed(event);

  return (
    <div className={`xr-out${fail ? " fail" : ""}`}>
      <div className="xr-out-hd">
        <span className="xr-kind" data-kind={kind}>
          {kindLabel(event)}
        </span>
        {fail ? <span className="xr-failtag">FAILED</span> : null}
      </div>
      <RenderOutput render={render} plainText={plainTextFor(event)} />
      {overflow ? (
        <button
          className="xr-expand"
          type="button"
          onClick={(domEvent) => {
            domEvent.stopPropagation();
            onExpand?.();
          }}
        >
          Expand · {overflow} ›
        </button>
      ) : null}
    </div>
  );
}

const durationLabel = (durationMs: number) =>
  durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${Math.round(durationMs)}ms`;

// ── full-output modal — same renderers, scrollable, with raw escape hatch ────
export function ExecModal({ event, onClose }: { event: TimelineEvent; onClose: () => void }) {
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    const onKey = (domEvent: KeyboardEvent) => {
      if (domEvent.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const render = event.outputRender;
  const kind = render?.kind ?? "plain";
  const command = event.commandPreview ?? event.toolName ?? "exec";
  const exit = event.joinedExitCode ?? event.exitCode;
  const durationMs = event.joinedDurationMs ?? event.durationMs;
  const fail = isFailed(event);
  const hasRaw = Boolean(event.rawPreview);

  return (
    <div className="xr-modal-scrim" onClick={onClose}>
      <div
        className="xr-modal"
        onClick={(domEvent) => domEvent.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${kind} output`}
      >
        <div className="xr-modal-hd">
          <span className="xr-modal-kind" data-kind={kind}>
            {kind.toUpperCase()}
          </span>
          <span className="xr-modal-cmd num">$ {command}</span>
          <span className="spacer" />
          {exit !== undefined ? (
            <span className={`chip ${fail ? "warn" : "good"}`}>
              exit {exit}
              {durationMs !== undefined ? ` · ${durationLabel(durationMs)}` : ""}
            </span>
          ) : null}
          {hasRaw ? (
            <button className="xr-raw-btn" type="button" data-on={raw} onClick={() => setRaw((value) => !value)}>
              {raw ? "FORMATTED" : "RAW"}
            </button>
          ) : null}
          <button className="xr-modal-close" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="xr-modal-body">
          {raw ? (
            <PlainOut text={rawTextFor(event)} full />
          ) : (
            <RenderOutput render={render} plainText={plainTextFor(event)} full />
          )}
        </div>
      </div>
    </div>
  );
}
