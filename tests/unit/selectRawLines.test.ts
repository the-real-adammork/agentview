import { describe, expect, it } from "vitest";

import { selectRawLines } from "../../src/backend/rollout/selectRawLines";

const lines = [
  '{"type":"user_message","content":"hi"}', // 1
  '{"type":"tool_call","call_id":"c1","name":"exec_command"}', // 2
  '{"type":"tool_output","call_id":"c1","output":"done"}', // 3
  '{"type":"assistant_message","content":"ok"}', // 4
  '{"type":"tool_call","call_id":"c2","name":"exec_command"}', // 5
  "", // 6 (blank)
  '{"type":"tool_output","call_id":"c2","output":"x"}', // 7
];

describe("selectRawLines", () => {
  it("returns the requested lines verbatim, in file order", () => {
    expect(selectRawLines(lines, [4, 1], false)).toBe(`${lines[0]}\n${lines[3]}`);
  });

  it("includes the matching result line for a selected tool_call (by call_id)", () => {
    // request only the call line (2); includeResults pulls its output (3)
    const out = selectRawLines(lines, [2], true).split("\n");
    expect(out).toEqual([lines[1], lines[2]]);
  });

  it("does not pull results when includeResults is false", () => {
    expect(selectRawLines(lines, [5], false)).toBe(lines[4]);
  });

  it("ignores out-of-range and blank line numbers", () => {
    expect(selectRawLines(lines, [0, 6, 99, 1], false)).toBe(lines[0]);
  });

  it("dedupes when a result line is also explicitly requested", () => {
    const out = selectRawLines(lines, [2, 3], true).split("\n");
    expect(out).toEqual([lines[1], lines[2]]); // not duplicated
  });
});
