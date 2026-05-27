import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCodexHomeFixture,
  createUnsupportedCodexHomeFixture,
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

const requestJson = async (baseUrl: string, path: string, init?: RequestInit): Promise<JsonResponse> => {
  const response = await fetch(`${baseUrl}${path}`, init);
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  };
};

const createJsonlReadTrapPreloader = async (directory: string) => {
  const preloaderPath = join(directory, "jsonl-read-trap.mjs");
  await writeFile(
    preloaderPath,
    `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";

      const logPath = process.env.AGENTVIEW_JSONL_READ_TRAP_LOG;

      const pathText = (value) => {
        if (typeof value === "string") return value;
        if (value instanceof URL) return value.pathname;
        if (Buffer.isBuffer(value)) return value.toString("utf8");
        return value?.toString?.() ?? "";
      };

      const recordJsonlRead = (value) => {
        const text = pathText(value);
        if (!text.includes(".jsonl")) return;
        if (logPath) fs.appendFileSync(logPath, text + "\\n");
        throw new Error("sessions first paint attempted to read rollout JSONL: " + text);
      };

      const readFileSync = fs.readFileSync;
      fs.readFileSync = function patchedReadFileSync(path, ...args) {
        recordJsonlRead(path);
        return readFileSync.call(this, path, ...args);
      };

      const readFile = fs.readFile;
      fs.readFile = function patchedReadFile(path, ...args) {
        recordJsonlRead(path);
        return readFile.call(this, path, ...args);
      };

      const createReadStream = fs.createReadStream;
      fs.createReadStream = function patchedCreateReadStream(path, ...args) {
        recordJsonlRead(path);
        return createReadStream.call(this, path, ...args);
      };

      const openSync = fs.openSync;
      fs.openSync = function patchedOpenSync(path, ...args) {
        recordJsonlRead(path);
        return openSync.call(this, path, ...args);
      };

      const open = fs.open;
      fs.open = function patchedOpen(path, ...args) {
        recordJsonlRead(path);
        return open.call(this, path, ...args);
      };

      const promiseReadFile = fs.promises.readFile;
      fs.promises.readFile = async function patchedPromiseReadFile(path, ...args) {
        recordJsonlRead(path);
        return promiseReadFile.call(this, path, ...args);
      };

      const promiseOpen = fs.promises.open;
      fs.promises.open = async function patchedPromiseOpen(path, ...args) {
        recordJsonlRead(path);
        return promiseOpen.call(this, path, ...args);
      };

      syncBuiltinESMExports();
    `,
  );

  return preloaderPath;
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

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.stop()));
});

