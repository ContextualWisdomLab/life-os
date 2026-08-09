const REGISTRY_SCHEMA = 'life-os.commercial-buyer-gaps.v1';
const SNAPSHOT_SCHEMA = 'life-os.commercial-buyer-gap-snapshot.v1';
const GAP_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_GAPS = 100;
const MAX_CAPABILITIES_PER_GAP = 25;
const MAX_LABELS = 50;
const MAX_LABEL_LENGTH = 100;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowed.has(key));
}

function failRegistry(detail = '') {
  throw new Error(`Invalid buyer gap registry${detail ? `: ${detail}` : ''}`);
}

function failSnapshot(detail = '') {
  throw new Error(`Invalid buyer gap snapshot${detail ? `: ${detail}` : ''}`);
}

function normalizeGapId(value) {
  if (typeof value !== 'string' || !GAP_ID_PATTERN.test(value) || value.length > 100) {
    failRegistry('invalid gap id');
  }
  return value;
}

function normalizeIssueNumber(value, fail = failRegistry) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail('invalid issue number');
  }
  return value;
}

function manifestCapabilityIds(manifest) {
  if (!isPlainObject(manifest) || !Array.isArray(manifest.capabilities)) {
    failRegistry('invalid capability manifest');
  }
  const ids = new Set();
  for (const capability of manifest.capabilities) {
    const id = capability?.id;
    if (typeof id !== 'string' || !CAPABILITY_ID_PATTERN.test(id)) {
      failRegistry('invalid capability manifest');
    }
    ids.add(id);
  }
  return ids;
}

/**
 * Validates repository-owned buyer-gap policy independently from capability
 * maturity. GitHub issue title/body text is never executable product policy.
 */
export function validateBuyerGapRegistry(value, manifest) {
  if (
    !exactKeys(value, new Set(['schema', 'gaps'])) ||
    value.schema !== REGISTRY_SCHEMA ||
    !Array.isArray(value.gaps) ||
    value.gaps.length === 0 ||
    value.gaps.length > MAX_GAPS
  ) {
    failRegistry();
  }

  const knownCapabilities = manifestCapabilityIds(manifest);
  const gapIds = new Set();
  const issueNumbers = new Set();
  const gaps = value.gaps.map((entry) => {
    if (!exactKeys(entry, new Set(['gap_id', 'issue_number', 'capability_ids']))) {
      failRegistry('invalid gap entry');
    }
    const gapId = normalizeGapId(entry.gap_id);
    const issueNumber = normalizeIssueNumber(entry.issue_number);
    if (gapIds.has(gapId)) failRegistry('duplicate gap id');
    if (issueNumbers.has(issueNumber)) failRegistry('duplicate canonical issue');
    gapIds.add(gapId);
    issueNumbers.add(issueNumber);

    if (
      !Array.isArray(entry.capability_ids) ||
      entry.capability_ids.length === 0 ||
      entry.capability_ids.length > MAX_CAPABILITIES_PER_GAP
    ) {
      failRegistry('invalid capability collection');
    }
    const capabilityIds = entry.capability_ids.map((capabilityId) => {
      if (
        typeof capabilityId !== 'string' ||
        !CAPABILITY_ID_PATTERN.test(capabilityId) ||
        !knownCapabilities.has(capabilityId)
      ) {
        failRegistry('unknown or invalid capability id');
      }
      return capabilityId;
    });
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      failRegistry('duplicate capability id');
    }

    return Object.freeze({
      gap_id: gapId,
      issue_number: issueNumber,
      capability_ids: Object.freeze([...capabilityIds]),
    });
  });

  return Object.freeze({
    schema: REGISTRY_SCHEMA,
    gaps: Object.freeze(gaps),
  });
}

function normalizeLabel(value) {
  const label =
    typeof value === 'string'
      ? value
      : isPlainObject(value) && typeof value.name === 'string'
        ? value.name
        : null;
  if (
    label === null ||
    !label.trim() ||
    label.length > MAX_LABEL_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(label)
  ) {
    failSnapshot('invalid issue label');
  }
  return label.trim();
}

function normalizeIssueEvidence(value) {
  if (
    !exactKeys(
      value,
      new Set(['number', 'state', 'state_reason', 'labels']),
    )
  ) {
    failSnapshot('invalid issue evidence');
  }
  const number = normalizeIssueNumber(value.number, failSnapshot);
  if (!['open', 'closed', 'unknown'].includes(value.state)) {
    failSnapshot('invalid issue state');
  }
  const stateReason = value.state_reason;
  if (
    stateReason !== null &&
    stateReason !== undefined &&
    !['completed', 'not_planned', 'reopened'].includes(stateReason)
  ) {
    failSnapshot('invalid issue state reason');
  }
  if (!Array.isArray(value.labels) || value.labels.length > MAX_LABELS) {
    failSnapshot('invalid issue labels');
  }
  const labels = value.labels.map(normalizeLabel);
  if (new Set(labels).size !== labels.length) {
    failSnapshot('duplicate issue label');
  }
  return Object.freeze({
    number,
    state: value.state,
    state_reason: stateReason ?? null,
    labels: Object.freeze(labels),
  });
}

