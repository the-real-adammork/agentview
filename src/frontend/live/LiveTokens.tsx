import { createContext, useContext, useSyncExternalStore } from "react";

import { AnimatedNumber } from "../components/AnimatedNumber";
import { TOKEN_BAR_CELLS, tokenBarFill } from "../views/tokenBar";
import { createLiveTokenStore, type LiveTokenStore } from "./liveTokenStore";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

const defaultLiveTokenStore = createLiveTokenStore();

export const LiveTokenStoreContext = createContext<LiveTokenStore>(defaultLiveTokenStore);

export function useLiveTokenTotal(fallback: number): number {
  const store = useContext(LiveTokenStoreContext);
  const total = useSyncExternalStore(store.subscribe, store.getTotal);
  // total is 0 only before the store has been seeded; show the caller's
  // server-computed value until live data arrives.
  return total === 0 ? fallback : total;
}

export function useLiveTokenValue(id: string, fallback: number): number {
  const store = useContext(LiveTokenStoreContext);
  const value = useSyncExternalStore(store.subscribe, () => store.getValue(id));
  return value ?? fallback;
}

export function LiveTokenTotal({ fallback }: { fallback: number }) {
  const total = useLiveTokenTotal(fallback);
  return (
    <span data-testid="live-token-total">
      <AnimatedNumber value={total} format={(value) => compactNumberFormatter.format(value)} />
    </span>
  );
}

export function LiveSessionTokens({
  sessionId,
  fallback,
  live = false,
}: {
  sessionId: string;
  fallback: number;
  /** When true, show a pulsing green "live" dot — the session is streaming. */
  live?: boolean;
}) {
  const value = useLiveTokenValue(sessionId, fallback);
  const { filled, hi } = tokenBarFill(value);

  return (
    <>
      <span className="tok-cell">
        {live ? <span className="tok-live" aria-label="live">●</span> : null}
        <AnimatedNumber value={value} format={(input) => numberFormatter.format(input)} />
      </span>
      <div className="segbar" aria-hidden="true">
        {Array.from({ length: TOKEN_BAR_CELLS }, (_, index) => index < filled).map((on, index) => (
          <i className={on ? (hi ? "hi" : "on") : undefined} key={index} />
        ))}
      </div>
    </>
  );
}
