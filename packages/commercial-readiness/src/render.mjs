const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb):\/\/[^\s)]+/gi,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}\b/gi,
  /(?:javascript|data):[^\s)]+/gi
];

export function sanitizeUntrustedText(value, maxLength = 240) {
  let text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
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
  return Number.isSafeInteger(number) && number > 0 ? `#${number}` : 'untracked';
}

export function renderCommercialReadinessIssue(
  report,
  snapshot,
  { marker, maxGaps = 15 }
) {
  const lines = [
    marker,
    '# LifeOS commercial readiness',
    '',
    '> Generated from repository evidence. Documentation claims do not satisfy implementation or test probes.',
    '',
    `- Commit: \`${report.commit_sha}\``,
    `- Evidence timestamp: \`${report.generated_at}\``,
    `- Weighted maturity: **${report.summary.weighted_maturity_percent}%**`,
    `- Capabilities at target: **${report.summary.at_target}/${report.summary.total_capabilities}**`,
    `- Unresolved buyer gaps: **${report.summary.unresolved_gaps}**`,
    '',
    '## Highest-impact buyer gaps',
    ''
  ];

  if (report.gaps.length === 0) {
    lines.push('No evidence-backed capability gaps remain at the current target levels.');
  } else {
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
        ''
      );
    }
  }

  lines.push('## Pull request drain', '');
  const pulls = Array.isArray(snapshot.pull_requests) ? snapshot.pull_requests : [];
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
        }`
      );
    }
  }

  lines.push(
    '',
    '## Operating rule',
    '',
    'The hourly loop may squash-merge only an exact, same-repository head SHA with every required workflow and status successful, no requested changes, no unresolved review thread, and no base drift. It never uses an administrative bypass.',
    ''
  );
  return `${lines.join('\n')}\n`;
}
