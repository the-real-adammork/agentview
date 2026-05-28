// Token totals span several orders of magnitude (thousands to billions). A fixed
// "K" suffix renders ~94 billion as "93953K"; compact notation yields K/M/B/T so
// every magnitude stays legible. Shared so the Repos and Sessions views match the
// compact formatting the Timeline, Agent Graph, and live token views already use.
const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Compact token count, e.g. 93_953_000 -> "94M", 1_234 -> "1.2K", 5e9 -> "5B". */
export const formatTokens = (value: number): string => compactTokenFormatter.format(value);