/** Validates the minimal live issue-state projection used by buyer-gap policy. */
export function validateBuyerGapSnapshot(value) {
  if (
    !exactKeys(
      value,
      new Set(['schema', 'repository', 'generated_at', 'issues']),
    ) ||
    value.schema !== SNAPSHOT_SCHEMA ||
    typeof value.repository !== 'string' ||
    !REPOSITORY_PATTERN.test(value.repository) ||
    typeof value.generated_at !== 'string' ||
    !Number.isFinite(Date.parse(value.generated_at)) ||
    !Array.isArray(value.issues) ||
    value.issues.length > MAX_GAPS
  ) {
    failSnapshot();
  }
  const issues = value.issues.map(normalizeIssueEvidence);
  const seen = new Set();
  for (const issue of issues) {
    if (seen.has(issue.number)) failSnapshot('duplicate issue evidence');
    seen.add(issue.number);
  }
  return Object.freeze({
    schema: SNAPSHOT_SCHEMA,
    repository: value.repository,
    generated_at: new Date(value.generated_at).toISOString(),
    issues: Object.freeze(issues),
  });
}

function projectedLabels(rawLabels) {
  if (!Array.isArray(rawLabels) || rawLabels.length > MAX_LABELS) return [];
  const labels = [];
  for (const rawLabel of rawLabels) {
    const label =
      typeof rawLabel === 'string'
        ? rawLabel
        : isPlainObject(rawLabel) && typeof rawLabel.name === 'string'
          ? rawLabel.name
          : null;
    if (
      label === null ||
      !label.trim() ||
      label.length > MAX_LABEL_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(label)
    ) {
      continue;
    }
    labels.push(label.trim());
  }
  return [...new Set(labels)].sort();
}

/**
 * Collects only the registered issue states. Individual fetch failures become
 * explicit unknown evidence instead of silently resolving a product gap.
 */
export async function collectBuyerGapSnapshot(
  client,
  repository,
  registry,
  generatedAt = new Date().toISOString(),
) {
  if (
    !client ||
    typeof client.requestJson !== 'function' ||
    typeof repository !== 'string' ||
    !REPOSITORY_PATTERN.test(repository) ||
    typeof generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    !registry ||
    registry.schema !== REGISTRY_SCHEMA ||
    !Array.isArray(registry.gaps)
  ) {
    throw new Error('Buyer gap snapshot collection input is invalid');
  }

  const issues = [];
  for (const gap of [...registry.gaps].sort(
    (left, right) => left.issue_number - right.issue_number,
  )) {
    try {
      const issue = await client.requestJson(
        `/repos/${repository}/issues/${gap.issue_number}`,
      );
      if (issue?.pull_request) {
        issues.push({
          number: gap.issue_number,
          state: 'unknown',
          state_reason: null,
          labels: [],
        });
        continue;
      }
      issues.push({
        number: gap.issue_number,
        state: issue?.state === 'open' || issue?.state === 'closed' ? issue.state : 'unknown',
        state_reason:
          issue?.state_reason === 'completed' ||
          issue?.state_reason === 'not_planned' ||
          issue?.state_reason === 'reopened'
            ? issue.state_reason
            : null,
        labels: projectedLabels(issue?.labels),
      });
    } catch {
      issues.push({
        number: gap.issue_number,
        state: 'unknown',
        state_reason: null,
        labels: [],
      });
    }
  }

  return validateBuyerGapSnapshot({
    schema: SNAPSHOT_SCHEMA,
    repository,
    generated_at: generatedAt,
    issues,
  });
}

function resolutionFor(issue) {
  const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
  if (labels.has('duplicate')) return 'duplicate';
  if (issue.state_reason === 'completed') return 'completed';
  if (issue.state_reason === 'not_planned') return 'not_planned';
  return null;
}

function gapEvidence(gap, state, resolution = null) {
  return {
    gap_id: gap.gap_id,
    issue_number: gap.issue_number,
    capability_ids: [...gap.capability_ids],
    state,
    resolution,
  };
}

/**
 * Reconciles canonical product policy with bounded live issue state. Open gaps
 * remain unresolved; missing or ambiguous evidence remains explicit unknown.
 */
export function evaluateBuyerGaps(registry, snapshot) {
  const issues = new Map(
    (Array.isArray(snapshot?.issues) ? snapshot.issues : []).map((issue) => [
      issue.number,
      issue,
    ]),
  );
  const unresolved = [];
  const resolved = [];
  const unknown = [];

  for (const gap of [...registry.gaps].sort((left, right) =>
    left.gap_id.localeCompare(right.gap_id),
  )) {
    const issue = issues.get(gap.issue_number);
    if (!issue || issue.state === 'unknown') {
      unknown.push(gapEvidence(gap, 'unknown'));
      continue;
    }
    if (issue.state === 'open') {
      unresolved.push(gapEvidence(gap, 'open'));
      continue;
    }
    const resolution = resolutionFor(issue);
    if (issue.state === 'closed' && resolution !== null) {
      resolved.push(gapEvidence(gap, 'closed', resolution));
      continue;
    }
    unknown.push(gapEvidence(gap, 'unknown'));
  }

  const byIssue = (left, right) =>
    left.issue_number - right.issue_number || left.gap_id.localeCompare(right.gap_id);
  unresolved.sort(byIssue);
  resolved.sort(byIssue);
  unknown.sort(byIssue);
  return { unresolved, resolved, unknown };
}

