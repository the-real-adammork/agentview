import { appendFile } from "node:fs/promises";
import { expect, test, type TestInfo } from "@playwright/test";

import {
  CC_E2E_SESSION_TITLE,
  removeClaudeTimelineFixture,
  writeClaudeTimelineFixture,
  writeLegacyE2eRolloutFixtures,
  writeObservedRolloutFixtures,
} from "./observedSourceFixture";

function appBaseUrl(testInfo: TestInfo) {
  const configuredBaseUrl = testInfo.project.use.baseURL;
  expect(configuredBaseUrl, "Playwright config must provide use.baseURL").toBeTruthy();
  return String(configuredBaseUrl);
}

test.describe("real Timeline detail @timeline", () => {
  test("renders parsed rollout rows, redacted previews, collapsed output, scrubber dots, grouped filters, and tail updates", async ({
    page,
    }, testInfo) => {
    await writeLegacyE2eRolloutFixtures();
    await page.goto(appBaseUrl(testInfo));
    const initialTimelineResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/timeline") && !response.url().includes("fromByte="),
    );
    // Select the user-root row explicitly (its rollout holds these fixtures);
    // the default "Active" selection lands on the sub-agent, not the parent.
    await page.getByRole("table", { name: /sessions/i }).getByRole("row", { name: /Parent real sessions work/i }).click();
    const initialTimelineBody = await (await initialTimelineResponsePromise).json();

    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByLabel("Timeline events").getByText("Timeline task started")).toBeVisible();
    await expect(page.getByText("OPENAI_API_KEY=[REDACTED]")).toBeVisible();
    await expect(page.getByText("sk-test")).toHaveCount(0);

    // Structured exec output: the `cat` result renders through the file-peek
    // renderer; its long output overflows the inline cap into an Expand
    // affordance that opens the full-output modal (Esc dismisses).
    const expandButton = page.getByRole("button", { name: /Expand · \d+ more lines/ });
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("button", { name: "RAW" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);

    // Scrubber renders one positioned dot per event plus five axis ticks.
    await expect(page.getByLabel("Timeline scrubber").locator(".timeline-scrubber__axis")).toHaveCount(5);
    expect(await page.getByLabel("Timeline scrubber").locator(".timeline-scrubber__dot").count()).toBeGreaterThan(0);

    // Time window control (handoff COMP/06): four segments, ALL default, header swaps to LAST {N}H.
    const windowGroup = page.getByRole("group", { name: "Time window" });
    await expect(windowGroup.getByRole("button")).toHaveCount(4);
    await expect(windowGroup.getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "true");
    const scrubberHeader = page.locator(".tl-scrubber-wrap .hdr span").first();
    await expect(scrubberHeader).toContainText("TASK_STARTED");
    await windowGroup.getByRole("button", { name: "1H" }).click();
    await expect(windowGroup.getByRole("button", { name: "1H" })).toHaveAttribute("aria-pressed", "true");
    await expect(scrubberHeader).toContainText("LAST 1H");
    await windowGroup.getByRole("button", { name: "ALL" }).click();
    await expect(scrubberHeader).toContainText("TASK_STARTED");

    // The grouped "Tools" filter shows only tool_call rows (results are inlined,
    // and skills are excluded — they live under the Skills tab).
    await page.getByRole("button", { name: /^Tools/ }).click();
    const events = page.getByLabel("Timeline events");
    expect(await events.locator("li").count()).toBeGreaterThan(0);
    await expect(events.locator('li:not([data-kind="tool_call"])')).toHaveCount(0);

    // Skills are a first-class kind: the Skills tab isolates skill_invoke rows.
    await page.getByRole("button", { name: /^Skills/ }).click();
    await expect(events.locator('li[data-kind="skill_invoke"]')).not.toHaveCount(0);
    await expect(events.locator('li:not([data-kind="skill_invoke"])')).toHaveCount(0);
    await expect(events.getByText(/SKILL · read_pdf/)).toBeVisible();

    const rolloutPath = initialTimelineBody.data.facts.rolloutPath;
    expect(rolloutPath).toBeTruthy();
    const tailLine = `${JSON.stringify({
      type: "assistant_message",
      timestamp: "2026-05-26T18:01:00.000Z",
      content: "tail appended row",
    })}\n`;
    await appendFile(rolloutPath, tailLine, "utf8");

    await page.getByRole("button", { name: /^All Events/ }).click();
    // Assistant rows are muted by default (they duplicate content shown elsewhere),
    // so reveal them before asserting the appended assistant row renders.
    await page.locator('button.tl-tt[title="Show Assistant rows"]').click();
    await page.getByRole("button", { name: "Tail" }).click();
    // The appended row arrives via the manual Tail fetch and/or the live SSE stream;
    // assert the user-visible outcome (the row renders) rather than racing a specific
    // network response, which is timing-sensitive under the test's filesystem watch.
    await expect(page.getByText("tail appended row").first()).toBeVisible({ timeout: 15_000 });
  });

  test("surfaces enriched observed rollout facts in event groups and spawn actions", async ({ page }, testInfo) => {
    await writeObservedRolloutFixtures();
    await page.goto(appBaseUrl(testInfo));
    const timelineResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/timeline") && !response.url().includes("fromByte="),
    );
    // Select the user-root row explicitly (its rollout holds the observed fixtures);
    // the default "Active" selection lands on the sub-agent, not the parent.
    await page.getByRole("table", { name: /sessions/i }).getByRole("row", { name: /Parent real sessions work/i }).click();
    const timelineBody = await (await timelineResponsePromise).json();

    expect(timelineBody).toMatchObject({
      ok: true,
      data: {
        facts: {
          summary: {
            turnCount: 1,
            failedToolCallCount: 1,
            tokenSnapshotCount: 1,
            agentLaunchCount: 1,
            agentWaitCount: 1,
          },
          turns: [
            expect.objectContaining({
              turnId: "turn-observed-parent",
              lastAgentMessagePreview: "Observed agent report row: frontend consumed enriched data",
              inputTokenCount: 7200,
              outputTokenCount: 1220,
            }),
          ],
          toolCalls: [
            expect.objectContaining({
              callId: "call-observed-shell",
              commandPreview: "npm run test -- --run observed-ui",
              outputPreview: "observed joined shell output",
              exitCode: 7,
              durationMs: 1234,
              outputTokenCount: 18,
            }),
          ],
          agentLaunches: [
            expect.objectContaining({
              childThreadId: "thread-subagent-implementation",
              nickname: "ui-worker",
              role: "implementation",
              taskPreview: "Consume enriched API fields in the UI",
            }),
          ],
        },
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: "tool_call",
            joinedOutputPreview: "observed joined shell output",
            joinedExitCode: 7,
            joinedDurationMs: 1234,
          }),
          expect.objectContaining({
            kind: "token_snapshot",
            tokenSnapshot: expect.objectContaining({
              lastInput: 111,
              lastOutput: 222,
              modelContextWindow: 128000,
              planType: "pro",
            }),
          }),
        ]),
      },
    });

    const timeline = page.getByLabel("Timeline events");
    // Token snapshot rows are hidden by default; reveal them so the all-kinds and
    // token-composition assertions below can see them.
    await page.getByRole("group", { name: "Token rows" }).getByRole("button").click();
    // Assistant rows are muted by default; reveal them for the all-kinds assertion.
    await page.locator('button.tl-tt[title="Show Assistant rows"]').click();
    // Every design event kind is present (tool results are inlined on their call).
    await expect(timeline.locator('[data-kind="task_started"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="turn_context"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="user_message"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="assistant_message"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="tool_call"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="token_snapshot"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="agent_launch"]')).not.toHaveCount(0);
    await expect(timeline.locator('[data-kind="agent_wait"]')).not.toHaveCount(0);

    // Design who-labels and inlined tool output.
    await expect(timeline.getByText("USER", { exact: true })).toBeVisible();
    await expect(timeline.getByText("⊕ SPAWN_AGENT")).toBeVisible();
    await expect.soft(timeline).toContainText("observed joined shell output", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("exit 7", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("1.234s", { timeout: 1_000 });
    // token_count composition row: compact total + cache-hit % + stacked legend.
    await expect.soft(timeline).toContainText("8.4K", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("of input cached", { timeout: 1_000 });
    await expect.soft(timeline).toContainText("Observed agent report row", { timeout: 1_000 });
    await expect
      .soft(page.getByRole("button", { name: /open thread-subagent-implementation in timeline/i }))
      .toBeVisible({ timeout: 1_000 });
  });

  test("renders a Claude Code session through the existing renderers (sourceId=claude-code)", async ({
    page,
  }, testInfo) => {
    // Seed one CC transcript into the e2e CLAUDE_PROJECTS_DIR; remove it afterward
    // so the @sessions exact-count spec (empty CC dir) stays green.
    await writeClaudeTimelineFixture();
    try {
      await page.goto(appBaseUrl(testInfo));

      // Isolate the CC row via the Sessions search box so the merged list shows
      // only the CC session, then select it. The timeline request the UI fires
      // carries sourceId=claude-code (the row's source field), so it parses
      // through ClaudeCodeSource.parse and draws through the unchanged renderers.
      await page.getByRole("searchbox", { name: /search sessions/i }).fill(CC_E2E_SESSION_TITLE);
      const ccTimelineResponse = page.waitForResponse(
        (response) =>
          response.url().includes("/api/timeline") &&
          response.url().includes("sourceId=claude-code") &&
          !response.url().includes("fromByte="),
      );
      await page
        .getByRole("table", { name: /sessions/i })
        .getByRole("row", { name: new RegExp(CC_E2E_SESSION_TITLE, "i") })
        .click();
      const ccBody = await (await ccTimelineResponse).json();

      // The CC payload draws through the same renderer types a Codex session would.
      expect(ccBody).toMatchObject({
        ok: true,
        data: {
          events: expect.arrayContaining([
            expect.objectContaining({ kind: "user_message" }),
            expect.objectContaining({ kind: "tool_call", toolName: "Bash", outputRender: expect.objectContaining({ kind: "status" }) }),
            expect.objectContaining({ kind: "tool_call", toolName: "Edit", outputRender: expect.objectContaining({ kind: "diff" }) }),
          ]),
        },
      });

      await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
      const timeline = page.getByLabel("Timeline events");
      // At least one tool_call row draws through the unchanged renderer components.
      await expect(timeline.locator('[data-kind="tool_call"]')).not.toHaveCount(0);

      // Redaction: the planted secret never reaches the DOM; the signature never leaks.
      const serialized = JSON.stringify(ccBody);
      expect(serialized).toContain("[REDACTED]");
      expect(serialized).not.toContain("sk-cc-e2e-secret");
      expect(serialized).not.toContain("sig-cc-e2e-hidden");
    } finally {
      await removeClaudeTimelineFixture();
    }
  });
});
