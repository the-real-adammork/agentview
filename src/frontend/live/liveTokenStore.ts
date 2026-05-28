import type { SessionSummary } from "../../shared/contracts";

type LiveTokenSession = Pick<SessionSummary, "id" | "tokenTotal"> & Pick<Partial<SessionSummary>, "tokensUsed">;

type Listener = () => void;

export interface LiveTokenStore {
  setSessions(sessions: LiveTokenSession[]): void;
  subscribe(listener: Listener): () => void;
  getValue(id: string): number | undefined;
  getTotal(): number;
}

const tokenValue = (session: LiveTokenSession) => session.tokensUsed ?? session.tokenTotal;

export function createLiveTokenStore(): LiveTokenStore {
  let valuesById = new Map<string, number>();
  let total = 0;
  const listeners = new Set<Listener>();

  return {
    setSessions(sessions) {
      const next = new Map<string, number>();
      let nextTotal = 0;
      for (const session of sessions) {
        const value = tokenValue(session);
        next.set(session.id, value);
        nextTotal += value;
      }
      valuesById = next;
      total = nextTotal;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getValue(id) {
      return valuesById.get(id);
    },
    getTotal() {
      return total;
    },
  };
}
