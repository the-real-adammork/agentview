import type { LiveChannel } from "../../shared/contracts";

export interface LiveConnection {
  /** Stable id for this SSE connection. */
  id: string;
  /** The active thread this connection follows, or null. */
  threadId: string | null;
  /** Writes a preformatted SSE frame. Returns false when the socket buffer is full. */
  write(frame: string): boolean;
  /** Forcibly closes the connection (backpressure on a delta channel). */
  close(): void;
}

export interface LiveHub {
  add(connection: LiveConnection): void;
  remove(id: string): void;
  connections(): LiveConnection[];
  connectionsForThread(threadId: string): LiveConnection[];
  send(connection: LiveConnection, channel: LiveChannel, payload: unknown): void;
}

/** Delta channels: append-only, gaps corrupt client state — close instead of dropping. */
const CRITICAL = new Set<LiveChannel>(["timeline"]);

export const formatSseFrame = (channel: LiveChannel, payload: unknown): string =>
  `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`;

export const createLiveHub = (): LiveHub => {
  const byId = new Map<string, LiveConnection>();

  return {
    add(connection) {
      byId.set(connection.id, connection);
    },
    remove(id) {
      byId.delete(id);
    },
    connections() {
      return [...byId.values()];
    },
    connectionsForThread(threadId) {
      return [...byId.values()].filter((connection) => connection.threadId === threadId);
    },
    send(connection, channel, payload) {
      const ok = connection.write(formatSseFrame(channel, payload));
      if (ok) return;
      // Snapshot + control channels are coalescable: the next push supersedes them, so drop silently.
      // Delta channels must never gap — close the connection so the client reconnects and re-baselines.
      if (CRITICAL.has(channel)) {
        connection.close();
        byId.delete(connection.id);
      }
    },
  };
};
