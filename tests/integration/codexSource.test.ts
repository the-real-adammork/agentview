import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCodexHomeFixture,
  createUnsupportedCodexHomeFixture,
  type CodexHomeFixture,
} from "../fixtures/codexHome";
import { createCodexSource } from "../../src/backend/sources/codex/CodexSource";
import { openStateStore } from "../../src/backend/sqlite/stateStore";
import { getRolloutFactsWithCache } from "../../src/backend/cache/rolloutCache";
import { parseRolloutFile } from "../../src/backend/rollout/jsonlStream";
import { tailRolloutFile } from "../../src/backend/tail/liveTail";

const fixtures: CodexHomeFixture[] = [];
const tempRoots: string[] = [];

const trackFixture = async (fixture: CodexHomeFixture) => {
  fixtures.push(fixture);
  return fixture;
};

const createCacheRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentview-codex-source-cache-"));
  tempRoots.push(root);
  return root;
};

const writeRollout = async (codexHome: string, relativePath: string, lines: Array<Record<string, unknown>>) => {
  const rolloutPath = join(codexHome, relativePath);
  await mkdir(dirname(rolloutPath), { recursive: true });
  await writeFile(rolloutPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return rolloutPath;
};

const sampleLines = [
  { timestamp: "2026-05-26T18:20:00.000Z", type: "message", role: "user", text: "Render timeline" },
  {
    timestamp: "2026-05-26T18:20:01.000Z",
    type: "function_call",
    call_id: "call-1",
    name: "shell",
    arguments: JSON.stringify({ cmd: "echo hi" }),
  },
  {
    timestamp: "2026-05-26T18:20:02.000Z",
    type: "function_call_output",
    call_id: "call-1",
    output: "hi\nok",
    exit_code: 0,
  },
];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodexSource (delegating wrapper)", () => {
  describe("id", () => {
    it("identifies as codex", async () => {
      const fixture = await trackFixture(await createCodexHomeFixture());
      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        expect(source.id).toBe("codex");
      } finally {
        await source.close();
      }
    });
  });

  describe("getHealth", () => {
    it("maps a supported store to available with no detail", async () => {
      const fixture = await trackFixture(await createCodexHomeFixture());
      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        const health = await source.getHealth();
        expect(health).toEqual({ source: "codex", available: true });
        expect(health.detail).toBeUndefined();
      } finally {
        await source.close();
      }
    });

    it("maps an unsupported store to unavailable with a detail message", async () => {
      const fixture = await trackFixture(await createUnsupportedCodexHomeFixture());
      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        const health = await source.getHealth();
        expect(health.source).toBe("codex");
        expect(health.available).toBe(false);
        expect(typeof health.detail).toBe("string");
        expect(health.detail).toContain("Unsupported state_5.sqlite schema");
      } finally {
        await source.close();
      }
    });
  });

  describe("listSessions", () => {
    it("deep-equals the direct StateStore.listSessions for a representative filter and page", async () => {
      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [
            { id: "a", createdAtMs: 1_000, updatedAtMs: 4_000, cwd: "/repo", title: "Alpha match", tokensUsed: 50 },
            { id: "b", createdAtMs: 2_000, updatedAtMs: 3_000, cwd: "/repo", title: "Beta match", tokensUsed: 150 },
            {
              id: "c",
              createdAtMs: 2_500,
              updatedAtMs: 5_000,
              cwd: "/repo",
              title: "Gamma archived match",
              tokensUsed: 80,
              archived: true,
            },
          ],
        }),
      );
      const filter = { search: "match", archived: "include" as const, minTokens: 40, maxTokens: 200 };
      const page = { limit: 2, offset: 0 };

      const store = await openStateStore({ codexHome: fixture.codexHome });
      let expected;
      try {
        expected = await store.listSessions(filter, page);
      } finally {
        await store.close();
      }

      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        const actual = await source.listSessions(filter, page);
        expect(actual).toEqual(expected);
      } finally {
        await source.close();
      }
    });
  });

  describe("getSession", () => {
    it("deep-equals StateStore.getThread and returns null for a missing id", async () => {
      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [{ id: "only", createdAtMs: 1_000, updatedAtMs: 2_000, cwd: "/repo", title: "Only" }],
        }),
      );

      const store = await openStateStore({ codexHome: fixture.codexHome });
      let expected;
      try {
        expected = await store.getThread("only");
      } finally {
        await store.close();
      }

      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        expect(await source.getSession("only")).toEqual(expected);
        expect(await source.getSession("does-not-exist")).toBeNull();
      } finally {
        await source.close();
      }
    });
  });

  describe("resolveSession", () => {
    it("resolves an absolute rawLogPath under the codex home", async () => {
      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [
            {
              id: "resolvable",
              rolloutPath: "sessions/resolvable.jsonl",
              createdAtMs: 1_000,
              updatedAtMs: 2_000,
              cwd: "/repo",
            },
          ],
        }),
      );
      const rolloutPath = await writeRollout(fixture.codexHome, "sessions/resolvable.jsonl", sampleLines);

      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        const resolved = await source.resolveSession("resolvable");
        expect(resolved).toEqual({ source: "codex", sessionId: "resolvable", rawLogPath: rolloutPath });
      } finally {
        await source.close();
      }
    });

    it("rejects a rollout path that traverses outside the codex home", async () => {
      const outsideRoot = await mkdtemp(join(tmpdir(), "agentview-codex-source-outside-"));
      tempRoots.push(outsideRoot);
      await writeFile(join(outsideRoot, "outside.jsonl"), "{}\n");

      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [
            {
              id: "traversal",
              rolloutPath: `../${outsideRoot.split("/").at(-1)}/outside.jsonl`,
              createdAtMs: 1_000,
              updatedAtMs: 2_000,
              cwd: "/repo",
            },
          ],
        }),
      );

      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        await expect(source.resolveSession("traversal")).rejects.toMatchObject({
          name: "RolloutPathTraversalError",
        });
      } finally {
        await source.close();
      }
    });

    it("rejects a missing rollout file the way the handler does today", async () => {
      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [
            {
              id: "missing",
              rolloutPath: "sessions/missing.jsonl",
              createdAtMs: 1_000,
              updatedAtMs: 2_000,
              cwd: "/repo",
            },
          ],
        }),
      );

      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        await expect(source.resolveSession("missing")).rejects.toMatchObject({
          name: "RolloutNotFoundError",
        });
      } finally {
        await source.close();
      }
    });
  });

  describe("parse", () => {
    it("deep-equals getRolloutFactsWithCache(...).facts for the same rollout", async () => {
      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [
            {
              id: "parsable",
              rolloutPath: "sessions/parsable.jsonl",
              createdAtMs: 1_000,
              updatedAtMs: 2_000,
              cwd: "/repo",
            },
          ],
        }),
      );
      const rolloutPath = await writeRollout(fixture.codexHome, "sessions/parsable.jsonl", sampleLines);

      // Isolated cache root for the direct call.
      const directCacheRoot = await createCacheRoot();
      const previousCacheRoot = process.env.AGENTVIEW_CACHE_ROOT;
      process.env.AGENTVIEW_CACHE_ROOT = directCacheRoot;
      let expected;
      try {
        const direct = await getRolloutFactsWithCache({
          codexHome: fixture.codexHome,
          threadId: "parsable",
          rolloutPath,
          parse: (sourceMtimeMs, sourceSizeBytes) =>
            parseRolloutFile(rolloutPath, {
              threadId: "parsable",
              rolloutPath,
              sourceMtimeMs,
              sourceSizeBytes,
            }),
        });
        expected = direct.facts;
      } finally {
        if (previousCacheRoot === undefined) delete process.env.AGENTVIEW_CACHE_ROOT;
        else process.env.AGENTVIEW_CACHE_ROOT = previousCacheRoot;
      }

      // Isolated cache root for the source call.
      const sourceCacheRoot = await createCacheRoot();
      const beforeSourceCacheRoot = process.env.AGENTVIEW_CACHE_ROOT;
      process.env.AGENTVIEW_CACHE_ROOT = sourceCacheRoot;
      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        const resolved = await source.resolveSession("parsable");
        const facts = await source.parse(resolved);
        expect(facts).toEqual(expected);
      } finally {
        if (beforeSourceCacheRoot === undefined) delete process.env.AGENTVIEW_CACHE_ROOT;
        else process.env.AGENTVIEW_CACHE_ROOT = beforeSourceCacheRoot;
        await source.close();
      }
    });
  });

  describe("listChildren", () => {
    it("returns the unique non-root descendant sessions the timeline subtree branch computes", async () => {
      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [
            { id: "root", createdAtMs: 1_000, updatedAtMs: 5_000, cwd: "/repo", title: "Root" },
            { id: "child-1", createdAtMs: 2_000, updatedAtMs: 3_000, cwd: "/repo", title: "Child 1" },
            { id: "child-2", createdAtMs: 2_500, updatedAtMs: 3_500, cwd: "/repo", title: "Child 2" },
            { id: "grandchild", createdAtMs: 2_800, updatedAtMs: 3_800, cwd: "/repo", title: "Grandchild" },
          ],
          edges: [
            { parentThreadId: "root", childThreadId: "child-1", status: "closed" },
            { parentThreadId: "root", childThreadId: "child-2", status: "open" },
            { parentThreadId: "child-1", childThreadId: "grandchild", status: "closed" },
          ],
        }),
      );

      // Reproduce the timeline handler's descendant computation against the store.
      const store = await openStateStore({ codexHome: fixture.codexHome });
      let expected;
      try {
        const rows = await store.getAgentGraphRows("root", 10);
        const descendantIds = [
          ...new Set(rows.map((row) => row.childThreadId).filter((id): id is string => Boolean(id) && id !== "root")),
        ];
        const sessions = [];
        for (const id of descendantIds) {
          const session = await store.getThread(id);
          if (session) sessions.push(session);
        }
        expected = sessions;
      } finally {
        await store.close();
      }

      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        const children = await source.listChildren("root", 10);
        expect(children.map((child) => child.id)).toEqual(expected.map((session) => session.id));
        expect(children).toEqual(expected);
      } finally {
        await source.close();
      }
    });
  });

  describe("tail", () => {
    it("maps tailRolloutFile output to a SourceTailResult", async () => {
      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [
            {
              id: "tailable",
              rolloutPath: "sessions/tailable.jsonl",
              createdAtMs: 1_000,
              updatedAtMs: 2_000,
              cwd: "/repo",
            },
          ],
        }),
      );
      const rolloutPath = await writeRollout(fixture.codexHome, "sessions/tailable.jsonl", sampleLines);

      const cacheRoot = await createCacheRoot();
      const previousCacheRoot = process.env.AGENTVIEW_CACHE_ROOT;
      process.env.AGENTVIEW_CACHE_ROOT = cacheRoot;
      const source = createCodexSource({ codexHome: fixture.codexHome });
      try {
        const resolved = await source.resolveSession("tailable");
        const facts = await source.parse(resolved);
        const sourceLine = facts.events.length + 1;

        // Compute the byte offset after the first line, so tail reads the rest.
        const firstLineBytes = Buffer.byteLength(`${JSON.stringify(sampleLines[0])}\n`, "utf8");

        const direct = await tailRolloutFile({
          path: rolloutPath,
          threadId: "tailable",
          fromByte: firstLineBytes,
          sourceLine,
        });

        const result = await source.tail(resolved, firstLineBytes);
        expect(result.events).toEqual(direct.payload.events);
        expect(result.nextByte).toBe(direct.payload.nextByteOffset);
        expect(result.nextLine).toBe(sourceLine + direct.linesRead);
      } finally {
        if (previousCacheRoot === undefined) delete process.env.AGENTVIEW_CACHE_ROOT;
        else process.env.AGENTVIEW_CACHE_ROOT = previousCacheRoot;
        await source.close();
      }
    });
  });

  describe("close", () => {
    it("disposes the underlying store and reopens on a later call", async () => {
      const fixture = await trackFixture(
        await createCodexHomeFixture({
          threads: [{ id: "x", createdAtMs: 1_000, updatedAtMs: 2_000, cwd: "/repo", title: "X" }],
        }),
      );
      const before = await stat(fixture.stateDbPath);

      const source = createCodexSource({ codexHome: fixture.codexHome });
      await source.getHealth();
      await source.close();

      // After close, a fresh call still works (the wrapper lazily reopens) and the
      // DB file remains untouched (read-only).
      const health = await source.getHealth();
      expect(health.available).toBe(true);
      await source.close();

      const after = await stat(fixture.stateDbPath);
      expect(after.mtimeMs).toBe(before.mtimeMs);
    });
  });
});
