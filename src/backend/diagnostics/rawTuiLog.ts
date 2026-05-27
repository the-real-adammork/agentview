import { open, stat } from "node:fs/promises";

import type { RawTuiLogTail } from "../../shared/contracts";
import { maskPreviewSecrets } from "../../shared/redaction";
import { resolveCodexRawTuiLogPath } from "../codexPaths";

export class RawTuiLogError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RawTuiLogError";
    this.code = code;
  }
}

const maxReadBytes = 64 * 1024;

export const tailRawTuiLog = async ({
  codexHome,
  fromByte = 0,
  maxBytes = 16 * 1024,
}: {
  codexHome: string;
  fromByte?: number;
  maxBytes?: number;
}): Promise<RawTuiLogTail> => {
  if (!Number.isSafeInteger(fromByte) || fromByte < 0) {
    throw new RawTuiLogError("INVALID_RAW_TAIL_OFFSET", "fromByte must be a non-negative integer.");
  }

  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RawTuiLogError("INVALID_RAW_TAIL_LIMIT", "maxBytes must be a positive integer.");
  }

  const rawLogPath = await resolveCodexRawTuiLogPath(codexHome);
  const fileStat = await stat(rawLogPath);
  const start = Math.min(fromByte, fileStat.size);
  const readBytes = Math.min(maxBytes, maxReadBytes, Math.max(fileStat.size - start, 0));

  if (readBytes === 0) {
    return {
      fromByte: start,
      textPreview: "",
      redactionApplied: false,
      nextByteOffset: start,
      truncated: fromByte > fileStat.size,
    };
  }

  const file = await open(rawLogPath, "r");
  try {
    const buffer = Buffer.alloc(readBytes);
    const { bytesRead } = await file.read(buffer, 0, readBytes, start);
    const preview = maskPreviewSecrets(buffer.subarray(0, bytesRead).toString("utf8"), { includeMetadata: true });

    return {
      fromByte: start,
      textPreview: preview.text,
      redactionApplied: preview.redactionApplied,
      nextByteOffset: start + bytesRead,
      truncated: start + bytesRead < fileStat.size,
    };
  } finally {
    await file.close();
  }
};
