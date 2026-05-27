import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCodexHomeFixture,
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
