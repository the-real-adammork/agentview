import { describe, expect, it } from "vitest";

import { formatTokens } from "../../src/frontend/views/formatTokens";

describe("formatTokens", () => {
  it("abbreviates thousands, millions, and billions instead of always using K", () => {
    expect(formatTokens(1_234)).toBe("1.2K");
    expect(formatTokens(94_000)).toBe("94K");
    expect(formatTokens(1_234_567)).toBe("1.2M");
    // the reported bug: ~94 billion was rendered as "93953K"
    expect(formatTokens(93_953_000_000)).toBe("94B");
    expect(formatTokens(5_000_000_000)).toBe("5B");
  });

  it("renders small and zero values without a magnitude suffix", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
  });
});
