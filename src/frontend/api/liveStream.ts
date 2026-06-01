import type {
  LiveDiagnosticsPayload,
  LiveErrorPayload,
  LiveReadyPayload,
  LiveSessionsPayload,
  LiveTimelinePayload,
  LiveTokensPayload,
  SourceId,
} from "../../shared/contracts";

export interface LiveStreamCallbacks {
  onSessions(payload: LiveSessionsPayload): void;
  onTimeline(payload: LiveTimelinePayload): void;
  onTokens(payload: LiveTokensPayload): void;
  onDiagnostics(payload: LiveDiagnosticsPayload): void;
  onReady(payload: LiveReadyPayload): void;
  onError(payload: LiveErrorPayload): void;
}

export interface OpenLiveStreamOptions {
  baseUrl?: string;
  threadId: string | null;
  /** Optional source hint for legacy callers; live timeline routing resolves by session id when omitted. */
  source?: SourceId;
  fromByte: number | null;
  logCursorId: number | null;
  callbacks: LiveStreamCallbacks;
  EventSourceImpl?: typeof EventSource;
  /** Max consecutive failed reconnects (without a `ready`) before giving up. */
  maxRetries?: number;
  reconnectDelayMs?: number;
}

export interface LiveStreamHandle {
  close(): void;
}

const defaultBaseUrl = (import.meta.env.VITE_AGENTVIEW_API_BASE_URL ?? "http://127.0.0.1:4317").replace(/\/$/, "");

export const openLiveStream = ({
  baseUrl = defaultBaseUrl,
  threadId,
  source: sessionSource,
  fromByte,
  logCursorId,
  callbacks,
  EventSourceImpl,
  maxRetries = 5,
  reconnectDelayMs = 3000,
}: OpenLiveStreamOptions): LiveStreamHandle => {
  // Resolve EventSource from the environment; absent (e.g. jsdom/SSR) → no-op, stay on fetch.
  const EventSourceCtor =
    EventSourceImpl ?? (globalThis as { EventSource?: typeof EventSource }).EventSource;
  let source: EventSource | null = null;
  let closed = false;
  let consecutiveFailures = 0;
  let currentFromByte = fromByte;
  let currentLogCursorId = logCursorId;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (threadId) params.set("threadId", threadId);
    void sessionSource;
    if (currentFromByte !== null) params.set("fromByte", String(currentFromByte));
    if (currentLogCursorId !== null) params.set("logCursorId", String(currentLogCursorId));
    const query = params.toString();
    return `${baseUrl}/api/stream${query ? `?${query}` : ""}`;
  };

  const addJsonListener = <T>(es: EventSource, channel: string, handler: (payload: T) => void) => {
    es.addEventListener(channel, (event) => {
      try {
        handler(JSON.parse((event as MessageEvent).data) as T);
      } catch {
        // Ignore malformed frames and the browser's native (data-less) "error" event.
      }
    });
  };

  const connect = () => {
    if (closed || !EventSourceCtor) return;
    const es = new EventSourceCtor(buildUrl());
    source = es;

    addJsonListener<LiveSessionsPayload>(es, "sessions", callbacks.onSessions);
    addJsonListener<LiveTokensPayload>(es, "tokens", callbacks.onTokens);
    addJsonListener<LiveDiagnosticsPayload>(es, "diagnostics", callbacks.onDiagnostics);
    addJsonListener<LiveErrorPayload>(es, "error", callbacks.onError);
    addJsonListener<LiveReadyPayload>(es, "ready", (payload) => {
      consecutiveFailures = 0; // a clean baseline resets the retry budget
      if (payload.nextByteOffset !== null) currentFromByte = payload.nextByteOffset;
      if (payload.logCursorId !== null) currentLogCursorId = payload.logCursorId;
      callbacks.onReady(payload);
    });
    addJsonListener<LiveTimelinePayload>(es, "timeline", (payload) => {
      currentFromByte = payload.nextByteOffset;
      callbacks.onTimeline(payload);
    });

    es.onerror = () => {
      es.close();
      source = null;
      consecutiveFailures += 1;
      if (closed || consecutiveFailures >= maxRetries) return; // give up → stay on fetch
      reconnectTimer = setTimeout(connect, reconnectDelayMs);
    };
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      source = null;
    },
  };
};
