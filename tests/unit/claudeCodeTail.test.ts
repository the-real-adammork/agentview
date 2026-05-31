import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { tailClaudeTranscript } from "../../src/backend/sources/claudeCode/claudeTail";
import { parseClaudeSessionLines } from "../../src/backend/sources/claudeCode/parseClaudeSession";

const tempRoots: string[] = [];

const createRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentview-cc-tail-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SESSION_ID = "cc-tail-0001";

// Two complete CC turn lines: a top-level user prompt and an assistant text reply.
const userLine = JSON.stringify({
  type: "user",
  uuid: "u1",
  parentUuid: null,
  sessionId: SESSION_ID,
  timestamp: "2026-05-30T10:00:00.000Z",
  cwd: "/repo/cc-app",
  gitBranch: "main",
  version: "1.2.3",
  isSidechain: false,
  userType: "external",
  message: { role: "user", content: "Investigate the failing build." },
});

const assistantLine = JSON.stringify({
  type: "assistant",
  uuid: "a1",
  parentUuid: "u1",
  sessionId: SESSION_ID,
  timestamp: "2026-05-30T10:00:01.000Z",
  cwd: "/repo/cc-app",
  gitBranch: "main",
  version: "1.2.3",
  isSidechain: false,
  userType: "external",
  message: { role: "assistant", content: [{ type: "text", text: "I'll start by reading the broken module." }] },
});

const secondAssistantLine = JSON.stringify({
  type: "assistant",
  uuid: "a2",
  parentUuid: "u1",
  sessionId: SESSION_ID,
  timestamp: "2026-05-30T10:00:05.000Z",
  cwd: "/repo/cc-app",
  gitBranch: "main",
  version: "1.2.3",
  isSidechain: false,
  userType: "external",
  message: { role: "assistant", content: [{ type: "text", text: "The fix is in place; the build now passes." }] },
});

describe("tailClaudeTranscript", () => {
  it("cold start (fromByte 0) emits every complete line and advances offsets to EOF", async () => {
    const root = await createRoot();
    const path = join(root, `${SESSION_ID}.jsonl`);
    await writeFile(path, `${userLine}\n${assistantLine}\n`, "utf8");
    const size = statSync(path).size;

    const result = await tailClaudeTranscript({ path, sessionId: SESSION_ID, fromByte: 0, fromLine: 1 });

    // The user line yields user_message; the assistant text line yields assistant_message.
    expect(result.events.map((event) => event.kind)).toEqual(["user_message", "assistant_message"]);
    expect(result.nextByte).toBe(size);
    // Two complete lines consumed → next running line is fromLine + 2.
    expect(result.nextLine).toBe(1 + 2);
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
    // The first event carries the cold-start startingLine.
    expect(result.events[0]?.sourceLine).toBe(1);
    expect(result.events[1]?.sourceLine).toBe(2);
  });

  it("incremental (fromByte N) emits only the newly-appended events", async () => {
    const root = await createRoot();
    const path = join(root, `${SESSION_ID}.jsonl`);
    await writeFile(path, `${userLine}\n${assistantLine}\n`, "utf8");
    const baseline = statSync(path).size;
    // The two loaded lines mean the live caller continues from line 3.
    const fromLine = 3;

    await appendFile(path, `${secondAssistantLine}\n`, "utf8");

    const result = await tailClaudeTranscript({ path, sessionId: SESSION_ID, fromByte: baseline, fromLine });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.kind).toBe("assistant_message");
    expect(result.events[0]?.previewText).toContain("the build now passes");
    expect(result.events[0]?.sourceLine).toBe(3);
    expect(result.nextByte).toBeGreaterThan(baseline);
    expect(result.nextByte).toBe(statSync(path).size);
    expect(result.nextLine).toBe(fromLine + 1);
  });

  it("no new bytes (fromByte === size) returns empty with unchanged offsets and is idempotent", async () => {
    const root = await createRoot();
    const path = join(root, `${SESSION_ID}.jsonl`);
    await writeFile(path, `${userLine}\n${assistantLine}\n`, "utf8");
    const size = statSync(path).size;
    const fromLine = 3;

    const first = await tailClaudeTranscript({ path, sessionId: SESSION_ID, fromByte: size, fromLine });
    expect(first.events).toEqual([]);
    expect(first.nextByte).toBe(size);
    expect(first.nextLine).toBe(fromLine);
    expect(first.truncated).toBe(false);

    // Idempotent: a repeat from the same offset keeps yielding empty.
    const second = await tailClaudeTranscript({ path, sessionId: SESSION_ID, fromByte: first.nextByte, fromLine: first.nextLine });
    expect(second.events).toEqual([]);
    expect(second.nextByte).toBe(size);
    expect(second.nextLine).toBe(fromLine);
  });

  it("holds a partial trailing line until its terminating newline lands", async () => {
    const root = await createRoot();
    const path = join(root, `${SESSION_ID}.jsonl`);
    await writeFile(path, `${userLine}\n${assistantLine}\n`, "utf8");
    const baseline = statSync(path).size;
    const fromLine = 3;

    // A complete line followed by a half-written JSON fragment (no trailing newline).
    await appendFile(path, `${secondAssistantLine}\n${'{"type":"assistant","uuid":"a3"'}`, "utf8");

    const result = await tailClaudeTranscript({ path, sessionId: SESSION_ID, fromByte: baseline, fromLine });
    // Only the complete line is emitted; the fragment's bytes are not consumed.
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.previewText).toContain("the build now passes");
    expect(result.nextByte).toBe(baseline + Buffer.byteLength(`${secondAssistantLine}\n`, "utf8"));
    expect(result.nextLine).toBe(fromLine + 1);

    // Complete the fragment: the previously-partial line now emits with the next source line.
    const fragment = '{"type":"assistant","uuid":"a3"';
    await rm(path);
    await writeFile(
      path,
      `${userLine}\n${assistantLine}\n${secondAssistantLine}\n${fragment}\n`,
      "utf8",
    );
    // Re-tail from where we stopped (the fragment is now a complete — though
    // unknown-shaped — line, so it parses to a warning event, never silently dropped).
    const completed = await tailClaudeTranscript({
      path,
      sessionId: SESSION_ID,
      fromByte: result.nextByte,
      fromLine: result.nextLine,
    });
    expect(completed.events).toHaveLength(1);
    expect(completed.events[0]?.sourceLine).toBe(result.nextLine);
    expect(completed.nextByte).toBe(statSync(path).size);
  });

  it("returns empty without advancing the offset when the only appended bytes lack a newline", async () => {
    const root = await createRoot();
    const path = join(root, `${SESSION_ID}.jsonl`);
    await writeFile(path, `${userLine}\n${assistantLine}\n`, "utf8");
    const baseline = statSync(path).size;
    const fromLine = 3;

    await appendFile(path, `${'{"type":"assistant","uuid":"partial"'}`, "utf8");

    const result = await tailClaudeTranscript({ path, sessionId: SESSION_ID, fromByte: baseline, fromLine });
    expect(result.events).toEqual([]);
    expect(result.nextByte).toBe(baseline);
    expect(result.nextLine).toBe(fromLine);
  });

  it("restarts from byte zero, emits all lines, and warns when the file shrank (fromByte > size)", async () => {
    const root = await createRoot();
    const path = join(root, `${SESSION_ID}.jsonl`);
    await writeFile(path, `${userLine}\n${assistantLine}\n`, "utf8");
    const size = statSync(path).size;

    const result = await tailClaudeTranscript({ path, sessionId: SESSION_ID, fromByte: 10_000_000, fromLine: 99 });

    expect(result.truncated).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("truncated")]),
    );
    expect(result.events.map((event) => event.kind)).toEqual(["user_message", "assistant_message"]);
    expect(result.nextByte).toBe(size);
    // On truncation the running line counter restarts at 1 + lines.length.
    expect(result.nextLine).toBe(1 + 2);
  });

  it("produces events that deep-equal the Phase 4 cold parse for the same lines", async () => {
    const root = await createRoot();
    const path = join(root, `${SESSION_ID}.jsonl`);
    const lines = [userLine, assistantLine, secondAssistantLine];
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");
    const stat = statSync(path);

    const tail = await tailClaudeTranscript({ path, sessionId: SESSION_ID, fromByte: 0, fromLine: 1 });
    const cold = parseClaudeSessionLines(lines, {
      threadId: SESSION_ID,
      rolloutPath: path,
      sourceMtimeMs: stat.mtimeMs,
      sourceSizeBytes: stat.size,
      startingLine: 1,
    });

    expect(tail.events).toEqual(cold.events);
  });
});