/** Throws the stable boundary error used for malformed attached gap evidence. */
function failBuyerGapEvidence() {
  throw new Error('Buyer gap evidence is invalid');
}

/**
 * Validates and freezes one attached gap item for its owning evidence collection.
 * The item must use exact buyer-gap keys, bounded identifiers, unique capability
 * identifiers, the expected state, and a state-compatible resolution; otherwise
 * the stable buyer-gap evidence validation error is thrown.
 */
function normalizeAttachedGapEvidence(value, expectedState) {
  if (
    !exactKeys(
      value,
      new Set(['gap_id', 'issue_number', 'capability_ids', 'state', 'resolution']),
    ) ||
    typeof value.gap_id !== 'string' ||
    !GAP_ID_PATTERN.test(value.gap_id) ||
    value.gap_id.length > 100 ||
    value.state !== expectedState ||
    !Array.isArray(value.capability_ids) ||
    value.capability_ids.length === 0 ||
    value.capability_ids.length > MAX_CAPABILITIES_PER_GAP
  ) {
    failBuyerGapEvidence();
  }

  const issueNumber = normalizeIssueNumber(
    value.issue_number,
    failBuyerGapEvidence,
  );
  const capabilityIds = value.capability_ids.map((capabilityId) => {
    if (
      typeof capabilityId !== 'string' ||
      !CAPABILITY_ID_PATTERN.test(capabilityId)
    ) {
      failBuyerGapEvidence();
    }
    return capabilityId;
  });
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    failBuyerGapEvidence();
  }

  const validResolution =
    expectedState === 'closed'
      ? ['completed', 'not_planned', 'duplicate'].includes(value.resolution)
      : value.resolution === null;
  if (!validResolution) {
    failBuyerGapEvidence();
  }

  return Object.freeze({
    gap_id: value.gap_id,
    issue_number: issueNumber,
    capability_ids: Object.freeze([...capabilityIds]),
    state: expectedState,
    resolution: value.resolution,
  });
}

/**
 * Validates the three attached evidence collections as one bounded gap set.
 * Each collection is normalized to its required state, total cardinality is
 * bounded, and duplicate gap or canonical issue ownership fails closed before
 * a readiness report can retain the evidence.
 */
function normalizeBuyerGapEvidence(value) {
  if (
    !exactKeys(value, new Set(['unresolved', 'resolved', 'unknown'])) ||
    !Array.isArray(value.unresolved) ||
    !Array.isArray(value.resolved) ||
    !Array.isArray(value.unknown) ||
    value.unresolved.length > MAX_GAPS ||
    value.resolved.length > MAX_GAPS ||
    value.unknown.length > MAX_GAPS ||
    value.unresolved.length + value.resolved.length + value.unknown.length > MAX_GAPS
  ) {
    failBuyerGapEvidence();
  }

  const unresolved = value.unresolved.map((item) =>
    normalizeAttachedGapEvidence(item, 'open'),
  );
  const resolved = value.resolved.map((item) =>
    normalizeAttachedGapEvidence(item, 'closed'),
  );
  const unknown = value.unknown.map((item) =>
    normalizeAttachedGapEvidence(item, 'unknown'),
  );
  const gapIds = new Set();
  const issueNumbers = new Set();
  for (const item of [...unresolved, ...resolved, ...unknown]) {
    if (gapIds.has(item.gap_id) || issueNumbers.has(item.issue_number)) {
      failBuyerGapEvidence();
    }
    gapIds.add(item.gap_id);
    issueNumbers.add(item.issue_number);
  }

  return Object.freeze({
    unresolved: Object.freeze(unresolved),
    resolved: Object.freeze(resolved),
    unknown: Object.freeze(unknown),
  });
}

/** Adds buyer-gap evidence without reinterpreting capability maturity. */
export function attachBuyerGapEvidence(report, evidence) {
  if (!isPlainObject(report) || !isPlainObject(report.summary)) {
    throw new Error('Commercial readiness report is invalid');
  }
  const normalizedEvidence = normalizeBuyerGapEvidence(evidence);
  return {
    ...report,
    summary: {
      ...report.summary,
      capability_evidence_gaps: report.summary.unresolved_gaps,
      unresolved_buyer_gaps: normalizedEvidence.unresolved.length,
      unknown_buyer_gap_states: normalizedEvidence.unknown.length,
    },
    buyer_gaps: normalizedEvidence.unresolved.map((item) => ({ ...item })),
    buyer_gap_unknown: normalizedEvidence.unknown.map((item) => ({ ...item })),
    buyer_gap_resolved: normalizedEvidence.resolved.map((item) => ({ ...item })),
  };
}
