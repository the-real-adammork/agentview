import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCodexHomeFixture, type CodexHomeFixture } from "../fixtures/codexHome";

interface RunningApi {
  baseUrl: string;
  output(): string;
  stop(): Promise<void>;
}

interface JsonResponse {
  status: number;
  body: unknown;
}

const repoRoot = process.cwd();
const runningApis: RunningApi[] = [];

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

const startApi = async (codexHome: string): Promise<RunningApi> => {
  const port = await getFreePort();
  const output: string[] = [];
  const child = spawn("npm", ["run", "api"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENTVIEW_API_PORT: String(port),
      CODEX_HOME: codexHome,
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
    body: await response.json(),
  };
};

const withApi = async <T>(fixture: CodexHomeFixture, run: (api: RunningApi) => Promise<T>) => {
  const api = await startApi(fixture.codexHome);

  try {
    return await run(api);
  } finally {
    await api.stop();
    await fixture.cleanup();
  }
};

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.stop()));
});

describe("graph API routes", () => {
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
});
