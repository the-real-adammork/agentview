import { Fragment, useEffect, useState, type ReactNode } from "react";

import type { SubagentCitation, SubagentFinding, SubagentNotificationRender, SubagentReportSection } from "../../shared/contracts";
import { Button, Chip } from "../ui";

const INLINE_CAP = 2;

const toneColorVar = (tone: SubagentNotificationRender["statusTone"]) => {
  if (tone === "good") return "var(--good)";
  if (tone === "amber") return "var(--amber)";
  if (tone === "warn") return "var(--warn-bright)";
  if (tone === "cyan") return "var(--cyan)";
  return "var(--primary)";
};

const confidenceColorVar = (tone: SubagentFinding["confidenceTone"]) => {
  if (tone === "high") return "var(--good)";
  if (tone === "low") return "var(--warn-bright)";
  if (tone === "unknown") return "var(--ink-dim)";
  return "var(--amber)";
};

const shortAgentPath = (path: string) => (path.length > 13 ? `${path.slice(0, 8)}...${path.slice(-4)}` : path);

function RichText({ text, idPrefix }: { text: string; idPrefix: string }) {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\(?\[([^\]]+)\]\(([^)]+)\)\)?/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      nodes.push(
        <b className="sn-em" key={`${idPrefix}-${key++}`}>
          {match[1]}
        </b>,
      );
    } else {
      nodes.push(
        <a
          className="sn-clink"
          href={match[3]}
          key={`${idPrefix}-${key++}`}
          onClick={(domEvent) => domEvent.stopPropagation()}
          rel="noreferrer"
          target="_blank"
        >
          {match[2]}
        </a>,
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

function CitationChip({ citation }: { citation: SubagentCitation }) {
  return (
    <a
      className="sn-cite"
      href={citation.url}
      onClick={(domEvent) => domEvent.stopPropagation()}
      rel="noreferrer"
      target="_blank"
      title={citation.url}
    >
      <span className="sn-cite-glyph" aria-hidden="true">
        ↗
      </span>
      <span className="sn-cite-dom">{citation.domain}</span>
    </a>
  );
}

function ConfidencePill({ finding, compact = false }: { finding: SubagentFinding; compact?: boolean }) {
  const label = finding.confidence ?? "--";
  return (
    <span className={`sn-conf sn-conf-${finding.confidenceTone}`} title={`Confidence: ${label}`}>
      <span className="sn-conf-dot" style={{ background: confidenceColorVar(finding.confidenceTone) }} />
      {compact ? null : <span className="sn-conf-lbl">{label}</span>}
    </span>
  );
}

function FindingCard({ finding, index }: { finding: SubagentFinding; index: number }) {
  return (
    <div className="sn-finding" data-conf={finding.confidenceTone}>
      <div className="sn-finding-top">
        <span className="sn-fn-n num">{String(index).padStart(2, "0")}</span>
        <ConfidencePill finding={finding} />
        <span className="sn-fn-rule" aria-hidden="true" />
        {finding.citations.length > 0 ? <span className="sn-fn-srccount num">{finding.citations.length} src</span> : null}
      </div>
      <div className="sn-finding-prose">
        <RichText idPrefix={`finding-${index}`} text={finding.prose} />
      </div>
      {finding.citations.length > 0 ? (
        <div className="sn-cites">
          {finding.citations.map((citation) => (
            <CitationChip citation={citation} key={`${citation.domain}-${citation.url}`} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DistBar({ notification }: { notification: SubagentNotificationRender }) {
  const { high, medium, low, unknown } = notification.confidence;
  const segments = [
    ["high", high],
    ["medium", medium],
    ["low", low],
    ["unknown", unknown],
  ] as const;
  return (
    <span className="sn-dist" aria-hidden="true">
      {segments.map(([tone, count]) =>
        count > 0 ? (
          <span
            className="sn-dist-seg"
            key={tone}
            style={{ flex: count, background: confidenceColorVar(tone === "medium" ? "mixed" : tone) }}
            title={`${tone} · ${count}`}
          />
        ) : null,
      )}
    </span>
  );
}

function SummaryBand({ notification }: { notification: SubagentNotificationRender }) {
  return (
    <div className="sn-summary">
      <div className="sn-sum-id">
        <span className="sn-sum-glyph" data-tone={notification.statusTone}>
          {notification.statusGlyph}
        </span>
        <span className="sn-sum-meta">
          <span className="sn-sum-nick">
            {notification.agentNickname ?? "SUB-AGENT"}
            {notification.agentRole ? <span className="sn-sum-role"> · {notification.agentRole}</span> : null}
          </span>
          <span className="sn-sum-path num">agent_path {shortAgentPath(notification.agentPath)}</span>
        </span>
        <span className={`sn-status sn-status-${notification.statusTone}`}>
          {notification.statusGlyph} {notification.statusLabel}
        </span>
      </div>
      <div className="sn-sum-counts">
        <span className="sn-count">
          <b className="num">{notification.counts.findings}</b> findings
        </span>
        <span className="sn-count">
          <b className="num">{notification.counts.sources}</b> sources
        </span>
        {notification.counts.openQuestions > 0 ? (
          <span className="sn-count warn">
            <b className="num">{notification.counts.openQuestions}</b> open
          </span>
        ) : null}
        <span className="sn-sum-dist">
          <DistBar notification={notification} />
        </span>
      </div>
    </div>
  );
}

const allFindings = (notification: SubagentNotificationRender) =>
  notification.sections.flatMap((section) => (section.type === "findings" ? section.findings : []));

export function SubagentNotificationOutput({
  notification,
  onExpand,
}: {
  notification: SubagentNotificationRender;
  onExpand?: () => void;
}) {
  const findings = allFindings(notification);
  const shown = findings.slice(0, INLINE_CAP);
  const hidden = Math.max(0, findings.length - shown.length);

  return (
    <div className="out xr-out sn-out" data-tone={notification.statusTone}>
      <div className="xr-out-hd">
        <span className="xr-kind sn-kind" data-tone={notification.statusTone}>
          SUBAGENT_NOTIFICATION
        </span>
        <span className="sn-hd-status" style={{ color: toneColorVar(notification.statusTone) }}>
          {notification.statusGlyph} {notification.statusLabel}
        </span>
      </div>
      <SummaryBand notification={notification} />
      <div className="sn-findings">
        {shown.map((finding, index) => (
          <FindingCard finding={finding} index={index + 1} key={`${finding.prose}-${index}`} />
        ))}
        {findings.length === 0 ? <div className="sn-empty">-- no structured findings -- status note only</div> : null}
      </div>
      <Button
        className="xr-expand"
        type="button"
        onClick={(domEvent) => {
          domEvent.stopPropagation();
          onExpand?.();
        }}
      >
        Expand · {hidden > 0 ? `${hidden} more finding${hidden === 1 ? "" : "s"}` : "full report"}
        {notification.counts.openQuestions > 0 ? ` · ${notification.counts.openQuestions} open` : ""} ›
      </Button>
    </div>
  );
}

function SectionView({ section, startIndex }: { section: SubagentReportSection; startIndex: number }) {
  let offset = startIndex;
  return (
    <section className="sn-section" data-type={section.type}>
      {section.title ? (
        <header className="sn-sec-hd" data-type={section.type}>
          <span className="sn-sec-bar" aria-hidden="true" />
          <span className="sn-sec-title">{section.title}</span>
          {section.findings.length > 0 ? (
            <span className={`sn-sec-n num${section.type === "risk" ? " warn" : ""}`}>{section.findings.length}</span>
          ) : null}
        </header>
      ) : null}
      {section.type === "risk" ? (
        <div className="sn-risks">
          {section.findings.map((finding, index) => (
            <div className="sn-risk" key={`${finding.prose}-${index}`}>
              <span className="sn-risk-glyph" aria-hidden="true">
                ▸
              </span>
              <span className="sn-risk-text">
                <RichText idPrefix={`risk-${index}`} text={finding.prose} />
                {finding.citations.length > 0 ? (
                  <span className="sn-cites inline">
                    {finding.citations.map((citation) => (
                      <CitationChip citation={citation} key={`${citation.domain}-${citation.url}`} />
                    ))}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        section.findings.map((finding) => <FindingCard finding={finding} index={++offset} key={`${finding.prose}-${offset}`} />)
      )}
      {section.paragraphs.map((paragraph, index) => (
        <p className="sn-para" key={`${paragraph}-${index}`}>
          <RichText idPrefix={`paragraph-${index}`} text={paragraph} />
        </p>
      ))}
    </section>
  );
}

export function SubagentNotificationModal({
  notification,
  onClose,
}: {
  notification: SubagentNotificationRender;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    const onKey = (domEvent: KeyboardEvent) => {
      if (domEvent.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let findingOffset = 0;
  return (
    <div className="xr-modal-scrim" onClick={onClose}>
      <div
        aria-label="Subagent notification"
        aria-modal="true"
        className="xr-modal sn-modal"
        onClick={(domEvent) => domEvent.stopPropagation()}
        role="dialog"
      >
        <div className="xr-modal-hd">
          <span className="xr-modal-kind sn-modal-kind" data-tone={notification.statusTone}>
            SUBAGENT_NOTIF
          </span>
          <span className="xr-modal-cmd num">
            {notification.agentNickname ? `${notification.agentNickname} · ` : ""}
            {notification.agentPath}
          </span>
          <span className="spacer" />
          <Chip tone={notification.statusTone === "warn" ? "warn" : notification.statusTone === "cyan" ? "cyan" : notification.statusTone === "good" ? "good" : "amber"}>
            {notification.statusGlyph} {notification.statusLabel}
          </Chip>
          {notification.tokens !== undefined ? <Chip tone="dim">{(notification.tokens / 1000).toFixed(1)}K tok</Chip> : null}
          <Button className="xr-raw-btn" type="button" data-on={raw} onClick={() => setRaw((value) => !value)}>
            {raw ? "FORMATTED" : "RAW"}
          </Button>
          <Button className="xr-modal-close" type="button" onClick={onClose} aria-label="Close">
            ×
          </Button>
        </div>
        <div className="xr-modal-body sn-modal-body">
          {raw ? (
            <pre className="sn-raw">{notification.rawJson}</pre>
          ) : (
            <div className="sn-report">
              <div className="sn-band">
                <SummaryBand notification={notification} />
              </div>
              {notification.sections.map((section, index) => {
                const startIndex = findingOffset;
                if (section.type === "findings") findingOffset += section.findings.length;
                return (
                  <Fragment key={`${section.title ?? "section"}-${index}`}>
                    <SectionView section={section} startIndex={startIndex} />
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
