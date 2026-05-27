import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCodexHomeWithoutLogsFixture } from "../fixtures/diagnostics";
import { requestJson, stopRunningApis, withApi } from "../helpers/apiServer";

afterEach(async () => {
  await stopRunningApis();
});

describe("raw TUI log diagnostics API", () => {
  it("tails the allowlisted codex-tui.log with redacted previews and a resumable next offset", async () => {
    const fixture = await createCodexHomeWithoutLogsFixture();
    const rawLogPath = join(fixture.codexHome, "log", "codex-tui.log");
    await mkdir(dirname(rawLogPath), { recursive: true });
    await writeFile(
      rawLogPath,
      [
        "2026-05-27T06:28:19.000Z WARN startup raw warning",
        "2026-05-27T06:28:20.000Z INFO Authorization: Bearer raw-secret-token",
      ].join("\n") + "\n",
      "utf8",
    );

    await withApi(fixture, async ({ baseUrl }) => {
      const firstTail = await requestJson(baseUrl, "/api/diagnostics/raw-tail?fromByte=0&maxBytes=4096");

      expect(firstTail.status).toBe(200);
      expect(firstTail.body).toMatchObject({
        ok: true,
        data: {
          fromByte: 0,
          textPreview: expect.stringContaining("startup raw warning"),
          redactionApplied: true,
          nextByteOffset: expect.any(Number),
        },
      });

      const firstPreview = (firstTail.body as { data: { textPreview: string } }).data.textPreview;
      expect(firstPreview).toContain("Authorization: Bearer [REDACTED]");
      expect(firstPreview).not.toContain("raw-secret-token");

      const nextByteOffset = (firstTail.body as { data: { nextByteOffset: number } }).data.nextByteOffset;
      await writeFile(rawLogPath, "2026-05-27T06:28:21.000Z ERROR appended tail line\n", {
        encoding: "utf8",
        flag: "a",
      });

      const appendedTail = await requestJson(
        baseUrl,
        `/api/diagnostics/raw-tail?fromByte=${nextByteOffset}&maxBytes=4096`,
      );

      expect(appendedTail.status).toBe(200);
      expect(appendedTail.body).toMatchObject({
        ok: true,
        data: {
          fromByte: nextByteOffset,
          textPreview: expect.stringContaining("appended tail line"),
          nextByteOffset: expect.any(Number),
        },
      });
      expect((appendedTail.body as { data: { textPreview: string } }).data.textPreview).not.toContain(
        "startup raw warning",
      );
    });
  });
});
