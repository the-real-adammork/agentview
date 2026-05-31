import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
  const codexHome = await mkdtemp(join(tmpdir(), "agentview-cc-subtree-codex-"));
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

const ROOT_ID = "ccsub111-1111-4111-8111-111111111111";
const ROOT_CWD = "/repo/cc-subtree-app";

// Parent + two children whose timestamps interleave; one nested grandchild so the
// depth cap can be exercised. The reviewer's events fall between the parent's user
// (t=000) and assistant report (t=900); the writer's events fall after.
const ccSession = (): ClaudeSessionFixture => ({
  sessionId: ROOT_ID,
  cwd: ROOT_CWD,
  aiTitle: "CC subtree root",
  gitBranch: "main",
  model: "claude-opus-4",
  firstUserMessage: "Coordinate the subtree work",
  createdAtMs: 1_700_000_000_000,
  updatedAtMs: 1_700_000_900_000,
  assistantUsages: [{ input: 100, output: 50 }],
  subagents: [
    {
      agentId: "reviewer",
      agentType: "code-reviewer",
      description: "Review the diff",
      toolUseId: "toolu_review",
      firstUserMessage: "REVIEWER_CHILD_EVENT",
      finalReport: "Reviewed",
      createdAtMs: 1_700_000_200_000,
      updatedAtMs: 1_700_000_300_000,
    },
    {
      agentId: "writer",
      agentType: "test-writer",
      description: "Write tests",
      toolUseId: "toolu_write",
      firstUserMessage: "WRITER_CHILD_EVENT",
      finalReport: "Wrote tests",
      createdAtMs: 1_700_000_400_000,
      updatedAtMs: 1_700_000_500_000,
    },
  ],
});

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.stop()));
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("claude-code +SUBS subtree merge", () => {
  it("folds CC child agent events into the parent stream in timestamp order", async () => {
    const fixture = await createClaudeProjectsFixture({ sessions: [ccSession()] });
    fixtures.push(fixture);
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-cc-subtree-cache-"));
    tempRoots.push(cacheRoot);

    const api = await startApi({ CLAUDE_PROJECTS_DIR: fixture.projectsDir, AGENTVIEW_CACHE_ROOT: cacheRoot });
    try {
      const single = await requestJson(api.baseUrl, `/api/timeline?threadId=${ROOT_ID}&sourceId=claude-code`);
      const singleEvents = (single.body as { data: { events: Array<{ threadId: string }> } }).data.events;
      // Without subtree, only the parent thread's events are present.
      expect(singleEvents.every((event) => event.threadId === ROOT_ID)).toBe(true);

      const subtree = await requestJson(
        api.baseUrl,
        `/api/timeline?threadId=${ROOT_ID}&sourceId=claude-code&subtree=1`,
      );
      expect(subtree.status).toBe(200);
      const data = (subtree.body as {
        data: { threadId: string; events: Array<{ threadId: string; timestamp: string; previewText: string }> };
      }).data;

      // The payload identity stays the requested root.
      expect(data.threadId).toBe(ROOT_ID);
      // Both child agents' events are folded in.
      expect(data.events.some((event) => event.threadId === "agent-reviewer")).toBe(true);
      expect(data.events.some((event) => event.threadId === "agent-writer")).toBe(true);
      const reviewerEvent = data.events.find((event) => event.previewText.includes("REVIEWER_CHILD_EVENT"));
      const writerEvent = data.events.find((event) => event.previewText.includes("WRITER_CHILD_EVENT"));
      expect(reviewerEvent).toBeDefined();
      expect(writerEvent).toBeDefined();

      // The merged stream is sorted by timestamp ascending (then threadId, sourceLine).
      const timestamps = data.events.map((event) => Date.parse(event.timestamp));
      const sorted = [...timestamps].sort((left, right) => left - right);
      expect(timestamps).toEqual(sorted);
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });

  it("skips a missing/unreadable child without failing the request", async () => {
    // The root references two children; one transcript is deleted to simulate a
    // broken child. The +SUBS request must still succeed and fold the readable one.
    const session = ccSession();
    const fixture = await createClaudeProjectsFixture({ sessions: [session] });
    fixtures.push(fixture);
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-cc-subtree-cache-broken-"));
    tempRoots.push(cacheRoot);

    // Remove the writer transcript (leaving its meta sidecar) to break that child.
    const writerTranscript = join(
      fixture.projectsDir,
      "-repo-cc-subtree-app",
      ROOT_ID,
      "subagents",
      "agent-writer.jsonl",
    );
    await rm(writerTranscript, { force: true });

    const api = await startApi({ CLAUDE_PROJECTS_DIR: fixture.projectsDir, AGENTVIEW_CACHE_ROOT: cacheRoot });
    try {
      const subtree = await requestJson(
        api.baseUrl,
        `/api/timeline?threadId=${ROOT_ID}&sourceId=claude-code&subtree=1`,
      );
      expect(subtree.status).toBe(200);
      const data = (subtree.body as { data: { events: Array<{ threadId: string }> } }).data;
      // The readable reviewer child is still folded in; the request did not fail.
      expect(data.events.some((event) => event.threadId === "agent-reviewer")).toBe(true);
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });
});