describe("ClaudeCodeSource.tail (public adapter)", () => {
  it("maps tailClaudeTranscript onto the locked SourceTailResult shape from a resolved session", async () => {
    const { createClaudeProjectsFixture } = await import("../fixtures/claudeProjects");
    const { createClaudeCodeSource } = await import("../../src/backend/sources/claudeCode/ClaudeCodeSource");

    // Drive a real discovery so resolveSession returns the on-disk transcript path.
    const sessionId = "33333333-3333-4333-8333-333333333333";
    const cwd = "/repo/tail-app";
    const fixture = await createClaudeProjectsFixture({
      sessions: [
        {
          sessionId,
          cwd,
          aiTitle: "Tailable CC session",
          firstUserMessage: "Investigate the tailable session",
          createdAtMs: 1_700_000_000_000,
          updatedAtMs: 1_700_000_100_000,
          assistantUsages: [{ input: 100, output: 50 }],
        },
      ],
    });
    tempRoots.push(fixture.projectsDir);

    const source = createClaudeCodeSource({ projectsDir: fixture.projectsDir });
    try {
      const resolved = await source.resolveSession(sessionId);
      const transcript = await readFile(resolved.rawLogPath, "utf8");
      const lineCount = transcript.split("\n").filter((line) => line.trim().length > 0).length;

      // Cold call from byte 0 with the default fromLine: all events, advanced to EOF.
      const cold = await source.tail(resolved, 0);
      expect(cold.events.length).toBeGreaterThan(0);
      // The public adapter exposes ONLY the locked three fields.
      expect(Object.keys(cold).sort()).toEqual(["events", "nextByte", "nextLine"]);
      expect(cold.nextByte).toBe(Buffer.byteLength(transcript, "utf8"));

      // Append a new assistant turn and tail from the prior offset.
      const appended = JSON.stringify({
        type: "assistant",
        uuid: "tail-new",
        parentUuid: `${sessionId}-user-0`,
        sessionId,
        timestamp: "2026-05-30T11:00:00.000Z",
        cwd,
        gitBranch: "main",
        version: "1.2.3",
        isSidechain: false,
        userType: "external",
        message: { role: "assistant", content: [{ type: "text", text: "A freshly appended turn." }] },
      });
      await appendFile(resolved.rawLogPath, `${appended}\n`, "utf8");

      const delta = await source.tail(resolved, cold.nextByte);
      expect(delta.events).toHaveLength(1);
      expect(delta.events[0]?.previewText).toContain("freshly appended turn");
      expect(delta.events[0]?.sourceLine).toBe(lineCount + 1);
      expect(delta.nextByte).toBeGreaterThan(cold.nextByte);
    } finally {
      await source.close();
    }
  });
});
