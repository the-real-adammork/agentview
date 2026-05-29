export interface ThreadTextFields {
  firstUserMessage: string | null | undefined;
  preview?: string | null | undefined;
}

export interface ThreadClassification {
  /** Matched the orchestrator launch prompt. */
  isOrchestrator: boolean;
  /** Phase id captured from the orchestrator prompt (null when not an orchestrator). */
  phase: string | null;
  /** Invokes $implementation-execution and is not itself an orchestrator. */
  isSupervisor: boolean;
  /** docs/implementation-runs/<runId>/ reference, if any. */
  runId: string | null;
  /** Parent thread id from an explicit [av-parent:<id>] marker, if any. */
  markerParentId: string | null;
}

const ORCHESTRATOR_RE = /as the phase orchestrator for\s+(\S+)/i;
const SUPERVISOR_TOKEN_RE = /\$implementation-execution\b/;
const RUN_ID_RE = /docs\/implementation-runs\/([^/\s]+)\//;
const MARKER_RE = /\[av-parent:([0-9a-f-]+)\]/i;

/** Trailing sentence punctuation that clings to a captured token (e.g. "phase-4."). */
const stripTrailingPunct = (value: string): string => value.replace(/[.,;:]+$/, "");

export const classifyThread = (fields: ThreadTextFields): ThreadClassification => {
  const first = fields.firstUserMessage ?? "";
  const preview = fields.preview ?? "";
  const both = `${first}\n${preview}`;

  // Orchestrator + marker are keyed on the launch prompt (firstUserMessage) so a
  // supervisor whose latest preview happens to quote the orchestrator phrase is
  // not misclassified.
  const orchestratorMatch = first.match(ORCHESTRATOR_RE);
  const isOrchestrator = orchestratorMatch !== null;
  const phase = orchestratorMatch ? stripTrailingPunct(orchestratorMatch[1]) : null;

  const markerMatch = first.match(MARKER_RE);
  const markerParentId = markerMatch ? markerMatch[1] : null;

  // run id and the supervisor token may appear in either the first message or the
  // latest preview, so scan both.
  const runMatch = both.match(RUN_ID_RE);
  const runId = runMatch ? runMatch[1] : null;

  const isSupervisor = !isOrchestrator && SUPERVISOR_TOKEN_RE.test(both);

  return { isOrchestrator, phase, isSupervisor, runId, markerParentId };
};

/** Remove the [av-parent:] marker from user-facing text and tidy whitespace. */
export const stripParentMarker = (value: string | null | undefined): string =>
  (value ?? "").replace(MARKER_RE, "").replace(/\s{2,}/g, " ").trim();
