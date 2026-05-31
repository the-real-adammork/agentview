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

const withApi = async <T>(fixture: CodexHomeFixture, run: (api: RunningApi) => Promise<T>) => {
  const api = await startApi({ codexHome: fixture.codexHome });

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

const ids = (body: unknown) => (body as { data: Array<{ id: string }> }).data.map((session) => session.id);

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.stop()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const dispatchFixture = () =>
  createCodexHomeFixture({
    threads: [
      {
        id: "root-thread",
        rolloutPath: "sessions/2026/root-thread.jsonl",
        createdAtMs: 1_000,
        updatedAtMs: 5_000,
        cwd: "/repo/agentview",
        title: "Dispatch root",
        model: "gpt-5-codex",
      },
      {
        id: "child-thread",
        createdAtMs: 1_500,
        updatedAtMs: 4_000,
        cwd: "/repo/agentview",
        title: "Dispatch child",
        threadSource: "subagent",
      },
    ],
    edges: [{ parentThreadId: "root-thread", childThreadId: "child-thread", status: "closed" }],
  });

describe("source dispatch (sourceId)", () => {
  it("GET /api/sessions with no sourceId returns the fixture Codex rows", async () => {
    const fixture = await dispatchFixture();
    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions?archived=exclude&limit=25");
      expect(response.status).toBe(200);
      expect(ids(response.body)).toEqual(["root-thread", "child-thread"]);
      expect((response.body as { data: Array<{ source: string }> }).data.every((s) => s.source === "codex")).toBe(true);
    });
  });

  it("GET /api/sessions?sourceId=codex returns the same rows", async () => {
    const fixture = await dispatchFixture();
    await withApi(fixture, async ({ baseUrl }) => {
      const merged = await requestJson(baseUrl, "/api/sessions?archived=exclude&limit=25");
      const codex = await requestJson(baseUrl, "/api/sessions?archived=exclude&limit=25&sourceId=codex");
      expect(codex.status).toBe(200);
      expect(ids(codex.body)).toEqual(ids(merged.body));
    });
  });

  it("GET /api/sessions?sourceId=claude-code returns a typed 400 for the unregistered source", async () => {
    const fixture = await dispatchFixture();
    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions?sourceId=claude-code");
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        ok: false,
        error: { code: "UNKNOWN_SOURCE" },
      });
    });
  });

  it("GET /api/sessions?sourceId=bogus returns a typed 400", async () => {
    const fixture = await dispatchFixture();
    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions?sourceId=bogus");
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        ok: false,
        error: { code: "UNKNOWN_SOURCE" },
      });
    });
  });

  it("GET /api/sessions/:id?sourceId=claude-code returns a typed 400 (composite key, unknown source)", async () => {
    const fixture = await dispatchFixture();
    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions/root-thread?sourceId=claude-code");
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ ok: false, error: { code: "UNKNOWN_SOURCE" } });
    });
  });

  it("GET /api/timeline?sourceId=codex returns the same timeline as without sourceId", async () => {
    const fixture = await dispatchFixture();
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-dispatch-cache-"));
    tempRoots.push(cacheRoot);
    await createRolloutFile(fixture, "sessions/2026/root-thread.jsonl", [
      { timestamp: "2026-05-26T18:20:00.000Z", type: "message", role: "user", text: "Render dispatch timeline" },
    ]);

    await withApi(fixture, async ({ baseUrl }) => {
      const plain = await requestJson(baseUrl, "/api/timeline?threadId=root-thread");
      const dispatched = await requestJson(baseUrl, "/api/timeline?threadId=root-thread&sourceId=codex");
      expect(plain.status).toBe(200);
      expect(dispatched.status).toBe(200);
      const plainEvents = (plain.body as { data: { events: unknown[] } }).data.events;
      const dispatchedEvents = (dispatched.body as { data: { events: unknown[] } }).data.events;
      expect(dispatchedEvents).toEqual(plainEvents);
    });
  });

  it("GET /api/timeline?sourceId=claude-code returns a typed 400", async () => {
    const fixture = await dispatchFixture();
    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/timeline?threadId=root-thread&sourceId=claude-code");
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ ok: false, error: { code: "UNKNOWN_SOURCE" } });
    });
  });

  it("GET /api/agent-graph edges report source: native", async () => {
    const fixture = await dispatchFixture();
    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/agent-graph?rootThreadId=root-thread");
      expect(response.status).toBe(200);
      const edges = (response.body as { data: { edges: Array<{ parentId: string; childId: string; source?: string }> } })
        .data.edges;
      const edge = edges.find((e) => e.parentId === "root-thread" && e.childId === "child-thread");
      expect(edge?.source).toBe("native");
    });
  });

  it("GET /api/health reports one entry per registered source (codex only this phase)", async () => {
    const fixture = await dispatchFixture();
    await withApi(fixture, async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/health");
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        data: { status: "ok", mode: "real" },
      });
    });
  });
});
