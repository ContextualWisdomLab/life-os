/** Canonical 40-hex Git commit identity required for exact-head evidence. */
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
/** GitHub success state accepted as passing workflow or status evidence. */
const SUCCESS = 'success';
/** Review states that can grant or revoke merge approval authority. */
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED']);

/**
 * Reduce untrusted GitHub review records to the latest valid decisive review per actor.
 *
 * Non-array input, missing records, non-decisive states, blank reviewer identities, and
 * invalid or missing submission timestamps are excluded. When one actor has multiple
 * decisive reviews, the chronologically latest valid review wins; equal timestamps use
 * the later record in input order.
 *
 * @param {unknown} reviews Untrusted review records collected for one pull request.
 * @returns {Map<string, {state: string, timestamp: number}>} Latest decisive review by normalized actor.
 */
function latestReviewsByActor(reviews) {
  const latest = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    if (
      !review ||
      typeof review.actor !== 'string' ||
      !DECISIVE_REVIEW_STATES.has(review.state)
    ) {
      continue;
    }
    const actor = review.actor.trim();
    const timestamp = Date.parse(review.submitted_at ?? '');
    if (!actor || !Number.isFinite(timestamp)) continue;
    const current = latest.get(actor);
    if (!current || timestamp >= current.timestamp) {
      latest.set(actor, { state: review.state, timestamp });
    }
  }
  return latest;
}

/**
 * Evaluate exact-head workflow evidence for one required workflow name.
 *
 * @param {object} pr Pull-request snapshot containing exact-head workflow runs.
 * @param {string} requiredName Required workflow display name.
 * @returns {{blocker?: string}} Empty evidence on success or one fail-closed blocker.
 */
function workflowEvidence(pr, requiredName) {
  const named = (Array.isArray(pr.workflows) ? pr.workflows : []).filter(
    (item) => item?.name === requiredName,
  );
  if (named.length === 0)
    return { blocker: `missing-workflow:${requiredName}` };
  const matchingHead = named.filter((item) => item.head_sha === pr.head_sha);
  if (matchingHead.length === 0) return { blocker: 'stale-check-evidence' };
  const successful = matchingHead.some(
    (item) => item.status === 'completed' && item.conclusion === SUCCESS,
  );
  return successful
    ? {}
    : { blocker: `workflow-not-successful:${requiredName}` };
}

/**
 * Evaluate exact-head commit-status evidence for one required status context.
 *
 * @param {object} pr Pull-request snapshot containing exact-head commit statuses.
 * @param {string} requiredContext Required status context.
 * @returns {{blocker?: string}} Empty evidence on success or one fail-closed blocker.
 */
function statusEvidence(pr, requiredContext) {
  const named = (Array.isArray(pr.statuses) ? pr.statuses : []).filter(
    (item) => item?.context === requiredContext,
  );
  if (named.length === 0)
    return { blocker: `missing-status:${requiredContext}` };
  const matchingHead = named.filter((item) => item.sha === pr.head_sha);
  if (matchingHead.length === 0) return { blocker: 'stale-check-evidence' };
  return matchingHead.some((item) => item.state === SUCCESS)
    ? {}
    : { blocker: `status-not-successful:${requiredContext}` };
}

/**
 * Evaluate a collected pull-request snapshot against the active local merge policy.
 *
 * The decision fails closed for malformed PR identity, wrong repository/base provenance,
 * merge conflicts or stale base ancestry, unresolved review threads, missing decisive
 * approval, any latest decisive change request, and missing/stale/non-successful required
 * workflow or status evidence. Reviewer records with invalid actor or timestamp evidence
 * never contribute to approval. `eligible` is true only when the de-duplicated `blockers`
 * array is empty.
 *
 * @param {object} pr Collected pull-request evidence for one exact head.
 * @param {{default_branch: string, required_workflows: string[], required_statuses: string[]}} policy Active merge policy.
 * @returns {{eligible: boolean, blockers: string[]}} Fail-closed merge decision and blocker codes.
 */
export function evaluatePullRequestForMerge(pr, policy) {
  const blockers = [];
  if (!pr || typeof pr !== 'object') {
    return { eligible: false, blockers: ['invalid-pr'] };
  }
  if (pr.state !== 'open') blockers.push('not-open');
  if (pr.draft === true) blockers.push('draft');
  // Branch provenance, not the PR opener's mutable public association label,
  // defines source trust. Forks remain categorically ineligible, while an
  // exact branch already inside the governed repository must still satisfy
  // every current-head workflow, review, base-freshness, and thread gate below.
  if (pr.repository !== pr.head_repo) blockers.push('fork');
  if (pr.base_ref !== policy.default_branch) blockers.push('wrong-base');
  if (!SHA_PATTERN.test(pr.head_sha ?? '')) blockers.push('invalid-head');
  if (
    pr.mergeable !== true ||
    ['dirty', 'blocked', 'unknown'].includes(pr.mergeable_state)
  ) {
    blockers.push('merge-conflict');
  }
  if (pr.behind_by !== 0 || pr.mergeable_state === 'behind') {
    blockers.push('base-out-of-date');
  }
  if (!Number.isSafeInteger(pr.unresolved_threads)) {
    blockers.push('review-thread-state-unknown');
  } else if (pr.unresolved_threads > 0) {
    blockers.push('unresolved-review-thread');
  }

  const decisiveReviews = latestReviewsByActor(pr.reviews);
  let hasApproval = false;
  for (const review of decisiveReviews.values()) {
    if (review.state === 'APPROVED') hasApproval = true;
    if (review.state === 'CHANGES_REQUESTED') {
      blockers.push('changes-requested');
    }
  }
  if (!hasApproval) blockers.push('missing-approval');

  for (const workflow of policy.required_workflows) {
    const evidence = workflowEvidence(pr, workflow);
    if (evidence.blocker) blockers.push(evidence.blocker);
  }
  for (const context of policy.required_statuses) {
    const evidence = statusEvidence(pr, context);
    if (evidence.blocker) blockers.push(evidence.blocker);
  }

  const unique = [...new Set(blockers)];
  return { eligible: unique.length === 0, blockers: unique };
}
