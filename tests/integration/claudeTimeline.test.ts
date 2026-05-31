import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { claudeLine, createClaudeProjectsFixture, type ClaudeProjectsFixture } from "../fixtures/claudeProjects";

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
  // A throwaway empty CODEX_HOME so the Codex source is registered but discovers
  // no sessions — these assertions exercise the CC path only.
  const codexHome = await mkdtemp(join(tmpdir(), "agentview-cc-timeline-codex-"));
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

const CC_SESSION_ID = "cc11cc11-cc11-4c11-8c11-cc11cc11cc11";
const CC_CWD = "/repo/cc-timeline-app";

const stamp = { sessionId: CC_SESSION_ID, cwd: CC_CWD };

const transcript = (): Array<Record<string, unknown>> => [
  claudeLine(
    {
      type: "user",
      uuid: "u1",
      parentUuid: null,
      timestamp: "2026-05-30T10:00:00.000Z",
      message: { role: "user", content: "Investigate the build. API_KEY=sk-cc-should-not-render" },
    },
    stamp,
  ),
  claudeLine({ type: "ai-title", aiTitle: "Investigate the build" }, stamp),
  claudeLine(
    {
      type: "assistant",
      uuid: "a1",
      parentUuid: "u1",
      timestamp: "2026-05-30T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Reading the file first.", signature: "sig-do-not-render" },
          { type: "text", text: "Reading the broken module." },
        ],
        usage: { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 40, cache_read_input_tokens: 600 },
      },
    },
    stamp,
  ),
  claudeLine(
    {
      type: "assistant",
      uuid: "a2",
      parentUuid: "a1",
      timestamp: "2026-05-30T10:00:02.000Z",
      message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_bash1", name: "Bash", input: { command: "git status --short" } }] },
    },
    stamp,
  ),
  claudeLine(
    {
      type: "user",
      uuid: "u2",
      parentUuid: "a2",
      timestamp: "2026-05-30T10:00:03.000Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_bash1", content: " M src/broken.ts" }] },
    },
    stamp,
  ),
  claudeLine(
    {
      type: "assistant",
      uuid: "a3",
      parentUuid: "u2",
      timestamp: "2026-05-30T10:00:04.000Z",
      message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_edit1", name: "Edit", input: { file_path: "/repo/cc-timeline-app/src/broken.ts", old_string: "import x from './x'", new_string: "import x from './x.js'" } }] },
    },
    stamp,
  ),
];

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.stop()));
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("claude-code timeline dispatch", () => {
  it("GET /api/timeline?sourceId=claude-code returns a CC TimelinePayload drawn through the existing renderers", async () => {
    const fixture = await createClaudeProjectsFixture({
      sessions: [
        {
          sessionId: CC_SESSION_ID,
          cwd: CC_CWD,
          createdAtMs: 1_700_000_000_000,
          updatedAtMs: 1_700_000_100_000,
          rawLines: transcript(),
        },
      ],
    });
    fixtures.push(fixture);
    const cacheRoot = await mkdtemp(join(tmpdir(), "agentview-cc-timeline-cache-"));
    tempRoots.push(cacheRoot);

    const api = await startApi({ CLAUDE_PROJECTS_DIR: fixture.projectsDir, AGENTVIEW_CACHE_ROOT: cacheRoot });
    try {
      const cold = await requestJson(api.baseUrl, `/api/timeline?threadId=${CC_SESSION_ID}&sourceId=claude-code`);
      expect(cold.status).toBe(200);
      expect(cold.body).toMatchObject({
        ok: true,
        data: {
          threadId: CC_SESSION_ID,
          events: expect.arrayContaining([
            expect.objectContaining({ kind: "user_message" }),
            expect.objectContaining({ kind: "reasoning" }),
            expect.objectContaining({ kind: "assistant_message" }),
            expect.objectContaining({ kind: "token_snapshot" }),
            expect.objectContaining({ kind: "tool_call", toolName: "Bash" }),
            expect.objectContaining({ kind: "tool_call", toolName: "Edit" }),
          ]),
        },
      });

      // The Bash result classifies through the exec renderer (git status → status),
      // and the Edit builds a diff render — both through the unchanged classifiers.
      const events = (cold.body as { data: { events: Array<Record<string, unknown>> } }).data.events;
      const bash = events.find((event) => event.kind === "tool_call" && event.toolName === "Bash");
      expect((bash?.outputRender as { kind?: string } | undefined)?.kind).toBe("status");
      const edit = events.find((event) => event.kind === "tool_call" && event.toolName === "Edit");
      expect((edit?.outputRender as { kind?: string } | undefined)?.kind).toBe("diff");

      // Redaction: the planted secret never escapes, and the thinking signature
      // never reaches the row.
      const serialized = JSON.stringify(cold.body);
      expect(serialized).toContain("[REDACTED]");
      expect(serialized).not.toContain("sk-cc-should-not-render");
      expect(serialized).not.toContain("sig-do-not-render");

      // Warm cache hit keyed by CLAUDE_PARSER_VERSION on the second request.
      const warm = await requestJson(api.baseUrl, `/api/timeline?threadId=${CC_SESSION_ID}&sourceId=claude-code`);
      expect(warm.status).toBe(200);
      expect((warm.body as { data: { cacheStatus: string } }).data.cacheStatus).toBe("warm");
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });

  it("GET /api/timeline?sourceId=claude-code 404s for an unknown CC session id", async () => {
    const fixture = await createClaudeProjectsFixture({ sessions: [] });
    fixtures.push(fixture);
    const api = await startApi({ CLAUDE_PROJECTS_DIR: fixture.projectsDir });
    try {
      const response = await requestJson(api.baseUrl, "/api/timeline?threadId=does-not-exist&sourceId=claude-code");
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ ok: false, error: { code: "THREAD_NOT_FOUND" } });
    } finally {
      await api.stop();
      await fixture.cleanup();
    }
  });
});
