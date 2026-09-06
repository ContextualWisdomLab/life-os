/** Canonical 40-hex Git commit identity required for exact-head evidence. */
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
/** Canonical UTC timestamp shape emitted by GitHub REST review responses. */
const GITHUB_REVIEW_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** GitHub success state accepted as passing workflow or status evidence. */
const SUCCESS = 'success';
/** Review states that can grant or revoke merge approval authority. */
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED']);
/** GitHub REST pull-request review states understood by this evaluator. */
const KNOWN_REVIEW_STATES = new Set([
  'APPROVED',
  'CHANGES_REQUESTED',
  'COMMENTED',
  'DISMISSED',
  'PENDING',
]);
/** Mergeability states currently emitted by GitHub and understood by this evaluator. */
const KNOWN_MERGEABLE_STATES = new Set([
  'clean',
  'unstable',
  'has_hooks',
  'behind',
  'dirty',
  'blocked',
  'draft',
  'unknown',
]);

/**
 * Parse one GitHub review timestamp only when syntax and Gregorian calendar value are canonical.
 *
 * JavaScript normalizes some impossible ISO-looking dates, such as February 31, into a later
 * calendar date. GitHub review authority must therefore round-trip through `Date` unchanged at
 * the API's documented UTC second precision instead of trusting parser finiteness alone.
 *
 * @param {unknown} value Untrusted `submitted_at` review evidence.
 * @returns {number|null} Epoch milliseconds for canonical GitHub evidence, otherwise null.
 */
function parseCanonicalGitHubReviewTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !GITHUB_REVIEW_TIMESTAMP_PATTERN.test(value)
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const roundTrip = new Date(timestamp).toISOString();
  return roundTrip === `${value.slice(0, -1)}.000Z` ? timestamp : null;
}

/**
 * Reduce untrusted GitHub review records to the latest valid decisive review per actor.
 *
 * Known non-decisive GitHub states are ignored. Missing, malformed, or unknown review states
 * are retained as invalid evidence so an API-contract change cannot silently erase a future
 * decisive state from the merge decision. Decisive records with malformed reviewer identity
 * or submission time are likewise invalid. Review timestamps must preserve GitHub's canonical
 * UTC REST shape and calendar value rather than becoming authority merely because JavaScript can
 * parse or normalize them. Approval records additionally must bind the exact current pull-request
 * head. A later stale approval revokes an older exact-head approval for the same actor, but never
 * clears a current change request; a still-later exact-head approval may supersede that stale
 * approval. GitHub timestamps have finite precision, so equal timestamps use input order for both
 * exact-head and stale approval evidence. This preserves chronological review authority without
 * allowing stale commit evidence to grant approval.
 *
 * @param {unknown} reviews Untrusted review records collected for one pull request.
 * @param {string} headSha Exact current pull-request head that an approval must bind.
 * @returns {{latest: Map<string, {state: string, timestamp: number}>, invalid: boolean}} Latest decisive reviews plus malformed-evidence state.
 */
function latestReviewsByActor(reviews, headSha) {
  const latest = new Map();
  const staleApprovals = new Map();
  let invalid = false;
  const input = Array.isArray(reviews) ? reviews : [];
  for (let reviewOrder = 0; reviewOrder < input.length; reviewOrder += 1) {
    const review = input[reviewOrder];
    if (!review || typeof review !== 'object') {
      invalid = true;
      continue;
    }
    if (
      typeof review.state !== 'string' ||
      !KNOWN_REVIEW_STATES.has(review.state)
    ) {
      invalid = true;
      continue;
    }
    if (!DECISIVE_REVIEW_STATES.has(review.state)) continue;
    if (typeof review.actor !== 'string') {
      invalid = true;
      continue;
    }
    const actor = review.actor.trim();
    const timestamp = parseCanonicalGitHubReviewTimestamp(review.submitted_at);
    if (!actor || timestamp === null) {
      invalid = true;
      continue;
    }
    if (review.state === 'APPROVED' && review.commit_id !== headSha) {
      const currentStale = staleApprovals.get(actor);
      if (
        !currentStale ||
        timestamp > currentStale.timestamp ||
        (timestamp === currentStale.timestamp &&
          reviewOrder > currentStale.order)
      ) {
        staleApprovals.set(actor, { timestamp, order: reviewOrder });
      }
      continue;
    }
    const current = latest.get(actor);
    if (
      !current ||
      timestamp > current.timestamp ||
      (timestamp === current.timestamp && reviewOrder > current.order)
    ) {
      latest.set(actor, { state: review.state, timestamp, order: reviewOrder });
    }
  }
  for (const [actor, stale] of staleApprovals) {
    const current = latest.get(actor);
    if (
      current?.state === 'APPROVED' &&
      (stale.timestamp > current.timestamp ||
        (stale.timestamp === current.timestamp && stale.order > current.order))
    ) {
      latest.delete(actor);
    }
  }
  for (const [actor, current] of latest) {
    latest.set(actor, { state: current.state, timestamp: current.timestamp });
  }
  return { latest, invalid };
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
 * The decision fails closed for malformed PR identity or Draft authority, wrong repository/base
 * provenance, missing or unrecognized mergeability-state evidence, GitHub-reported non-passing
 * commit status, merge conflicts or stale base ancestry, malformed or unresolved review-thread
 * counts, malformed or unknown review authority, missing decisive exact-head approval, any latest
 * decisive change request, and missing/stale/non-successful required workflow or status evidence.
 * Reviewer records with malformed actor or timestamp authority become explicit blockers rather
 * than disappearing from the decision; approvals bound to another commit remain stale.
 * `eligible` is true only when the de-duplicated `blockers` array is empty.
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
  if (typeof pr.draft !== 'boolean') blockers.push('draft-state-unknown');
  if (pr.draft === true || pr.mergeable_state === 'draft')
    blockers.push('draft');
  // Branch provenance, not the PR opener's mutable public association label,
  // defines source trust. Forks remain categorically ineligible, while an
  // exact branch already inside the governed repository must still satisfy
  // every current-head workflow, review, base-freshness, and thread gate below.
  if (pr.repository !== pr.head_repo) blockers.push('fork');
  if (pr.base_ref !== policy.default_branch) blockers.push('wrong-base');
  if (!SHA_PATTERN.test(pr.head_sha ?? '')) blockers.push('invalid-head');
  if (!KNOWN_MERGEABLE_STATES.has(pr.mergeable_state)) {
    blockers.push('merge-state-unknown');
  }
  if (pr.mergeable_state === 'unstable') {
    blockers.push('merge-state-not-passing');
  }
  if (
    pr.mergeable !== true ||
    ['dirty', 'blocked', 'unknown'].includes(pr.mergeable_state)
  ) {
    blockers.push('merge-conflict');
  }
  if (pr.behind_by !== 0 || pr.mergeable_state === 'behind') {
    blockers.push('base-out-of-date');
  }
  if (
    !Number.isSafeInteger(pr.unresolved_threads) ||
    pr.unresolved_threads < 0
  ) {
    blockers.push('review-thread-state-unknown');
  } else if (pr.unresolved_threads > 0) {
    blockers.push('unresolved-review-thread');
  }

  const decisiveReviewEvidence = latestReviewsByActor(pr.reviews, pr.head_sha);
  if (decisiveReviewEvidence.invalid) {
    blockers.push('review-evidence-invalid');
  }
  let hasApproval = false;
  for (const review of decisiveReviewEvidence.latest.values()) {
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
