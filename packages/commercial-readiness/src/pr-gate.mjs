const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SUCCESS = 'success';
const DECISIVE_REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED']);

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
    const timestamp = Date.parse(review.submitted_at ?? '') || 0;
    const current = latest.get(review.actor);
    if (!current || timestamp >= current.timestamp) {
      latest.set(review.actor, { state: review.state, timestamp });
    }
  }
  return latest;
}

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

export function evaluatePullRequestForMerge(pr, policy) {
  const blockers = [];
  if (!pr || typeof pr !== 'object') {
    return { eligible: false, blockers: ['invalid-pr'] };
  }
  if (pr.state !== 'open') blockers.push('not-open');
  if (pr.draft === true) blockers.push('draft');
  if (pr.repository !== pr.head_repo) blockers.push('fork');
  if (!policy.trusted_author_associations.includes(pr.author_association)) {
    blockers.push('untrusted-author');
  }
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

  for (const review of latestReviewsByActor(pr.reviews).values()) {
    if (review.state === 'CHANGES_REQUESTED') {
      blockers.push('changes-requested');
      break;
    }
  }

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