describe("sessions API routes", () => {
  it("reports real state-db health and schema availability through an ApiResult envelope", async () => {
    const fixture = await createCodexHomeFixture();

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/health");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        source: "state-db",
        data: {
          status: "ok",
          mode: "real",
          stateDb: {
            readOnly: true,
            supported: true,
            tables: expect.arrayContaining(["threads", "thread_spawn_edges"]),
          },
        },
        warnings: [],
      });
      expect(new Date((response.body as { data: { checkedAt: string } }).data.checkedAt).toString()).not.toBe(
        "Invalid Date",
      );
    });
  });

  it("lists sessions from state_5.sqlite sorted by updated_at_ms without reading rollout JSONL on first paint", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-parent",
          rolloutPath: "sessions/2026/parent.jsonl",
          createdAtMs: 1_800_000,
          updatedAtMs: 2_000_000,
          cwd: "/worktrees/agentview",
          title: "Parent title",
          firstUserMessage: "First parent prompt",
          preview: "Parent preview",
          model: "gpt-5-codex",
          reasoningEffort: "high",
          tokensUsed: 42_000,
          gitBranch: "impl/phase-2",
          gitOriginUrl: "https://github.com/example/agentview.git",
          threadSource: "user",
        },
        {
          id: "thread-child-open",
          createdAtMs: 1_850_000,
          updatedAtMs: 2_100_000,
          cwd: "/worktrees/agentview",
          firstUserMessage: "Investigate backend state store",
          preview: "Child preview fallback",
          model: "gpt-5-codex",
          tokensUsed: 12_500,
          threadSource: "subagent",
          agentNickname: "backend-state",
          agentRole: "implementation",
        },
        {
          id: "thread-archived",
          createdAtMs: 1_700_000,
          updatedAtMs: 2_200_000,
          cwd: "/worktrees/agentview",
          title: "Archived row",
          archived: true,
          model: "gpt-5-codex-mini",
          tokensUsed: 100,
        },
      ],
      edges: [
        {
          parentThreadId: "thread-parent",
          childThreadId: "thread-child-open",
          status: "open",
        },
        {
          parentThreadId: "thread-parent",
          childThreadId: "thread-child-closed",
          status: "closed",
        },
      ],
    });
    const rolloutPath = join(fixture.codexHome, "sessions", "2026", "parent.jsonl");
    await mkdir(dirname(rolloutPath), { recursive: true });
    await writeFile(rolloutPath, "{ this is intentionally invalid jsonl and must not be parsed on list }\n");

    const trapDir = await mkdtemp(join(tmpdir(), "agentview-jsonl-trap-"));
    const trapLogPath = join(trapDir, "jsonl-reads.log");
    const trapPreloaderPath = await createJsonlReadTrapPreloader(trapDir);

    try {
      await withApi(
        fixture,
        async ({ baseUrl }) => {
          const response = await requestJson(baseUrl, "/api/sessions?archived=exclude&limit=25");

          expect(response.status).toBe(200);
          expect(response.body).toMatchObject({
            ok: true,
            source: "state-db",
            data: [
              expect.objectContaining({
                id: "thread-child-open",
                titlePreview: "Investigate backend state store",
                childCount: 0,
                openChildCount: 0,
                warningCountStatus: "not_requested",
                failedToolCountStatus: "unknown",
              }),
              expect.objectContaining({
                id: "thread-parent",
                titlePreview: "Parent title",
                childCount: 2,
                openChildCount: 1,
                gitOriginUrlPreview: "github.com/example/agentview.git",
              }),
            ],
            warnings: [],
          });
          expect((response.body as { data: Array<{ id: string }> }).data.map((session) => session.id)).toEqual([
            "thread-child-open",
            "thread-parent",
          ]);

          await expect(readFile(trapLogPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        },
        {
          AGENTVIEW_JSONL_READ_TRAP_LOG: trapLogPath,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${trapPreloaderPath}`.trim(),
        },
      );
    } finally {
      await rm(trapDir, { recursive: true, force: true });
    }
  });

  it("composes list filters for search, cwd, source, role, model, archive state, token floor, and badge status", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-user-backend",
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/a",
          title: "Backend user work",
          firstUserMessage: "Inspect backend",
          model: "gpt-5-codex",
          tokensUsed: 75_000,
          threadSource: "user",
        },
        {
          id: "thread-target-subagent",
          createdAtMs: 2_000,
          updatedAtMs: 3_000,
          cwd: "/repo/a",
          title: "",
          firstUserMessage: "Backend sessions API",
          model: "gpt-5-codex",
          tokensUsed: 25_000,
          threadSource: "subagent",
          agentRole: "implementation",
        },
        {
          id: "thread-wrong-model",
          createdAtMs: 3_000,
          updatedAtMs: 4_000,
          cwd: "/repo/a",
          title: "Backend sessions API",
          model: "gpt-5-codex-mini",
          tokensUsed: 25_000,
          threadSource: "subagent",
          agentRole: "implementation",
        },
        {
          id: "thread-archived-target",
          createdAtMs: 4_000,
          updatedAtMs: 5_000,
          cwd: "/repo/a",
          title: "Backend sessions API",
          model: "gpt-5-codex",
          tokensUsed: 25_000,
          threadSource: "subagent",
          agentRole: "implementation",
          archived: true,
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(
        baseUrl,
        "/api/sessions?search=backend&cwd=%2Frepo%2Fa&source=subagent&role=implementation&model=gpt-5-codex&archived=exclude&minTokens=10000&warningStatus=not_requested&failedToolStatus=unknown&limit=10&offset=0",
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        source: "state-db",
        data: [
          expect.objectContaining({
            id: "thread-target-subagent",
            threadSource: "subagent",
            agentRole: "implementation",
            model: "gpt-5-codex",
            tokensUsed: 25_000,
            archived: false,
          }),
        ],
      });
      expect((response.body as { data: Array<{ id: string }> }).data.map((session) => session.id)).toEqual([
        "thread-target-subagent",
      ]);
    });
  });

  it("returns one session by thread id and 404 for unknown thread ids", async () => {
    const fixture = await createCodexHomeFixture({
      threads: [
        {
          id: "thread-lookup-target",
          createdAtMs: 1_000,
          updatedAtMs: 2_000,
          cwd: "/repo/lookup",
          title: "Lookup target",
          model: "gpt-5-codex",
        },
      ],
    });

    await withApi(fixture, async ({ baseUrl }) => {
      const found = await requestJson(baseUrl, "/api/sessions/thread-lookup-target");
      const missing = await requestJson(baseUrl, "/api/sessions/not-present");

      expect(found.status).toBe(200);
      expect(found.body).toMatchObject({
        ok: true,
        source: "state-db",
        data: expect.objectContaining({
          id: "thread-lookup-target",
          titlePreview: "Lookup target",
          cwd: "/repo/lookup",
        }),
      });

      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({
        ok: false,
        source: "state-db",
        error: {
          code: "THREAD_NOT_FOUND",
        },
      });
    });
  });

  it("rejects unsupported state_5.sqlite schemas with a typed error envelope", async () => {
    const fixture = await createUnsupportedCodexHomeFixture();

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions");

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        ok: false,
        source: "state-db",
        error: {
          code: "SCHEMA_UNSUPPORTED",
          detail: expect.stringContaining("threads.rollout_path"),
        },
      });
    });
  });

  it("reports missing state_5.sqlite as source unavailable instead of falling back to fixture sessions", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "agentview-missing-state-"));
    const fixture: CodexHomeFixture = {
      codexHome,
      stateDbPath: join(codexHome, "state_5.sqlite"),
      cleanup: () => rm(codexHome, { recursive: true, force: true }),
    };

    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions");

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

  it("rejects invalid list filters before querying the state store", async () => {
    const fixture = await createCodexHomeFixture();

    await withApi(fixture, async ({ baseUrl }) => {
      const cases = [
        "/api/sessions?archived=deleted",
        "/api/sessions?source=daemon",
        "/api/sessions?minTokens=-1",
        "/api/sessions?limit=0",
        "/api/sessions?offset=-1",
      ];

      for (const path of cases) {
        const response = await requestJson(baseUrl, path);

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
          ok: false,
          source: "state-db",
          error: {
            code: "INVALID_FILTER",
          },
        });
      }
    });
  });

  it("keeps API access local-only through loopback CORS allowlisting", async () => {
    const fixture = await createCodexHomeFixture();

    await withApi(fixture, async ({ baseUrl }) => {
      const loopback = await requestJson(baseUrl, "/api/health", {
        headers: {
          Origin: "http://localhost:5173",
        },
      });
      const remote = await requestJson(baseUrl, "/api/health", {
        headers: {
          Origin: "https://dashboard.example.test",
        },
      });

      expect(loopback.status).toBe(200);
      expect(loopback.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
      expect(remote.status).toBe(200);
      expect(remote.headers.get("access-control-allow-origin")).toBeNull();
    });
  });
});
