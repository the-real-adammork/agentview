import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createCodexHomeFixture, type CodexHomeFixture } from "../fixtures/codexHome";
import {
  createClaudeProjectsFixture,
  defaultClaudeSessions,
  type ClaudeProjectsFixture,
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
  claudeProjectsDir,
}: {
  codexHome: string;
  claudeProjectsDir: string;
}): Promise<RunningApi> => {
  const port = await getFreePort();
  const output: string[] = [];
  const child = spawn("npm", ["run", "api"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENTVIEW_API_PORT: String(port),
      CODEX_HOME: codexHome,
      CLAUDE_PROJECTS_DIR: claudeProjectsDir,
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
  return { status: response.status, body: await response.json() };
};

const rows = (body: unknown) =>
  (body as { data: Array<{ id: string; source: string; updatedAtMs?: number }> }).data;

afterEach(async () => {
  await Promise.all(runningApis.splice(0).map((api) => api.stop()));
});

const PLAIN_ID = "11111111-1111-4111-8111-111111111111";
const SUBAGENT_ID = "22222222-2222-4222-8222-222222222222";

const withBothSources = async <T>(run: (api: RunningApi) => Promise<T>) => {
  // Interleave Codex + CC by updatedAtMs so the merged ordering is observable.
  const codexFixture: CodexHomeFixture = await createCodexHomeFixture({
    threads: [
      {
        id: "codex-older",
        createdAtMs: 1_700_000_000_000,
        updatedAtMs: 1_700_000_050_000, // older than CC plain
        cwd: "/repo/codex-app",
        title: "Codex older session",
        model: "gpt-5-codex",
        tokensUsed: 10_000,
      },
      {
        id: "codex-newest",
        createdAtMs: 1_700_000_400_000,
        updatedAtMs: 1_700_000_400_000, // newest overall
        cwd: "/repo/codex-app",
        title: "Codex newest session",
        model: "gpt-5-codex",
        tokensUsed: 20_000,
      },
    ],
  });
  const claudeFixture: ClaudeProjectsFixture = await createClaudeProjectsFixture({ sessions: defaultClaudeSessions });

  const api = await startApi({ codexHome: codexFixture.codexHome, claudeProjectsDir: claudeFixture.projectsDir });
  try {
    return await run(api);
  } finally {
    await api.stop();
    await codexFixture.cleanup();
    await claudeFixture.cleanup();
  }
};

describe("merged sessions (codex + claude-code)", () => {
  it("GET /api/sessions with no sourceId interleaves both sources sorted by updatedAtMs desc", async () => {
    await withBothSources(async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions?archived=exclude&limit=25");
      expect(response.status).toBe(200);

      const data = rows(response.body);
      const sources = new Set(data.map((row) => row.source));
      expect(sources.has("codex")).toBe(true);
      expect(sources.has("claude-code")).toBe(true);

      // updatedAtMs descending across sources.
      const updatedAtMs = data.map((row) => row.updatedAtMs ?? 0);
      const sorted = [...updatedAtMs].sort((left, right) => right - left);
      expect(updatedAtMs).toEqual(sorted);

      // The exact interleave by updatedAtMs (codex-newest > CC subagent > CC plain > codex-older).
      expect(data.map((row) => row.id)).toEqual(["codex-newest", SUBAGENT_ID, PLAIN_ID, "codex-older"]);
    });
  });

  it("GET /api/sessions?sourceId=claude-code returns only CC rows", async () => {
    await withBothSources(async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions?sourceId=claude-code&limit=25");
      expect(response.status).toBe(200);
      const data = rows(response.body);
      expect(data.length).toBe(2);
      expect(data.every((row) => row.source === "claude-code")).toBe(true);
      expect(data.map((row) => row.id).sort()).toEqual([PLAIN_ID, SUBAGENT_ID].sort());
    });
  });

  it("GET /api/sessions?sourceId=codex returns only Codex rows", async () => {
    await withBothSources(async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions?sourceId=codex&limit=25");
      expect(response.status).toBe(200);
      const data = rows(response.body);
      expect(data.every((row) => row.source === "codex")).toBe(true);
      expect(data.map((row) => row.id).sort()).toEqual(["codex-newest", "codex-older"]);
    });
  });

  it("GET /api/health reports both sources with available:true", async () => {
    await withBothSources(async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/health");
      expect(response.status).toBe(200);
      const sources = (response.body as { data: { sources: Array<{ source: string; available: boolean }> } }).data
        .sources;
      const bySource = new Map(sources.map((entry) => [entry.source, entry]));
      expect(bySource.get("codex")).toMatchObject({ available: true });
      expect(bySource.get("claude-code")).toMatchObject({ available: true });
    });
  });

  it("a CC row carries the derived title, summed tokens, and childCount", async () => {
    await withBothSources(async ({ baseUrl }) => {
      const response = await requestJson(baseUrl, "/api/sessions?sourceId=claude-code&limit=25");
      const data = rows(response.body) as Array<{
        id: string;
        title: string;
        tokenTotal: number;
        childCount: number;
      }>;
      const subagent = data.find((row) => row.id === SUBAGENT_ID);
      expect(subagent).toMatchObject({
        title: "Subagent CC session title",
        tokenTotal: 200 + 80 + 20 + 8 + 40 + 12,
        childCount: 2,
      });
    });
  });
});
