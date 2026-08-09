const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s)]+/gi,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi,
  /(?:javascript|data):[^\s)]+/gi,
];

export function sanitizeUntrustedText(value, maxLength = 240) {
  let text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  for (const pattern of SECRET_PATTERNS)
    text = text.replace(pattern, '[redacted]');
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@/g, '@\u200b')
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]()#+!|])/g, '\\$1');
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1)}…`;
  return text || '(empty)';
}

function issueLink(number) {
  return Number.isSafeInteger(number) && number > 0
    ? `#${number}`
    : 'untracked';
}

function capabilityList(capabilityIds) {
  return (Array.isArray(capabilityIds) ? capabilityIds : [])
    .map((id) => `\`${sanitizeUntrustedText(id)}\``)
    .join(', ');
}

function renderCanonicalBuyerGaps(lines, report, maxGaps) {
  const hasBuyerEvidence = Number.isSafeInteger(
    report.summary?.unresolved_buyer_gaps,
  );
  lines.push('## Canonical buyer-visible gaps', '');
  if (!hasBuyerEvidence) {
    lines.push(
      'Canonical buyer-gap state was not evaluated in this report; capability maturity must not be interpreted as whole-product gap exhaustion.',
      '',
    );
    return;
  }

  const unresolved = Array.isArray(report.buyer_gaps) ? report.buyer_gaps : [];
  const unknown = Array.isArray(report.buyer_gap_unknown)
    ? report.buyer_gap_unknown
    : [];
  if (unresolved.length === 0 && unknown.length === 0) {
    lines.push('No registered canonical buyer gaps remain open or unknown.', '');
    return;
  }
  for (const gap of unresolved.slice(0, maxGaps)) {
    lines.push(
      `- **${sanitizeUntrustedText(gap.gap_id)}** — ${issueLink(gap.issue_number)} — open`,
      `  - Capability links: ${capabilityList(gap.capability_ids) || 'none'}`,
    );
  }
  for (const gap of unknown.slice(0, maxGaps)) {
    lines.push(
      `- **${sanitizeUntrustedText(gap.gap_id)}** — ${issueLink(gap.issue_number)} — **state unknown**`,
      `  - Capability links: ${capabilityList(gap.capability_ids) || 'none'}`,
    );
  }
  lines.push('');
}

function renderCapabilityEvidenceGaps(lines, report, maxGaps) {
  lines.push('## Capability evidence gaps', '');
  if (!Array.isArray(report.gaps) || report.gaps.length === 0) {
    lines.push(
      'No capability evidence gaps remain at the configured target maturity levels.',
      '',
    );
    return;
  }
  for (const gap of report.gaps.slice(0, maxGaps)) {
    lines.push(
      `### ${sanitizeUntrustedText(gap.capability_id)} · score ${gap.priority_score}`,
      '',
      `- Outcome: ${sanitizeUntrustedText(gap.outcome)}`,
      `- Maturity: \`${gap.observed_maturity}\` → \`${gap.target_maturity}\``,
      `- Tracking: ${issueLink(gap.tracking_issue)}`,
      `- Missing evidence: ${
        gap.missing_evidence
          .map((path) => `\`${sanitizeUntrustedText(path)}\``)
          .join(', ') || 'none recorded'
      }`,
      '',
    );
  }
}

export function renderCommercialReadinessIssue(
  report,
  snapshot,
  { marker, maxGaps = 15 },
) {
  const capabilityEvidenceGaps = Number.isSafeInteger(
    report.summary?.capability_evidence_gaps,
  )
    ? report.summary.capability_evidence_gaps
    : report.summary.unresolved_gaps;
  const lines = [
    marker,
    '# LifeOS commercial readiness',
    '',
    '> Generated from repository evidence. Documentation claims do not satisfy implementation or test probes. Capability maturity and canonical buyer-gap state are independent evidence dimensions.',
    '',
    `- Commit: \`${report.commit_sha}\``,
    `- Evidence timestamp: \`${report.generated_at}\``,
    `- Configured weighted maturity: **${report.summary.weighted_maturity_percent}%**`,
    `- Capabilities at target: **${report.summary.at_target}/${report.summary.total_capabilities}**`,
    `- Capability evidence gaps: **${capabilityEvidenceGaps}**`,
  ];

  if (Number.isSafeInteger(report.summary?.unresolved_buyer_gaps)) {
    lines.push(
      `- Unresolved canonical buyer gaps: **${report.summary.unresolved_buyer_gaps}**`,
      `- Unknown canonical buyer-gap states: **${report.summary.unknown_buyer_gap_states}**`,
    );
  } else {
    lines.push('- Canonical buyer-gap evidence: **not evaluated**');
  }
  lines.push('');

  renderCanonicalBuyerGaps(lines, report, maxGaps);
  renderCapabilityEvidenceGaps(lines, report, maxGaps);

  lines.push('## Pull request drain', '');
  const pulls = Array.isArray(snapshot.pull_requests)
    ? snapshot.pull_requests
    : [];
  if (pulls.length === 0) {
    lines.push('No open pull requests.');
  } else {
    for (const pull of pulls) {
      const blockers = Array.isArray(pull.blockers) ? pull.blockers : [];
      lines.push(
        `- #${pull.number} ${sanitizeUntrustedText(pull.title)} — ${
          pull.eligible
            ? '**merge eligible**'
            : `blocked: ${
                blockers
                  .map((item) => `\`${sanitizeUntrustedText(item)}\``)
                  .join(', ') || '`unknown`'
              }`
        }`,
      );
    }
  }

  lines.push(
    '',
    '## Operating rule',
    '',
    'The hourly loop may squash-merge only an exact, same-repository head SHA with every required workflow and status successful, no requested changes, no unresolved review thread, and no base drift. It never uses an administrative bypass.',
    '',
  );
  return `${lines.join('\n')}\n`;
}
