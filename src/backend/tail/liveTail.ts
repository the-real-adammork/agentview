import { open, stat } from "node:fs/promises";

import type { TimelinePayload } from "../../shared/contracts";
import { parseRolloutLines } from "../rollout/parseRollout";

export interface TailRolloutResult {
  payload: Pick<TimelinePayload, "events" | "nextByteOffset">;
  truncated: boolean;
  warnings: string[];
  /** Number of source lines consumed, so callers can advance a running line counter. */
  linesRead: number;
}

export const tailRolloutFile = async ({
  path,
  threadId,
  fromByte,
  sourceLine = 1,
}: {
  path: string;
  threadId: string;
  fromByte: number;
  sourceLine?: number;
}): Promise<TailRolloutResult> => {
  const sourceStat = await stat(path);
  const safeFromByte = Number.isSafeInteger(fromByte) && fromByte >= 0 ? fromByte : 0;
  const truncated = safeFromByte > sourceStat.size;
  const offset = truncated ? 0 : safeFromByte;
  const length = Math.max(0, sourceStat.size - offset);

  if (length === 0) {
    return {
      payload: { events: [], nextByteOffset: sourceStat.size },
      truncated,
      warnings: truncated ? ["Rollout file was truncated; tail restarted from byte 0."] : [],
      linesRead: 0,
    };
  }

  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const chunk = buffer.subarray(0, bytesRead).toString("utf8");
    const lastNewline = chunk.lastIndexOf("\n");

    if (lastNewline < 0) {
      return {
        payload: { events: [], nextByteOffset: offset },
        truncated,
        warnings: truncated ? ["Rollout file was truncated; tail restarted from byte 0."] : [],
        linesRead: 0,
      };
    }

    const completeChunk = chunk.slice(0, lastNewline);
    const nextByteOffset = offset + Buffer.byteLength(chunk.slice(0, lastNewline + 1), "utf8");
    const lines = completeChunk.length ? completeChunk.split(/\r?\n/) : [];
    const facts = parseRolloutLines(lines, {
      threadId,
      rolloutPath: path,
      sourceMtimeMs: sourceStat.mtimeMs,
      sourceSizeBytes: sourceStat.size,
      parsedThroughByte: nextByteOffset,
      startingLine: sourceLine,
    });

    return {
      payload: { events: facts.events, nextByteOffset },
      truncated,
      warnings: [...(truncated ? ["Rollout file was truncated; tail restarted from byte 0."] : []), ...facts.warnings],
      linesRead: lines.length,
    };
  } finally {
    await handle.close();
  }
};
