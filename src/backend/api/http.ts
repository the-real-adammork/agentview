import type { IncomingMessage, ServerResponse } from "node:http";

import type { ApiError, ApiResult, ApiSource } from "../../shared/contracts";

const baseCorsHeaders = {
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "cache-control": "no-store",
};

/** Reads and JSON-parses a request body. Returns undefined for an empty body; throws on invalid JSON. */
export const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
};

export const corsHeadersForOrigin = (origin: string | undefined) => {
  if (!origin) {
    return baseCorsHeaders;
  }

  try {
    const url = new URL(origin);
    const isLoopback =
      url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);

    if (isLoopback) {
      return {
        ...baseCorsHeaders,
        "access-control-allow-origin": url.origin,
        vary: "Origin",
      };
    }
  } catch {
    return baseCorsHeaders;
  }

  return baseCorsHeaders;
};

export const ok = <T>(source: ApiSource, data: T, warnings: string[] = []): ApiResult<T> => ({
  ok: true,
  data,
  source,
  warnings,
});

export const fail = (source: ApiSource, error: ApiError, warnings: string[] = []): ApiResult<never> => ({
  ok: false,
  error,
  source,
  warnings,
});

export const writeJson = (
  response: ServerResponse,
  status: number,
  body: ApiResult<unknown>,
  origin?: string,
) => {
  response.writeHead(status, {
    ...corsHeadersForOrigin(origin),
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
};
