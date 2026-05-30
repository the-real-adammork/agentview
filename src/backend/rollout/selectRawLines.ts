/**
 * Select verbatim rollout lines for a raw export. Given the full file's lines and
 * a set of 1-based `sourceLine` numbers (whatever the UI filtered to), returns the
 * matching raw JSONL — in file order. With `includeResults`, it also pulls any
 * line sharing a selected tool_call's `call_id` (the result/output records), since
 * renderer analysis needs the outputs, not just the calls.
 */

const callIdOf = (line: string): string | undefined => {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (typeof record !== "object" || record === null) return undefined;
    const payload = typeof record.payload === "object" && record.payload !== null ? (record.payload as Record<string, unknown>) : record;
    const value = record.call_id ?? record.callId ?? payload.call_id ?? payload.callId;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
};

export function selectRawLines(lines: string[], sourceLines: number[], includeResults: boolean): string {
  const selected = new Set<number>();
  for (const n of sourceLines) {
    if (Number.isInteger(n) && n >= 1 && n <= lines.length && lines[n - 1]?.trim()) selected.add(n);
  }

  if (includeResults && selected.size > 0) {
    const callIds = new Set<string>();
    for (const n of selected) {
      const id = callIdOf(lines[n - 1]);
      if (id) callIds.add(id);
    }
    if (callIds.size > 0) {
      for (let n = 1; n <= lines.length; n += 1) {
        if (selected.has(n) || !lines[n - 1]?.trim()) continue;
        const id = callIdOf(lines[n - 1]);
        if (id && callIds.has(id)) selected.add(n);
      }
    }
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((n) => lines[n - 1])
    .join("\n");
}
