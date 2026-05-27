import { describe, expect, it } from "vitest";

import { createLiveHub, formatSseFrame } from "../../src/backend/live/liveHub";
import type { LiveConnection } from "../../src/backend/live/liveHub";

const makeConn = (
  id: string,
  threadId: string | null,
  writeReturns = true,
): LiveConnection & { frames: string[]; closed: boolean } => {
  const conn = {
    id,
    threadId,
    frames: [] as string[],
    closed: false,
    write(frame: string) {
      conn.frames.push(frame);
      return writeReturns;
    },
    close() {
      conn.closed = true;
    },
  };
  return conn;
};

describe("formatSseFrame", () => {
  it("emits a named event with JSON data terminated by a blank line", () => {
    const frame = formatSseFrame("sessions", { sessions: [] });
    expect(frame).toBe('event: sessions\ndata: {"sessions":[]}\n\n');
  });
});

describe("liveHub", () => {
  it("routes thread-scoped sends only to matching connections", () => {
    const hub = createLiveHub();
    const a = makeConn("a", "thread-1");
    const b = makeConn("b", "thread-2");
    hub.add(a);
    hub.add(b);

    for (const conn of hub.connectionsForThread("thread-1")) {
      hub.send(conn, "timeline", { threadId: "thread-1", events: [], nextByteOffset: 1, reset: false, warnings: [] });
    }

    expect(a.frames).toHaveLength(1);
    expect(b.frames).toHaveLength(0);
  });

  it("delivers different per-connection payloads without cross-talk", () => {
    const hub = createLiveHub();
    const a = makeConn("a", "thread-1");
    const b = makeConn("b", "thread-1");
    hub.add(a);
    hub.add(b);

    hub.send(a, "timeline", { threadId: "thread-1", events: [], nextByteOffset: 10, reset: false, warnings: [] });
    hub.send(b, "timeline", { threadId: "thread-1", events: [], nextByteOffset: 20, reset: false, warnings: [] });

    expect(a.frames[0]).toContain('"nextByteOffset":10');
    expect(b.frames[0]).toContain('"nextByteOffset":20');
  });

  it("stops delivery after remove()", () => {
    const hub = createLiveHub();
    const a = makeConn("a", null);
    hub.add(a);
    hub.remove("a");
    expect(hub.connections()).toHaveLength(0);
  });

  it("drops coalescable snapshots on backpressure but never closes", () => {
    const hub = createLiveHub();
    const a = makeConn("a", "thread-1", /* writeReturns */ false);
    hub.add(a);
    hub.send(a, "sessions", { sessions: [] });
    expect(a.frames).toHaveLength(1); // attempted once
    expect(a.closed).toBe(false);
  });

  it("closes the connection when a timeline delta hits backpressure", () => {
    const hub = createLiveHub();
    const a = makeConn("a", "thread-1", /* writeReturns */ false);
    hub.add(a);
    hub.send(a, "timeline", { threadId: "thread-1", events: [], nextByteOffset: 1, reset: false, warnings: [] });
    expect(a.closed).toBe(true);
    expect(hub.connections()).toHaveLength(0);
  });
});
