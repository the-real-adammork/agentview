import { describe, expect, it } from "vitest";

import { TOKEN_BAR_CELLS, tokenBarFill } from "../../src/frontend/views/tokenBar";

describe("token bar calibration", () => {
  it("maps zero / empty sessions to an empty bar", () => {
    expect(tokenBarFill(0).filled).toBe(0);
    expect(tokenBarFill(-5).filled).toBe(0);
  });

  it("increases monotonically across orders of magnitude", () => {
    const small = tokenBarFill(176_000).filled;
    const medium = tokenBarFill(1_000_000).filled;
    const large = tokenBarFill(10_000_000).filled;
    const huge = tokenBarFill(100_000_000).filled;

    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
    expect(large).toBeLessThan(huge);
    expect(huge).toBe(TOKEN_BAR_CELLS);
  });

  it("does not saturate every large session (the calibration bug)", () => {
    // Representative of real cumulative-token data where ~96% exceed 220K.
    const values = [239_179, 5_000_000, 50_000_000, 171_113_951];
    const fills = values.map((v) => tokenBarFill(v).filled);

    // Distinct fills, and the smallest large session is clearly not full.
    expect(new Set(fills).size).toBeGreaterThan(1);
    expect(Math.min(...fills)).toBeLessThan(TOKEN_BAR_CELLS);
  });

  it("highlights only near-full (heavy) sessions", () => {
    expect(tokenBarFill(1_000_000).hi).toBe(false);
    expect(tokenBarFill(171_113_951).hi).toBe(true);
  });

  it("never exceeds the cell count", () => {
    expect(tokenBarFill(5_000_000_000).filled).toBe(TOKEN_BAR_CELLS);
  });
});
