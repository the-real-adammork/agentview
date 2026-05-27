import { afterEach, describe, expect, it } from "vitest";

import { resolveCodexSourcePath } from "../../src/backend/codexPaths";
import { createCodexHomeFixture } from "../fixtures/codexHome";
import { requestJson, stopRunningApis, withApi } from "../helpers/apiServer";

describe("source safety and partial error envelopes", () => {
  afterEach(async () => {
    await stopRunningApis();
  });

  it("rejects relative traversal and absolute Codex source paths", async () => {
    const fixture = await createCodexHomeFixture();

    try {
      await expect(resolveCodexSourcePath(fixture.codexHome, "../outside.jsonl")).rejects.toMatchObject({
        code: "CODEX_PATH_TRAVERSAL",
      });
      await expect(resolveCodexSourcePath(fixture.codexHome, "/tmp/outside.jsonl")).rejects.toMatchObject({
        code: "CODEX_PATH_TRAVERSAL",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns typed partial errors for missing or unsupported local sources", async () => {
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
      const timeline = await requestJson(baseUrl, "/api/timeline?threadId=thread-missing-rollout");
      const logs = await requestJson(baseUrl, "/api/logs?limit=1");

      expect(timeline.status).toBe(404);
      expect(timeline.body).toMatchObject({
        ok: false,
        source: "rollout-cache",
        warnings: [],
        error: {
          code: "ROLLOUT_NOT_FOUND",
        },
      });

      expect(logs.status).toBe(503);
      expect(logs.body).toMatchObject({
        ok: false,
        source: "logs-db",
        warnings: [],
        error: {
          code: "LOGS_DB_MISSING",
        },
      });
    });
  });

  it("does not expose export, editor launch, command execution, or telemetry endpoints", async () => {
    const fixture = await createCodexHomeFixture();

    await withApi(fixture, async ({ baseUrl }) => {
      for (const path of ["/api/export", "/api/editor/open", "/api/commands", "/api/telemetry"]) {
        const response = await fetch(`${baseUrl}${path}`, { method: "POST" });
        expect(response.status, `${path} must not exist as a mutation endpoint`).toBe(404);
      }
    });
  });
});
