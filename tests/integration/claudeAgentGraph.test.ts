import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { deriveAgentGraph } from "../../src/backend/api/agentGraph";
import { createClaudeCodeSource, type ClaudeCodeSource } from "../../src/backend/sources/claudeCode/ClaudeCodeSource";
import {
  createClaudeProjectsFixture,
  type ClaudeProjectsFixture,
  type ClaudeSessionFixture,
} from "../fixtures/claudeProjects";

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
const tempRoots: string[] = [];
const fixtures: ClaudeProjectsFixture[] = [];

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

const startApi = async (env: Record<string, string>): Promise<RunningApi> => {
  const port = await getFreePort();
  // A throwaway empty CODEX_HOME so the Codex source is registered but discovers no
  // sessions — these assertions exercise the CC graph path only.
  const codexHome = await mkdtemp(join(tmpdir(), "agentview-cc-graph-codex-"));
  tempRoots.push(codexHome);

  const output: string[] = [];
  const child = spawn("npm", ["run", "api"], {
    cwd: repoRoot,
    env: { ...process.env, AGENTVIEW_API_PORT: String(port), CODEX_HOME: codexHome, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));

  const baseUrl = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    if (child.exitCode !== null) throw new Error(`API server exited before startup.\n${output.join("")}`);
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
  return { status: response.status, body: await response.json() };
};

const ROOT_ID = "ccgraph1-1111-4111-8111-111111111111";
const ROOT_CWD = "/repo/cc-graph-app";

const ccRootSession = (): ClaudeSessionFixture => ({
  sessionId: ROOT_ID,
  cwd: ROOT_CWD,
  aiTitle: "CC graph root",
  gitBranch: "main",
  model: "claude-opus-4",
  firstUserMessage: "Coordinate the CC graph work",
  createdAtMs: 1_700_000_000_000,
  updatedAtMs: 1_700_000_900_000,
  assistantUsages: [{ input: 100, output: 50 }],
  subagents: [
    {
      agentId: "reviewer",
      agentType: "code-reviewer",
      description: "Review the diff for correctness",
      toolUseId: "toolu_review",
      finalReport: "Reviewed: looks correct",
      assistantUsages: [{ input: 200, output: 80, cacheCreate: 20, cacheRead: 8 }],
      createdAtMs: 1_700_000_100_000,
      updatedAtMs: 1_700_000_200_000,
    },
    {
      agentId: "writer",
      agentType: "test-writer",
      description: "Write tests for the change",
      toolUseId: "toolu_write",
      finalReport: "Wrote 3 tests",
      assistantUsages: [{ input: 40, output: 12 }],
      createdAtMs: 1_700_000_300_000,
      updatedAtMs: 1_700_000_400_000,
    },
  ],
});

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.stop()));
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("claude-code agent graph", () => {
  it("getAgentGraphRows feeds deriveAgentGraph end-to-end (node per sub-agent, native edges)", async () => {
    const fixture = await createClaudeProjectsFixture({ sessions: [ccRootSession()] });
    fixtures.push(fixture);
    const source: ClaudeCodeSource = createClaudeCodeSource({ projectsDir: fixture.projectsDir });

    const rows = await source.getAgentGraphRows(ROOT_ID, 3);
    const graph = deriveAgentGraph(ROOT_ID, rows, { maxDepth: 2 });

    expect(graph.root.id).toBe(ROOT_ID);
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["agent-reviewer", "agent-writer", ROOT_ID]);

    const reviewerNode = graph.nodes.find((node) => node.id === "agent-reviewer");
    expect(reviewerNode).toMatchObject({
      role: "code-reviewer",
      nickname: "Review the diff for correctness",
      finalReportPreview: "Reviewed: looks correct",
    });

    for (const edge of graph.edges) {
      expect(edge.source).toBe("native");
      expect(edge.confidence).toBe("certain");
    }
  });

  it("GET /api/agent-graph?sourceId=claude-code returns 200 with native edges; Codex default still works", async () => {
    const fixture = await createClaudeProjectsFixture({ sessions: [ccRootSession()] });
    fixtures.push(fixture);

    const api = await startApi({ CLAUDE_PROJECTS_DIR: fixture.projectsDir });
    try {
      const response = await requestJson(
        api.baseUrl,
        `/api/agent-graph?sourceId=claude-code&rootThreadId=${ROOT_ID}&maxDepth=2`,
      );
      expect(response.status).toBe(200);

      const data = (response.body as { data: { root: { id: string }; nodes: Array<{ id: string }>; edges: Array<{ source?: string }> } }).data;
      expect(data.root.id).toBe(ROOT_ID);
      expect(data.nodes.map((node) => node.id).sort()).toEqual(["agent-reviewer", "agent-writer", ROOT_ID]);
      expect(data.edges.length).toBe(2);
      for (const edge of data.edges) {
        expect(edge.source).toBe("native");
      }

      const sourceLess = await requestJson(api.baseUrl, `/api/agent-graph?rootThreadId=${ROOT_ID}&maxDepth=2`);
      expect(sourceLess.status).toBe(200);
      expect((sourceLess.body as { data: { root: { id: string } } }).data.root.id).toBe(ROOT_ID);

      // Unknown ids now resolve across sources and report a normal not-found when
      // no registered source owns the session id.
      const codex = await requestJson(api.baseUrl, "/api/agent-graph?rootThreadId=missing-codex-root");
      expect(codex.status).toBe(404);
      expect(codex.body).toMatchObject({ ok: false, error: { code: "THREAD_NOT_FOUND" } });
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });
});
