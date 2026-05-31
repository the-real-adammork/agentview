import { open, stat } from "node:fs/promises";

import type { TimelineEvent } from "../../../shared/contracts";
import { parseClaudeSessionLines } from "./parseClaudeSession";

/** Surfaced on a `timeline` `reset` and as a `warnings` entry when the transcript shrank/rotated. */
export const CLAUDE_TRUNCATION_WARNING = "Claude Code transcript was truncated; tail restarted from byte 0.";

export interface ClaudeTailResult {
  events: TimelineEvent[];
  /** Byte offset of the end of the last complete line consumed (resume point). */
  nextByte: number;
  /** Running source-line counter advanced past the consumed lines. */
  nextLine: number;
  /** The file shrank/rotated below `fromByte`; the tail restarted from byte 0. */
  truncated: boolean;
  warnings: string[];
}

export interface TailClaudeTranscriptOptions {
  /** Absolute path to the primary CC transcript. */
  path: string;
  /** Session id used to build event ids (mirrors the cold parser's `threadId`). */
  sessionId: string;
  /** Client's current byte offset (clamped to a safe non-negative integer). */
  fromByte: number;
  /** Running source-line counter the appended lines continue from (1-based). */
  fromLine?: number;
}

/**
 * The CC analog of `src/backend/tail/liveTail.ts::tailRolloutFile`: an incremental
 * byte-offset read of a CC `.jsonl` transcript that feeds only newly-appended
 * COMPLETE lines through the Phase 4 line parser (`parseClaudeSessionLines`),
 * preserving the exact partial-line / truncation mechanics Codex uses so a tailed
 * CC event is indistinguishable from a cold-loaded one.
 *
 * - Cold start (`fromByte === 0`): read `[0, size)`, parse every complete line.
 * - Incremental (`0 < fromByte ≤ size`): read `[fromByte, size)`, emit only the
 *   newly-appended complete lines; never re-emit prior lines.
 * - No new bytes (`fromByte === size`): return empty with unchanged offsets (no open).
 * - Partial trailing line: stop at the last newline; the half-written fragment's
 *   bytes are NOT consumed and `nextByte` does not advance past it.
 * - Truncation (`fromByte > size`): restart at byte 0, emit all lines, warn.
 *
 * Never throws on a malformed JSON line — `parseClaudeSessionLines` records a
 * warning and skips, and those warnings are surfaced here for the live frame.
 */
export const tailClaudeTranscript = async ({
  path,
  sessionId,
  fromByte,
  fromLine = 1,
}: TailClaudeTranscriptOptions): Promise<ClaudeTailResult> => {
  const sourceStat = await stat(path);
  const safeFromByte = Number.isSafeInteger(fromByte) && fromByte >= 0 ? fromByte : 0;
  const truncated = safeFromByte > sourceStat.size;
  const offset = truncated ? 0 : safeFromByte;
  const length = Math.max(0, sourceStat.size - offset);
  // On truncation the tail restarts from byte 0, so the running line counter
  // restarts too — emitted events re-baseline at line 1 (mirrors the Codex
  // `reset ? 1 + linesRead` continuation logic, applied here so the result is
  // self-consistent regardless of the stale incoming `fromLine`).
  const startLine = truncated ? 1 : fromLine;

  if (length === 0) {
    return {
      events: [],
      nextByte: sourceStat.size,
      nextLine: startLine,
      truncated,
      warnings: truncated ? [CLAUDE_TRUNCATION_WARNING] : [],
    };
  }

  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const chunk = buffer.subarray(0, bytesRead).toString("utf8");
    const lastNewline = chunk.lastIndexOf("\n");

    if (lastNewline < 0) {
      // Only a partial fragment so far — hold it until its terminating newline lands.
      return {
        events: [],
        nextByte: offset,
        nextLine: startLine,
        truncated,
        warnings: truncated ? [CLAUDE_TRUNCATION_WARNING] : [],
      };
    }

    const completeChunk = chunk.slice(0, lastNewline);
    const nextByte = offset + Buffer.byteLength(chunk.slice(0, lastNewline + 1), "utf8");
    const lines = completeChunk.length ? completeChunk.split(/\r?\n/) : [];
    const facts = parseClaudeSessionLines(lines, {
      threadId: sessionId,
      rolloutPath: path,
      sourceMtimeMs: sourceStat.mtimeMs,
      sourceSizeBytes: sourceStat.size,
      parsedThroughByte: nextByte,
      startingLine: startLine,
    });

    return {
      events: facts.events,
      nextByte,
      nextLine: startLine + lines.length,
      truncated,
      warnings: [...(truncated ? [CLAUDE_TRUNCATION_WARNING] : []), ...facts.warnings],
    };
  } finally {
    await handle.close();
  }
};

/**
 * Count complete source lines before a byte offset so cold and live tail paths
 * agree on the running line baseline (mirrors the Codex `countLinesBefore` in
 * `liveSources.ts`). Without this the tail would restart `sourceLine` at 1 and the
 * timeline's (timestamp, sourceLine) sort would misplace same-second streamed events.
 */
export const countLinesBefore = async (path: string, byteOffset: number): Promise<number> => {
  if (byteOffset <= 0) return 0;
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(byteOffset);
    const { bytesRead } = await handle.read(buffer, 0, byteOffset, 0);
    let lines = 0;
    for (let i = 0; i < bytesRead; i += 1) {
      if (buffer[i] === 0x0a) lines += 1;
    }
    return lines;
  } finally {
    await handle.close();
  }
};
