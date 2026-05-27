export const TOKEN_BAR_CELLS = 12;

// Session token totals are cumulative lifetime tokens and span several orders of
// magnitude (hundreds of thousands to hundreds of millions), so a linear scale
// saturates almost every bar. Map log10(tokens) across a fixed 10K–100M window
// (~3 cells per decade) to keep the full range legible and comparable across reloads.
const LOG_MIN = 4; // 10^4 = 10K tokens -> first cell lights up
const LOG_MAX = 8; // 10^8 = 100M tokens -> bar is full

export interface TokenBarFill {
  filled: number;
  hi: boolean;
}

export function tokenBarFill(value: number, cells = TOKEN_BAR_CELLS): TokenBarFill {
  const fraction = value <= 0 ? 0 : (Math.log10(value) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  const clamped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(clamped * cells);
  // Highlight the genuinely heavy sessions (bar near full).
  const hi = filled >= cells - 2;
  return { filled, hi };
}
