import { afterEach, describe, expect, it, vi } from "vitest";

import { openLiveStream } from "../../src/frontend/api/liveStream";

// Minimal EventSource fake.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  listeners = new Map<string, (event: { data: string }) => void>();
  onerror: ((event: unknown) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, listener);
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

const noopCallbacks = () => ({
  onSessions: vi.fn(),
  onTimeline: vi.fn(),
  onTokens: vi.fn(),
  onDiagnostics: vi.fn(),
  onReady: vi.fn(),
  onError: vi.fn(),
});

afterEach(() => {
  FakeEventSource.instances = [];
  Reflect.deleteProperty(window, "agentview");
});

describe("openLiveStream", () => {
  it("routes named events to typed callbacks and tracks the timeline cursor", () => {
    const callbacks = noopCallbacks();
    openLiveStream({
      baseUrl: "http://127.0.0.1:4317",
      threadId: "t1",
      fromByte: 10,
      logCursorId: null,
      callbacks,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });

    const es = FakeEventSource.instances[0];
    expect(es.url).toContain("threadId=t1");
    expect(es.url).toContain("fromByte=10");

    es.emit("ready", { threadId: "t1", nextByteOffset: 10, logCursorId: null });
    es.emit("timeline", { threadId: "t1", events: [{ id: "e1" }], nextByteOffset: 50, reset: false, warnings: [] });

    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    expect(callbacks.onTimeline).toHaveBeenCalledWith(expect.objectContaining({ nextByteOffset: 50 }));
  });

  it("reconnects with the latest cursor and stops after maxRetries without ready", () => {
    vi.useFakeTimers();
    const handle = openLiveStream({
      baseUrl: "http://127.0.0.1:4317",
      threadId: "t1",
      fromByte: 0,
      logCursorId: null,
      maxRetries: 2,
      callbacks: noopCallbacks(),
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });

    // First connection advances the cursor, then errors → reconnect uses the new cursor.
    FakeEventSource.instances[0].emit("timeline", {
      threadId: "t1",
      events: [],
      nextByteOffset: 77,
      reset: false,
      warnings: [],
    });
    FakeEventSource.instances[0].onerror?.({});
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances[1].url).toContain("fromByte=77");

    // Second consecutive error without a ready → give up (no third instance).
    FakeEventSource.instances[1].onerror?.({});
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(2);

    handle.close();
    vi.useRealTimers();
  });

  it("uses the Electron runtime API URL when no explicit base URL is provided", async () => {
    vi.resetModules();
    Object.defineProperty(window, "agentview", {
      configurable: true,
      value: { apiBaseUrl: "http://127.0.0.1:61234/" },
    });

    const { openLiveStream: openRuntimeLiveStream } = await import("../../src/frontend/api/liveStream");
    openRuntimeLiveStream({
      threadId: "t1",
      fromByte: null,
      logCursorId: null,
      callbacks: noopCallbacks(),
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    });

    expect(FakeEventSource.instances[0].url).toBe("http://127.0.0.1:61234/api/stream?threadId=t1");
  });
});
