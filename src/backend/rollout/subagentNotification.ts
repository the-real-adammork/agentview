import type {
  AgentEdgeStatus,
  SubagentCitation,
  SubagentConfidenceTone,
  SubagentFinding,
  SubagentNotificationRender,
  SubagentNotificationTone,
  SubagentReportSection,
  SubagentReportSectionType,
} from "../../shared/contracts";
import { maskPreviewSecrets } from "../../shared/redaction";

interface RawSubagentNotification {
  agent_path?: unknown;
  agent_nickname?: unknown;
  agent_role?: unknown;
  tokens?: unknown;
  status?: unknown;
}

const NOTIFICATION_RE = /<subagent_notification>\s*([\s\S]*?)\s*<\/subagent_notification>/i;
const CITE_RE = /\(?\[([^\]]+)\]\(([^)]+)\)\)?/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

const numberValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseNotificationJson = (body: string): RawSubagentNotification | undefined => {
  const trimmed = body.trim();
  const withoutEscapedEdgeNewlines = trimmed.replace(/^\\n\s*/, "").replace(/\s*\\n$/, "");
  const attempts = [
    trimmed,
    trimmed.replace(/\\"/g, '"'),
    withoutEscapedEdgeNewlines,
    withoutEscapedEdgeNewlines.replace(/\\"/g, '"'),
  ];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the next normalization.
    }
  }
  return undefined;
};

const statusPresentation = (
  key: string,
): { tone: SubagentNotificationTone; glyph: string; label: string; edgeStatus: AgentEdgeStatus } => {
  switch (key.toLowerCase()) {
    case "completed":
    case "done":
      return { tone: "good", glyph: "✓", label: "COMPLETED", edgeStatus: "closed" };
    case "in_progress":
    case "running":
      return { tone: "amber", glyph: "◌", label: key.toLowerCase() === "running" ? "RUNNING" : "IN PROGRESS", edgeStatus: "open" };
    case "update":
      return { tone: "amber", glyph: "↻", label: "STATUS UPDATE", edgeStatus: "open" };
    case "blocked":
      return { tone: "cyan", glyph: "⏸", label: "BLOCKED", edgeStatus: "open" };
    case "waiting":
      return { tone: "cyan", glyph: "⏸", label: "WAITING", edgeStatus: "open" };
    case "failed":
    case "error":
      return { tone: "warn", glyph: "✗", label: key.toLowerCase() === "error" ? "ERROR" : "FAILED", edgeStatus: "failed" };
    default:
      return { tone: "primary", glyph: "▸", label: key.toUpperCase(), edgeStatus: "open" };
  }
};

const confidenceTone = (label?: string): SubagentConfidenceTone => {
  if (!label) return "unknown";
  const lower = label.toLowerCase();
  const hasHigh = /high/.test(lower);
  const hasMedium = /medium|moderate|med\b/.test(lower);
  const hasLow = /low/.test(lower);
  if (hasLow && (hasMedium || hasHigh)) return "mixed";
  if (hasHigh && !hasMedium && !hasLow) return "high";
  if (hasMedium && !hasLow && !hasHigh) return "medium";
  if (hasLow) return "low";
  return "medium";
};

const confidenceBucket = (tone: SubagentConfidenceTone): keyof SubagentNotificationRender["confidence"] => {
  if (tone === "high") return "high";
  if (tone === "low") return "low";
  if (tone === "unknown") return "unknown";
  return "medium";
};

const sectionType = (title?: string): SubagentReportSectionType => {
  if (!title) return "findings";
  if (/contradict|uncertaint|risk|open question|conflict/i.test(title)) return "risk";
  if (/source/i.test(title)) return "sources";
  return "findings";
};

const extractCitations = (text: string): SubagentCitation[] => {
  const citations: SubagentCitation[] = [];
  CITE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CITE_RE.exec(text)) !== null) {
    citations.push({ domain: match[1].trim(), url: match[2].trim() });
  }

  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.domain.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const parseFinding = (text: string): SubagentFinding => {
  const citations = extractCitations(text);
  const confidence = text.match(/\*\*\s*Confidence:\s*([^*]+?)\.?\s*\*\*/i)?.[1]?.trim();
  let prose = text.replace(CITE_RE, " ").replace(/\*\*\s*Confidence:[^*]*\*\*/i, " ");
  let sourceNote: string | undefined;
  const sourceIndex = prose.search(/\bSources?:/i);
  if (sourceIndex >= 0) {
    sourceNote = prose
      .slice(sourceIndex)
      .replace(/^\s*Sources?:\s*/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    prose = prose.slice(0, sourceIndex);
  }
  prose = prose.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/[\s.;,]+$/, "").trim();
  return { prose, confidence, confidenceTone: confidenceTone(confidence), citations, sourceNote };
};

