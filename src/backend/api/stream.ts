import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { LiveConnection } from "../live/liveHub";
import { getLiveRuntime } from "../live/liveRuntime";
import { parseSourceId } from "../sources/sourceQuery";
import { corsHeadersForOrigin } from "./http";

const HEARTBEAT_MS = 20_000;

const liveEnabled = () => (process.env.AGENTVIEW_LIVE ?? "1") !== "0";

const parseIntParam = (value: string | null): number | null => {
  if (value === null || value.trim() === "") return null;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const handleStreamApiRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> => {
  const origin = request.headers.origin;
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname !== "/api/stream") return false;

  // Kill switch / method guard fall through to the 404 path so the client drops to fetch-only.
  if (!liveEnabled() || request.method !== "GET") return false;

  const threadId = url.searchParams.get("threadId")?.trim() || null;
  const fromByte = parseIntParam(url.searchParams.get("fromByte"));
  const logCursorId = parseIntParam(url.searchParams.get("logCursorId"));
  // SourceId dispatch discriminator (default "codex"). An unknown value on the SSE
  // path degrades to the default rather than a JSON 400; with one registered
  // source this is a no-op but carries the discriminator into the subscribe.
  const sourceResult = parseSourceId(url);
  const source = sourceResult.ok ? sourceResult.source : "codex";

  response.writeHead(200, {
    ...corsHeadersForOrigin(origin),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const runtime = await getLiveRuntime();

  let cleanedUp = false;
  // Holder so cleanup() can reference these before they're assigned below
  // (subscribe/heartbeat are wired after the listeners that may call cleanup).
  const resources: { heartbeat?: ReturnType<typeof setInterval>; teardown?: () => void | Promise<void> } = {};

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (resources.heartbeat) clearInterval(resources.heartbeat);
    runtime.hub.remove(connection.id);
    void resources.teardown?.();
  };

  // A client can drop at any time; once the socket is ended/destroyed any further
  // write throws ERR_STREAM_WRITE_AFTER_END. Guard every write and tear the
  // connection down on failure so one dead client never crashes the process.
  const writable = () => !cleanedUp && !response.writableEnded && !response.destroyed;
  const safeWrite = (frame: string): boolean => {
    if (!writable()) return false;
    try {
      return response.write(frame);
    } catch {
      cleanup();
      return false;
    }
  };
  const safeClose = () => {
    if (response.writableEnded || response.destroyed) return;
    try {
      response.end();
    } catch {
      /* socket already closing */
    }
  };

  const connection: LiveConnection = {
    id: randomUUID(),
    threadId,
    write: safeWrite,
    close: safeClose,
  };

  // Without these listeners an async transport error becomes an uncaught
  // exception (and takes the whole API down), so register them before any write.
  request.on("close", cleanup);
  request.on("error", cleanup);
  response.on("close", cleanup);
  response.on("error", cleanup);

  runtime.hub.add(connection);

  // Open the stream immediately so proxies/browsers commit to the connection.
  safeWrite(":ok\n\n");

  resources.heartbeat = setInterval(() => {
    safeWrite(": keep-alive\n\n");
  }, HEARTBEAT_MS);

  resources.teardown = await runtime.sources.subscribe({
    connection,
    threadId,
    filter: { archived: "include" },
    page: { limit: 500, offset: 0 },
    source,
    fromByte,
    logCursorId,
  });

  // If the client already vanished during the awaited subscribe, reconcile now.
  if (!writable()) cleanup();

  return true;
};
