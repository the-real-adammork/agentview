import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCodexHomeFixture,
  observedEventMsg,
  observedResponseItem,
  type CodexHomeFixture,
} from "../fixtures/codexHome";

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

describe("timeline API", () => {
  it("serves selected-session timeline payloads from the rollout parser and derived cache", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-timeline",
          rolloutPath: "sessions/2026/thread-timeline.jsonl",
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/agentview",
          title: "Timeline source",
          model: "gpt-5-codex",
        },
      ],
    });
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-api-cache-"));
    tempRoots.push(cacheRoot);
    await createRolloutFile(fixture, "sessions/2026/thread-timeline.jsonl", [
      { timestamp: "2026-05-26T18:20:00.000Z", type: "message", role: "user", text: "Render timeline" },
      {
        timestamp: "2026-05-26T18:20:01.000Z",
        type: "function_call",
        call_id: "call-1",
        name: "shell",
        arguments: JSON.stringify({ cmd: "printf SECRET_TOKEN=should-not-render" }),
      },
      {
        timestamp: "2026-05-26T18:20:02.000Z",
        type: "function_call_output",
        call_id: "call-1",
        output: "SECRET_TOKEN=should-not-render\nok",
        exit_code: 0,
      },
      {
        timestamp: "2026-05-26T18:20:03.000Z",
        type: "token_count",
        total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, total_tokens: 130 },
      },
    ]);

    await withApi(
      fixture,
      async ({ baseUrl }) => {
        const cold = await requestJson(baseUrl, "/api/timeline?threadId=thread-timeline");
        const warm = await requestJson(baseUrl, "/api/timeline?threadId=thread-timeline");

        expect(cold.status).toBe(200);
        expect(cold.body).toMatchObject({
          ok: true,
          source: "rollout-cache",
          warnings: [],
          data: {
            threadId: "thread-timeline",
            cacheStatus: "cold",
            nextByteOffset: expect.any(Number),
            events: expect.arrayContaining([
              expect.objectContaining({ kind: "user_message", previewText: "Render timeline" }),
              expect.objectContaining({
                kind: "tool_result",
                callId: "call-1",
                outputPreview: expect.stringContaining("SECRET_TOKEN=[REDACTED]"),
              }),
              expect.objectContaining({ kind: "token_snapshot" }),
            ]),
          },
        });
        expect(JSON.stringify(cold.body)).not.toContain("should-not-render");
        expect(warm.status).toBe(200);
        expect(warm.body).toMatchObject({
          ok: true,
          source: "rollout-cache",
          data: {
            threadId: "thread-timeline",
            cacheStatus: "warm",
          },
        });
      },
      { AGENTVIEW_CACHE_ROOT: cacheRoot },
    );
  });

  it("serves observed envelope events with joined tool, token, turn, and agent facts", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-observed-api",
          rolloutPath: "sessions/2026/thread-observed-api.jsonl",
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/agentview",
          title: "Observed timeline source",
          model: "gpt-5-codex",
        },
      ],
    });
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-observed-api-cache-"));
    tempRoots.push(cacheRoot);
    await createRolloutFile(fixture, "sessions/2026/thread-observed-api.jsonl", [
      observedEventMsg({
        timestamp: "2026-05-27T14:20:00.000Z",
        turnId: "turn-api-1",
        payload: { type: "task_started", task: "Serve observed timeline" },
      }),
      observedEventMsg({
        timestamp: "2026-05-27T14:20:01.000Z",
        turnId: "turn-api-1",
        payload: {
          type: "message",
          message: {
            role: "user",
            content: [{ type: "input_text", text: "Open the observed timeline." }],
          },
        },
      }),
      observedResponseItem({
        timestamp: "2026-05-27T14:20:02.000Z",
        turnId: "turn-api-1",
        payload: {
          type: "function_call",
          call_id: "call-api-1",
          name: "shell",
          arguments: JSON.stringify({ cmd: "npm run observed" }),
        },
      }),
      observedEventMsg({
        timestamp: "2026-05-27T14:20:06.000Z",
        turnId: "turn-api-1",
        payload: {
          type: "function_call_output",
          call_id: "call-api-1",
          output: JSON.stringify({ exit_code: 2, duration_ms: 4000, output: "observed failed output" }),
        },
      }),
      observedEventMsg({
        timestamp: "2026-05-27T14:20:07.000Z",
        turnId: "turn-api-1",
        payload: {
          type: "token_count",
          last_token_usage: { input_tokens: 8, output_tokens: 5 },
          total_token_usage: { input_tokens: 80, cached_input_tokens: 20, output_tokens: 30, total_tokens: 110 },
          model_context_window: 200000,
          plan_type: "pro",
        },
      }),
      observedResponseItem({
        timestamp: "2026-05-27T14:20:08.000Z",
        turnId: "turn-api-1",
        payload: {
          type: "spawn_agent",
          call_id: "call-api-spawn",
          child_thread_id: "thread-api-child",
          agent_nickname: "api-child",
          agent_role: "test worker",
          task: "Verify API payload.",
        },
      }),
      observedEventMsg({
        timestamp: "2026-05-27T14:20:09.000Z",
        turnId: "turn-api-1",
        payload: {
          type: "wait_agent",
          call_id: "call-api-spawn",
          child_thread_id: "thread-api-child",
          status: "closed",
          last_agent_message: "API payload checked.",
        },
      }),
      observedEventMsg({
        timestamp: "2026-05-27T14:20:10.000Z",
        turnId: "turn-api-1",
        payload: { type: "task_complete", last_agent_message: "Observed timeline served." },
      }),
    ]);

    await withApi(
      fixture,
      async ({ baseUrl }) => {
        const response = await requestJson(baseUrl, "/api/timeline?threadId=thread-observed-api");

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          ok: true,
          source: "rollout-cache",
          warnings: [],
          data: {
            threadId: "thread-observed-api",
            events: expect.arrayContaining([
              expect.objectContaining({ kind: "task_started", previewText: "Serve observed timeline" }),
              expect.objectContaining({ kind: "user_message", previewText: "Open the observed timeline." }),
              expect.objectContaining({
                kind: "tool_call",
                callId: "call-api-1",
                commandPreview: "npm run observed",
                joinedExitCode: 2,
                joinedDurationMs: 4000,
                joinedOutputPreview: expect.stringContaining("observed failed output"),
              }),
              expect.objectContaining({
                kind: "token_snapshot",
                tokenSnapshot: expect.objectContaining({
                  lastInput: 8,
                  lastOutput: 5,
                  modelContextWindow: 200000,
                  planType: "pro",
                }),
              }),
              expect.objectContaining({
                kind: "agent_launch",
                childThreadId: "thread-api-child",
                agentNickname: "api-child",
                agentRole: "test worker",
                agentTaskPreview: "Verify API payload.",
              }),
            ]),
            facts: expect.objectContaining({
              turns: [
                expect.objectContaining({
                  turnId: "turn-api-1",
                  lastAgentMessagePreview: "Observed timeline served.",
                }),
              ],
              summary: expect.objectContaining({
                failedToolCallCount: 1,
                tokenSnapshotCount: 1,
                agentLaunchCount: 1,
                agentWaitCount: 1,
              }),
            }),
          },
        });
      },
      { AGENTVIEW_CACHE_ROOT: cacheRoot },
    );
  });

  it("merges the spawn subtree into one server-side stream when subtree=1 is requested", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "parent-thread",
          rolloutPath: "sessions/2026/parent.jsonl",
          createdAtMs: 1_000,
          updatedAtMs: 5_000,
          cwd: "/repo/agentview",
          title: "Parent",
        },
        {
          id: "child-thread",
          rolloutPath: "sessions/2026/child.jsonl",
          createdAtMs: 2_000,
          updatedAtMs: 4_000,
          cwd: "/repo/agentview",
          title: "Child",
        },
      ],
      edges: [{ parentThreadId: "parent-thread", childThreadId: "child-thread", status: "closed" }],
    });
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-subtree-cache-"));
    tempRoots.push(cacheRoot);
    await createRolloutFile(fixture, "sessions/2026/parent.jsonl", [
      { timestamp: "2026-05-26T18:00:00.000Z", type: "message", role: "user", text: "Parent task" },
      { timestamp: "2026-05-26T18:00:10.000Z", type: "message", role: "assistant", text: "Parent reply" },
    ]);
    await createRolloutFile(fixture, "sessions/2026/child.jsonl", [
      { timestamp: "2026-05-26T18:00:05.000Z", type: "message", role: "assistant", text: "Child sub-agent reply" },
    ]);

    await withApi(
      fixture,
      async ({ baseUrl }) => {
        const single = await requestJson(baseUrl, "/api/timeline?threadId=parent-thread");
        const subtree = await requestJson(baseUrl, "/api/timeline?threadId=parent-thread&subtree=1");

        // Without subtree, only the parent thread's events are returned.
        const singleEvents = (single.body as { data: { events: { threadId: string }[] } }).data.events;
        expect(singleEvents.every((event) => event.threadId === "parent-thread")).toBe(true);

        // With subtree, the server merges parent + child into one time-ordered stream
        // while keeping the requested thread as the payload identity (for vitals).
        const data = (subtree.body as {
          data: { threadId: string; events: { threadId: string; previewText: string }[] };
        }).data;
        expect(subtree.status).toBe(200);
        expect(data.threadId).toBe("parent-thread");
        expect(data.events.some((event) => event.threadId === "child-thread")).toBe(true);
        expect(data.events.map((event) => event.previewText)).toEqual([
          "Parent task",
          "Child sub-agent reply",
          "Parent reply",
        ]);
      },
      { AGENTVIEW_CACHE_ROOT: cacheRoot },
    );
  });

  it("returns a typed missing-rollout error when the selected thread has no readable rollout file", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-missing-rollout",
          rolloutPath: "sessions/missing.jsonl",
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/agentview",
          title: "Missing rollout",
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/timeline?threadId=thread-missing-rollout");

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        ok: false,
        source: "rollout-cache",
        error: {
          code: "ROLLOUT_NOT_FOUND",
          message: expect.stringContaining("thread-missing-rollout"),
        },
      });
    });
  });

  it("rejects traversal rollout paths before reading files outside CODEX_HOME", async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), "agentview-outside-rollout-"));
    tempRoots.push(outsideRoot);
    const outsideRolloutPath = join(outsideRoot, "outside.jsonl");
    await writeFile(
      outsideRolloutPath,
      `${JSON.stringify({ timestamp: "2026-05-26T18:30:00.000Z", type: "message", role: "user", text: "Outside" })}\n`,
    );
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-traversal",
          rolloutPath: `../${outsideRoot.split("/").at(-1)}/outside.jsonl`,
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/agentview",
          title: "Traversal attempt",
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/timeline?threadId=thread-traversal");

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        ok: false,
        source: "rollout-cache",
        error: {
          code: "ROLLOUT_PATH_TRAVERSAL",
          message: expect.stringContaining("thread-traversal"),
        },
      });
      await expect(readFile(outsideRolloutPath, "utf8")).resolves.toContain("Outside");
    });
  });
});
