import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { MATURITY_LEVELS, MATURITY_RANK } from './schema.mjs';

const REPORT_SCHEMA = 'life-os.commercial-readiness-report.v1';
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

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
    realpath(candidate)
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
      (item) => MATURITY_RANK[item.maturity] <= MATURITY_RANK[maturity]
    );
    if (required.every((item) => item.status === 'satisfied')) observed = maturity;
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
    MATURITY_RANK[capability.target_maturity] - MATURITY_RANK[observed]
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
            MATURITY_RANK[item.maturity] <= targetRank && item.status !== 'satisfied'
        )
        .map((item) => item.path)
    )
  ].sort();
}

export async function evaluateCapabilities(
  manifest,
  { rootDir, generatedAt, commitSha }
) {
  if (typeof rootDir !== 'string' || !rootDir) throw new Error('Repository root is required');
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Generated timestamp is invalid');
  }
  if (!COMMIT_SHA_PATTERN.test(commitSha)) throw new Error('Commit SHA is invalid');

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
      evidence
    });
  }

  const gaps = capabilities
    .filter(
      (capability) =>
        MATURITY_RANK[capability.observed_maturity] <
        MATURITY_RANK[capability.target_maturity]
    )
    .map((capability) => {
      const source = manifest.capabilities.find((item) => item.id === capability.id);
      const dependents = transitiveDependents(manifest.capabilities, capability.id);
      return {
        capability_id: capability.id,
        outcome: capability.outcome,
        observed_maturity: capability.observed_maturity,
        target_maturity: capability.target_maturity,
        priority_score: gapPriority(source, capability.observed_maturity, dependents),
        dependent_capabilities: dependents,
        tracking_issue: capability.tracking_issue,
        missing_evidence: missingEvidenceForTarget(source, capability.evidence)
      };
    })
    .sort(
      (left, right) =>
        right.priority_score - left.priority_score ||
        left.capability_id.localeCompare(right.capability_id)
    );

  let weightedObserved = 0;
  let weightedTarget = 0;
  for (const capability of capabilities) {
    const observedRank = MATURITY_RANK[capability.observed_maturity];
    const targetRank = MATURITY_RANK[capability.target_maturity];
    weightedObserved += Math.min(observedRank, targetRank) * capability.customer_impact;
    weightedTarget += targetRank * capability.customer_impact;
  }

  return {
    schema: REPORT_SCHEMA,
    generated_at: new Date(generatedAt).toISOString(),
    commit_sha: commitSha.toLowerCase(),
    summary: {
      total_capabilities: capabilities.length,
      at_target: capabilities.length - gaps.length,
      unresolved_gaps: gaps.length,
      weighted_maturity_percent:
        weightedTarget === 0 ? 100 : Math.round((weightedObserved / weightedTarget) * 100)
    },
    capabilities,
    gaps
  };
}
