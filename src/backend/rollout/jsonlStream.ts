import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { parseRolloutLines, type ParseRolloutOptions } from "./parseRollout";

export interface ReadJsonlResult {
  lines: string[];
  bytesRead: number;
}

export const readJsonlLines = async (path: string): Promise<ReadJsonlResult> => {
  const lines: string[] = [];
  let bytesRead = 0;
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    bytesRead += Buffer.byteLength(line, "utf8") + 1;
    lines.push(line);
  }

  return { lines, bytesRead };
};

export const parseRolloutFile = async (path: string, options: ParseRolloutOptions) => {
  const { lines, bytesRead } = await readJsonlLines(path);
  return parseRolloutLines(lines, {
    ...options,
    parsedThroughByte: bytesRead,
  });
};
