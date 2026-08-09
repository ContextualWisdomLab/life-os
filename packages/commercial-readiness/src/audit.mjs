import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { MATURITY_LEVELS, MATURITY_RANK } from './schema.mjs';

const REPORT_SCHEMA = 'life-os.commercial-readiness-report.v1';
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const MAXIMUM_OPEN_ISSUES = 1000;
const MAXIMUM_ISSUE_TITLE_LENGTH = 300;
const MAXIMUM_REGISTERED_PRODUCT_GAPS = 100;

function ensureInsideRoot(rootDir, relativePath) {
  const root = resolve(rootDir);
  const candidate = resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error('Evidence path escaped the repository root');
  }
  return candidate;
}

async function ensureResolvedInsideRoot(rootDir, candidate) {
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(resolve(rootDir)),
    realpath(candidate),
  ]);
  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new Error('Evidence path escaped the repository root');
  }
  return resolvedCandidate;
}

async function evaluateEvidence(rootDir, evidence) {
  const candidate = ensureInsideRoot(rootDir, evidence.path);
  try {
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      return { ...evidence, status: 'unreadable' };
    }
    if (metadata.size > evidence.max_bytes) {
      return { ...evidence, status: 'unreadable' };
    }
    const fullPath = await ensureResolvedInsideRoot(rootDir, candidate);
    if (evidence.mode === 'exists') {
      return { ...evidence, status: 'satisfied' };
    }
    const content = await readFile(fullPath, 'utf8');
    const contains = content.includes(evidence.value);
    const satisfied = evidence.mode === 'contains' ? contains : !contains;
    return { ...evidence, status: satisfied ? 'satisfied' : 'mismatch' };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { ...evidence, status: 'missing' };
    }
    return { ...evidence, status: 'unreadable' };
  }
}

function observedMaturity(evidenceResults) {
  let observed = 'missing';
  for (const maturity of MATURITY_LEVELS.slice(1)) {
    const exact = evidenceResults.filter((item) => item.maturity === maturity);
    if (exact.length === 0) continue;
    const required = evidenceResults.filter(
      (item) => MATURITY_RANK[item.maturity] <= MATURITY_RANK[maturity],
    );
    if (required.every((item) => item.status === 'satisfied'))
      observed = maturity;
  }
  return observed;
}

function transitiveDependents(capabilities, targetId) {
  const dependents = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const capability of capabilities) {
      if (capability.id === targetId || dependents.has(capability.id)) continue;
      if (
        capability.dependencies.includes(targetId) ||
        capability.dependencies.some((dependency) => dependents.has(dependency))
      ) {
        dependents.add(capability.id);
        changed = true;
      }
    }
  }
  return dependents.size;
}

function gapPriority(capability, observed, dependentCount) {
  const maturityDistance = Math.max(
    0,
    MATURITY_RANK[capability.target_maturity] - MATURITY_RANK[observed],
  );
  return (
    capability.customer_impact * 20 +
    capability.risk * 15 +
    capability.acquisition_impact * 15 +
    dependentCount * 8 +
    maturityDistance * 12 -
    capability.effort * 5
  );
}

function missingEvidenceForTarget(capability, evidenceResults) {
  const targetRank = MATURITY_RANK[capability.target_maturity];
  return [
    ...new Set(
      evidenceResults
        .filter(
          (item) =>
            MATURITY_RANK[item.maturity] <= targetRank &&
            item.status !== 'satisfied',
        )
        .map((item) => item.path),
    ),
  ].sort();
}

function indexOpenIssues(openIssues) {
  if (!Array.isArray(openIssues) || openIssues.length > MAXIMUM_OPEN_ISSUES) {
    throw new Error('Open issue snapshot is invalid');
  }
  const indexed = new Map();
  for (const issue of openIssues) {
    if (
      !issue ||
      typeof issue !== 'object' ||
      !Number.isSafeInteger(issue.number) ||
      issue.number <= 0 ||
      issue.state !== 'open' ||
      typeof issue.title !== 'string' ||
      !issue.title.trim() ||
      issue.title.length > MAXIMUM_ISSUE_TITLE_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(issue.title) ||
      indexed.has(issue.number)
    ) {
      throw new Error('Open issue snapshot is invalid');
    }
    indexed.set(issue.number, issue.title.trim());
  }
  return indexed;
}

function normalizeRegisteredProductGaps(registeredProductGaps, capabilities) {
  if (
    !Array.isArray(registeredProductGaps) ||
    registeredProductGaps.length > MAXIMUM_REGISTERED_PRODUCT_GAPS
  ) {
    throw new Error('Registered product gaps are invalid');
  }
  const capabilityIds = new Set(capabilities.map((capability) => capability.id));
  const seenCapabilities = new Set();
  const seenIssues = new Set();
  return registeredProductGaps.map((gap) => {
    if (
      !gap ||
      typeof gap !== 'object' ||
      typeof gap.capability_id !== 'string' ||
      !capabilityIds.has(gap.capability_id) ||
      !Number.isSafeInteger(gap.tracking_issue) ||
      gap.tracking_issue <= 0 ||
      seenCapabilities.has(gap.capability_id) ||
      seenIssues.has(gap.tracking_issue)
    ) {
      throw new Error('Registered product gaps are invalid');
    }
    seenCapabilities.add(gap.capability_id);
    seenIssues.add(gap.tracking_issue);
    return {
      capability_id: gap.capability_id,
      tracking_issue: gap.tracking_issue,
    };
  });
}

