import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { tailRolloutFile } from "../../src/backend/tail/liveTail";

const tempRoots: string[] = [];

const createRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentview-live-tail-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("tailRolloutFile", () => {
  it("returns complete appended JSONL rows and the next byte offset", async () => {
    const root = await createRoot();
    const rolloutPath = join(root, "session.jsonl");
    const firstLine = `${JSON.stringify({ timestamp: "2026-05-26T18:40:00.000Z", type: "message", role: "user", text: "Before tail" })}\n`;
    await writeFile(rolloutPath, firstLine, "utf8");
    const fromByte = Buffer.byteLength(firstLine, "utf8");

    await appendFile(
      rolloutPath,
      `${JSON.stringify({ timestamp: "2026-05-26T18:40:01.000Z", type: "message", role: "assistant", text: "After tail" })}\n`,
      "utf8",
    );

    const result = await tailRolloutFile({
      path: rolloutPath,
      threadId: "thread-tail",
      fromByte,
      sourceLine: 2,
    });

    expect(result.truncated).toBe(false);
    expect(result.payload.events).toEqual([
      expect.objectContaining({
        threadId: "thread-tail",
        sourceLine: 2,
        kind: "assistant_message",
        previewText: "After tail",
      }),
    ]);
    expect(result.payload.nextByteOffset).toBeGreaterThan(fromByte);
  });

  it("holds incomplete trailing lines until a newline is present", async () => {
    const root = await createRoot();
    const rolloutPath = join(root, "incomplete.jsonl");
    await writeFile(
      rolloutPath,
      JSON.stringify({ timestamp: "2026-05-26T18:41:00.000Z", type: "message", role: "assistant", text: "partial" }),
      "utf8",
    );

    const result = await tailRolloutFile({
      path: rolloutPath,
      threadId: "thread-tail",
      fromByte: 0,
    });

    expect(result.payload.events).toEqual([]);
    expect(result.payload.nextByteOffset).toBe(0);
  });

  it("tails only complete observed envelope rows and preserves byte offsets across partial appends", async () => {
    const root = await createRoot();
    const rolloutPath = join(root, "observed-tail.jsonl");
    const firstLine = `${JSON.stringify({
      timestamp: "2026-05-27T14:30:00.000Z",
      type: "event_msg",
      payload: {
        type: "message",
        message: {
          role: "user",
          content: [{ type: "input_text", text: "Before observed tail" }],
        },
      },
    })}\n`;
    await writeFile(rolloutPath, firstLine, "utf8");
    const fromByte = Buffer.byteLength(firstLine, "utf8");

    const completeLine = `${JSON.stringify({
      timestamp: "2026-05-27T14:30:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "output_text", text: "Complete observed tail row" }],
        },
      },
    })}\n`;
    const partialLine = JSON.stringify({
      timestamp: "2026-05-27T14:30:02.000Z",
      type: "event_msg",
      payload: {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "output_text", text: "Partial row must wait" }],
        },
      },
    });
    await appendFile(rolloutPath, `${completeLine}${partialLine}`, "utf8");

    const result = await tailRolloutFile({
      path: rolloutPath,
      threadId: "thread-observed-tail",
      fromByte,
      sourceLine: 2,
    });

    expect(result.truncated).toBe(false);
    expect(result.payload.events).toEqual([
      expect.objectContaining({
        threadId: "thread-observed-tail",
        sourceLine: 2,
        kind: "assistant_message",
        previewText: "Complete observed tail row",
      }),
    ]);
    expect(result.payload.nextByteOffset).toBe(fromByte + Buffer.byteLength(completeLine, "utf8"));

    await appendFile(rolloutPath, "\n", "utf8");
    const completedPartial = await tailRolloutFile({
      path: rolloutPath,
      threadId: "thread-observed-tail",
      fromByte: result.payload.nextByteOffset,
      sourceLine: 3,
    });

    expect(completedPartial.payload.events).toEqual([
      expect.objectContaining({
        sourceLine: 3,
        kind: "assistant_message",
        previewText: "Partial row must wait",
      }),
    ]);
    expect(completedPartial.payload.nextByteOffset).toBeGreaterThan(result.payload.nextByteOffset);
  });

  it("restarts from byte zero when the source file was truncated", async () => {
    const root = await createRoot();
    const rolloutPath = join(root, "truncated.jsonl");
    await writeFile(
      rolloutPath,
      `${JSON.stringify({ timestamp: "2026-05-26T18:42:00.000Z", type: "message", role: "user", text: "rebuilt" })}\n`,
      "utf8",
    );

    const result = await tailRolloutFile({
      path: rolloutPath,
      threadId: "thread-tail",
      fromByte: 100_000,
    });

    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining("truncated")]));
    expect(result.payload.events).toEqual([
      expect.objectContaining({
        kind: "user_message",
        previewText: "rebuilt",
      }),
    ]);
  });
});
