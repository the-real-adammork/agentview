import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { LiveConnection } from "../live/liveHub";
import { getLiveRuntime } from "../live/liveRuntime";
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

  response.writeHead(200, {
    ...corsHeadersForOrigin(origin),
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  // Open the stream immediately so proxies/browsers commit to the connection.
  response.write(":ok\n\n");

  const connection: LiveConnection = {
    id: randomUUID(),
    threadId,
    write: (frame) => response.write(frame),
    close: () => response.end(),
  };

  const runtime = await getLiveRuntime();
  runtime.hub.add(connection);

  const heartbeat = setInterval(() => {
    response.write(": keep-alive\n\n");
  }, HEARTBEAT_MS);

  const teardown = await runtime.sources.subscribe({
    connection,
    threadId,
    filter: { archived: "include" },
    page: { limit: 500, offset: 0 },
    fromByte,
    logCursorId,
  });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    runtime.hub.remove(connection.id);
    void teardown();
  };
  request.on("close", cleanup);
  response.on("close", cleanup);

  return true;
};