export async function evaluateCapabilities(
  manifest,
  {
    rootDir,
    generatedAt,
    commitSha,
    openIssues = [],
    registeredProductGaps = [],
  },
) {
  if (typeof rootDir !== 'string' || !rootDir)
    throw new Error('Repository root is required');
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Generated timestamp is invalid');
  }
  if (!COMMIT_SHA_PATTERN.test(commitSha))
    throw new Error('Commit SHA is invalid');
  const openIssueIndex = indexOpenIssues(openIssues);

  const capabilities = [];
  for (const capability of manifest.capabilities) {
    const evidence = [];
    for (const item of capability.evidence) {
      evidence.push(await evaluateEvidence(rootDir, item));
    }
    const observed = observedMaturity(evidence);
    capabilities.push({
      id: capability.id,
      outcome: capability.outcome,
      target_maturity: capability.target_maturity,
      observed_maturity: observed,
      customer_impact: capability.customer_impact,
      risk: capability.risk,
      acquisition_impact: capability.acquisition_impact,
      effort: capability.effort,
      dependencies: [...capability.dependencies],
      tracking_issue: capability.tracking_issue,
      evidence,
    });
  }

  const gaps = capabilities
    .filter(
      (capability) =>
        MATURITY_RANK[capability.observed_maturity] <
        MATURITY_RANK[capability.target_maturity],
    )
    .map((capability) => {
      const source = manifest.capabilities.find(
        (item) => item.id === capability.id,
      );
      const dependents = transitiveDependents(
        manifest.capabilities,
        capability.id,
      );
      return {
        capability_id: capability.id,
        outcome: capability.outcome,
        observed_maturity: capability.observed_maturity,
        target_maturity: capability.target_maturity,
        priority_score: gapPriority(
          source,
          capability.observed_maturity,
          dependents,
        ),
        dependent_capabilities: dependents,
        tracking_issue: capability.tracking_issue,
        missing_evidence: missingEvidenceForTarget(source, capability.evidence),
      };
    })
    .sort(
      (left, right) =>
        right.priority_score - left.priority_score ||
        left.capability_id.localeCompare(right.capability_id),
    );

  const registeredGaps = normalizeRegisteredProductGaps(
    registeredProductGaps,
    capabilities,
  );
  const productGaps = registeredGaps
    .filter((gap) => openIssueIndex.has(gap.tracking_issue))
    .map((gap) => {
      const capability = capabilities.find(
        (item) => item.id === gap.capability_id,
      );
      const source = manifest.capabilities.find(
        (item) => item.id === gap.capability_id,
      );
      const dependents = transitiveDependents(
        manifest.capabilities,
        gap.capability_id,
      );
      return {
        capability_id: capability.id,
        outcome: capability.outcome,
        tracking_issue: gap.tracking_issue,
        issue_title: openIssueIndex.get(gap.tracking_issue),
        priority_score: gapPriority(
          source,
          capability.observed_maturity,
          dependents,
        ),
      };
    })
    .sort(
      (left, right) =>
        right.priority_score - left.priority_score ||
        left.capability_id.localeCompare(right.capability_id),
    );

  let weightedObserved = 0;
  let weightedTarget = 0;
  for (const capability of capabilities) {
    const observedRank = MATURITY_RANK[capability.observed_maturity];
    const targetRank = MATURITY_RANK[capability.target_maturity];
    weightedObserved +=
      Math.min(observedRank, targetRank) * capability.customer_impact;
    weightedTarget += targetRank * capability.customer_impact;
  }

  const unresolvedCapabilityIds = new Set([
    ...gaps.map((gap) => gap.capability_id),
    ...productGaps.map((gap) => gap.capability_id),
  ]);

  return {
    schema: REPORT_SCHEMA,
    generated_at: new Date(generatedAt).toISOString(),
    commit_sha: commitSha.toLowerCase(),
    summary: {
      total_capabilities: capabilities.length,
      at_target: capabilities.length - gaps.length,
      configured_evidence_gaps: gaps.length,
      open_product_gaps: productGaps.length,
      unresolved_gaps: unresolvedCapabilityIds.size,
      weighted_maturity_percent:
        weightedTarget === 0
          ? 100
          : Math.round((weightedObserved / weightedTarget) * 100),
    },
    capabilities,
    gaps,
    product_gaps: productGaps,
  };
}