const parseReport = (body: string): SubagentReportSection[] => {
  const normalizedBody = body.replace(/\\n/g, "\n");
  const blocks: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (!buffer.length) return;
    blocks.push(buffer.join("\n"));
    buffer = [];
  };

  for (const line of normalizedBody.replace(/\r/g, "").split("\n")) {
    if (line.trim() === "") flush();
    else buffer.push(line);
  }
  flush();

  const sections: SubagentReportSection[] = [];
  let current: SubagentReportSection | undefined;
  const ensureSection = (title?: string) => {
    current = { title, type: sectionType(title), findings: [], paragraphs: [] };
    sections.push(current);
  };

  for (const block of blocks) {
    const trimmed = block.trim();
    const heading = trimmed.match(/^\*\*(.+?)\*\*$/s);
    if (heading && !/^\s*[-*]\s/.test(trimmed) && !trimmed.includes("\n")) {
      ensureSection(heading[1].trim());
      continue;
    }

    if (!current) ensureSection();
    if (/^\s*[-*]\s+/.test(trimmed)) {
      let item: string | undefined;
      for (const line of block.split("\n")) {
        if (/^\s*[-*]\s+/.test(line)) {
          if (item !== undefined) current?.findings.push(parseFinding(item));
          item = line.replace(/^\s*[-*]\s+/, "");
        } else if (item !== undefined) {
          item += ` ${line.trim()}`;
        }
      }
      if (item !== undefined) current?.findings.push(parseFinding(item));
    } else {
      current?.paragraphs.push(trimmed);
    }
  }

  return sections;
};

const buildStats = (sections: SubagentReportSection[]) => {
  const confidence: SubagentNotificationRender["confidence"] = { high: 0, medium: 0, low: 0, unknown: 0 };
  const domains = new Set<string>();
  let findings = 0;
  let openQuestions = 0;

  for (const section of sections) {
    if (section.type === "findings") {
      findings += section.findings.length;
      for (const finding of section.findings) {
        confidence[confidenceBucket(finding.confidenceTone)] += 1;
      }
    }
    if (section.type === "risk") openQuestions += section.findings.length;
    for (const finding of section.findings) {
      for (const citation of finding.citations) domains.add(citation.domain);
    }
    for (const paragraph of section.paragraphs) {
      for (const citation of extractCitations(paragraph)) domains.add(citation.domain);
    }
  }

  return { confidence, findings, openQuestions, sourceDomains: [...domains] };
};

export const parseSubagentNotificationText = (text: string | undefined): SubagentNotificationRender | undefined => {
  const match = text ? NOTIFICATION_RE.exec(text) : null;
  if (!match) return undefined;

  const raw = parseNotificationJson(match[1]);
  if (!raw) return undefined;

  const agentPath = stringValue(raw.agent_path);
  const status = isRecord(raw.status) ? raw.status : undefined;
  const statusEntry = Object.entries(status ?? {}).find(([, value]) => typeof value === "string");
  if (!agentPath || !statusEntry) return undefined;

  const [statusKey, statusText] = statusEntry as [string, string];
  const presentation = statusPresentation(statusKey);
  const sections = parseReport(statusText);
  const stats = buildStats(sections);
  const safeRaw = maskPreviewSecrets(JSON.stringify(raw, null, 2));

  return {
    agentPath,
    agentNickname: stringValue(raw.agent_nickname),
    agentRole: stringValue(raw.agent_role),
    tokens: numberValue(raw.tokens),
    statusKey,
    statusLabel: presentation.label,
    statusTone: presentation.tone,
    statusGlyph: presentation.glyph,
    statusText: maskPreviewSecrets(statusText),
    rawJson: safeRaw,
    sections,
    counts: {
      findings: stats.findings,
      sources: stats.sourceDomains.length,
      openQuestions: stats.openQuestions,
    },
    confidence: stats.confidence,
    sourceDomains: stats.sourceDomains,
  };
};

export const agentStatusForSubagentNotification = (notification: SubagentNotificationRender): AgentEdgeStatus =>
  statusPresentation(notification.statusKey).edgeStatus;

export const previewForSubagentNotification = (notification: SubagentNotificationRender): string => {
  const name = notification.agentNickname ?? notification.agentRole ?? "Sub-agent";
  const state = notification.statusKey.replace(/_/g, " ");
  const findings = notification.counts.findings;
  return `${name} ${state} with ${findings} finding${findings === 1 ? "" : "s"}`;
};
