import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCodexHomeFixture, type CodexHomeFixture } from "../fixtures/codexHome";

interface RunningApi {
  baseUrl: string;
  output(): string;
  stop(): Promise<void>;
}

interface JsonResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

const repoRoot = process.cwd();
const runningApis: RunningApi[] = [];
const tempRoots: string[] = [];

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate an API port.")));
        return;
      }

      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const waitForExit = (child: ChildProcessWithoutNullStreams, timeoutMs: number) =>
  new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, timeoutMs);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

const startApi = async ({
  codexHome,
  env = {},
}: {
  codexHome: string;
  env?: Record<string, string>;
}): Promise<RunningApi> => {
  const port = await getFreePort();
  const output: string[] = [];
  const child = spawn("npm", ["run", "api"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENTVIEW_API_PORT: String(port),
      CODEX_HOME: codexHome,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));

  const baseUrl = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 8_000) {
    if (child.exitCode !== null) {
      throw new Error(`API server exited before startup.\n${output.join("")}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.status >= 200 && response.status < 600) {
        const api: RunningApi = {
          baseUrl,
          output: () => output.join(""),
          async stop() {
            if (child.exitCode === null) {
              child.kill("SIGTERM");
              await waitForExit(child, 2_000);
            }
          },
        };
        runningApis.push(api);
        return api;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  child.kill("SIGKILL");
  throw new Error(`API server did not become ready.\n${output.join("")}`);
};

const requestJson = async (baseUrl: string, path: string): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
};

const withApi = async <T>(
  fixture: CodexHomeFixture,
  run: (api: RunningApi) => Promise<T>,
  env?: Record<string, string>,
) => {
  const api = await startApi({ codexHome: fixture.codexHome, env });

  try {
    return await run(api);
  } finally {
    await api.stop();
    await fixture.cleanup();
  }
};

const createRolloutFile = async (
  fixture: CodexHomeFixture,
  relativePath: string,
  lines: Array<Record<string, unknown>>,
) => {
  const rolloutPath = join(fixture.codexHome, relativePath);
  await mkdir(dirname(rolloutPath), { recursive: true });
  await writeFile(rolloutPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return rolloutPath;
};

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.stop()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("graph/tokens API routes", () => {
  it("serves a depth-limited graph from real temp SQLite edges and thread metadata", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "root-thread",
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/agentview",
          title: "Root graph task",
          tokensUsed: 1000,
        },
        {
          id: "child-open",
          createdAtMs: 1_100,
          updatedAtMs: 2_100,
          cwd: "/repo/agentview",
          title: "Open graph worker",
          tokensUsed: 200,
          agentNickname: "graph-api",
          agentRole: "implementation",
        },
        {
          id: "child-closed",
          createdAtMs: 1_200,
          updatedAtMs: 2_200,
          cwd: "/repo/agentview",
          firstUserMessage: "Closed worker prompt",
          preview: "Closed worker preview",
          tokensUsed: 300,
        },
        {
          id: "grandchild-failed",
          createdAtMs: 1_300,
          updatedAtMs: 2_300,
          cwd: "/repo/agentview",
          title: "Failed nested worker",
          tokensUsed: 50,
        },
      ],
      edges: [
        { parentThreadId: "root-thread", childThreadId: "child-open", status: "open" },
        { parentThreadId: "root-thread", childThreadId: "child-closed", status: "closed" },
        { parentThreadId: "child-open", childThreadId: "grandchild-failed", status: "failed" },
        { parentThreadId: "child-closed", childThreadId: "missing-child", status: "open" },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const depthOne = await requestJson(baseUrl, "/api/agent-graph?rootThreadId=root-thread&maxDepth=1");
      const depthTwo = await requestJson(baseUrl, "/api/agent-graph?rootThreadId=root-thread&maxDepth=2");

      expect(depthOne.status).toBe(200);
      expect(depthOne.body).toMatchObject({
        ok: true,
        source: "state-db",
        data: {
          root: { id: "root-thread", depth: 0, status: "complete" },
          nodes: [
            expect.objectContaining({ id: "root-thread", depth: 0 }),
            expect.objectContaining({ id: "child-open", depth: 1, status: "running", nickname: "graph-api" }),
            expect.objectContaining({ id: "child-closed", depth: 1, status: "complete" }),
          ],
          edges: [
            { parentId: "root-thread", childId: "child-open", status: "open" },
            { parentId: "root-thread", childId: "child-closed", status: "closed" },
          ],
          maxDepth: 1,
          truncatedDepth: true,
          openCount: 1,
          statusSummary: { open: 1, closed: 1, failed: 0 },
        },
        warnings: [],
      });

      expect(depthTwo.status).toBe(200);
      expect(depthTwo.body).toMatchObject({
        ok: true,
        source: "state-db",
        data: {
          nodes: expect.arrayContaining([
            expect.objectContaining({ id: "grandchild-failed", depth: 2, status: "failed" }),
            expect.objectContaining({
              id: "missing-child",
              title: "missing-child",
              depth: 2,
              status: "running",
              metadataMissing: true,
            }),
          ]),
          maxDepth: 2,
          truncatedDepth: false,
          openCount: 2,
          statusSummary: { open: 2, closed: 1, failed: 1 },
        },
      });
    });
  });

  it("returns a typed 404 when the graph root thread is absent", async () => {
    const fixture = await createCodexHomeFixture();

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/agent-graph?rootThreadId=missing-root");

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        ok: false,
        source: "state-db",
        error: {
          code: "THREAD_NOT_FOUND",
        },
      });
    });
  });

  it("reports missing state_5.sqlite as source unavailable for graph requests", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "agentview-missing-graph-"));
    const fixture: CodexHomeFixture = {
      codexHome,
      stateDbPath: join(codexHome, "state_5.sqlite"),
      cleanup: () => rm(codexHome, { recursive: true, force: true }),
    };

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/agent-graph?rootThreadId=root-thread");

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        ok: false,
        source: "state-db",
        error: {
          code: "STATE_DB_MISSING",
        },
      });
    });
  });

  it("serves selected-session token series from Phase 3 rollout cache facts", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-tokens",
          rolloutPath: "sessions/2026/thread-tokens.jsonl",
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/agentview",
          title: "Token source",
          model: "gpt-5-codex",
          tokensUsed: 590,
        },
      ],
    });
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-token-api-cache-"));
    tempRoots.push(cacheRoot);
    await createRolloutFile(fixture, "sessions/2026/thread-tokens.jsonl", [
      {
        timestamp: "2026-05-26T18:00:00.000Z",
        type: "token_count",
        total_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 20,
          output_tokens: 30,
          reasoning_output_tokens: 4,
          total_tokens: 130,
        },
        context_window: 1000,
        rate_limits: { primary_percent: 12 },
      },
      {
        timestamp: "2026-05-26T18:01:00.000Z",
        type: "token_count",
        total_token_usage: {
          input_tokens: 500,
          cached_input_tokens: 125,
          output_tokens: 90,
          reasoning_output_tokens: 25,
          total_tokens: 590,
        },
        context_window: 1200,
        rate_limits: {
          primary_percent: 57,
          secondary_percent: 9,
          reset_at: "2026-05-26T19:00:00.000Z",
        },
      },
    ]);

    await withApi(
      fixture,
      async ({ baseUrl }) => {
        const response = await requestJson(baseUrl, "/api/tokens?threadId=thread-tokens");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          ok: true,
          source: "rollout-cache",
          warnings: [],
          data: {
            snapshots: [
              expect.objectContaining({ total: 130, contextUtilization: 0.13, rateLimitPrimaryPercent: 12 }),
              expect.objectContaining({
                total: 590,
                contextUtilization: 590 / 1200,
                rateLimitPrimaryPercent: 57,
                rateLimitSecondaryPercent: 9,
                resetAt: "2026-05-26T19:00:00.000Z",
              }),
            ],
            totals: {
              input: 500,
              cachedInput: 125,
              output: 90,
              reasoningOutput: 25,
              total: 590,
            },
            cachedInputRatio: 0.25,
            latestContextUtilization: 590 / 1200,
            peakContextUtilization: 590 / 1200,
            rateLimitPrimaryPercent: 57,
            rateLimitSecondaryPercent: 9,
            resetAt: "2026-05-26T19:00:00.000Z",
            emptyStateReasons: [],
          },
        });
      },
      { AGENTVIEW_CACHE_ROOT: cacheRoot },
    );
  });

  it("returns token empty-state reasons from real rollout cache facts when token data is absent", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-no-tokens",
          rolloutPath: "sessions/2026/thread-no-tokens.jsonl",
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/agentview",
          title: "No token source",
          model: "gpt-5-codex",
        },
      ],
    });
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-token-api-cache-empty-"));
    tempRoots.push(cacheRoot);
    await createRolloutFile(fixture, "sessions/2026/thread-no-tokens.jsonl", [
      { timestamp: "2026-05-26T18:00:00.000Z", type: "message", role: "user", text: "No token events here" },
    ]);

    await withApi(
      fixture,
      async ({ baseUrl }) => {
        const response = await requestJson(baseUrl, "/api/tokens?threadId=thread-no-tokens");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          ok: true,
          source: "rollout-cache",
          data: {
            snapshots: [],
            totals: {
              input: 0,
              cachedInput: 0,
              output: 0,
              reasoningOutput: 0,
              total: 0,
            },
            emptyStateReasons: [
              "token-snapshots-missing",
              "cached-input-ratio-unavailable",
              "context-utilization-unavailable",
              "rate-limits-unavailable",
            ],
          },
        });
      },
      { AGENTVIEW_CACHE_ROOT: cacheRoot },
    );
  });
});
