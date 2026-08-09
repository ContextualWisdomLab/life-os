import {
  CommercialDevelopmentContractError,
  normalizeCommercialDevelopmentPolicy,
  validateCommercialDevelopmentIssue,
} from './contracts.mjs';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const UNTRUSTED_TEXT_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const PULL_REQUEST_URL_PATTERN =
  /^https:\/\/github\.com\/ContextualWisdomLab\/life-os\/pull\/([1-9]\d*)$/u;
const ISSUE_REFERENCE_PATTERNS = Object.freeze([
  /(?:^|[^0-9])#([1-9]\d*)(?=$|[^0-9])/gu,
  /ContextualWisdomLab\/life-os#([1-9]\d*)(?=$|[^0-9])/gu,
  /https:\/\/github\.com\/ContextualWisdomLab\/life-os\/issues\/([1-9]\d*)(?=$|[^0-9])/gu,
]);
const PROHIBITED_INTENT_PATTERNS = Object.freeze([
  /\b(?:print|expose|read|steal|leak)\b[\s\S]{0,80}\b(?:secret|token|credential|api key)\b/iu,
  /\b(?:disable|remove|weaken|bypass)\b[\s\S]{0,80}\b(?:branch protection|check|review|security gate)\b/iu,
  /\b(?:administrative|admin)\s+merge\b|\bforce\s+push\b/iu,
  /\b(?:enable|change|modify)\b[\s\S]{0,40}\bbilling\b/iu,
  /\b(?:change|make|set)\b[\s\S]{0,60}\brepository\b[\s\S]{0,40}\b(?:public|private|visibility)\b/iu,
  /\b(?:deploy|release|publish)\b[\s\S]{0,40}\bproduction\b/iu,
  /\b(?:drop\s+(?:database|schema)|truncate\s+table|delete\s+all|erase\s+all)\b/iu,
]);

/** Stable selection failure that never retains issue or pull-request text. */
export class CommercialDevelopmentSelectionError extends Error {
  /** Creates one credential-free bounded-evidence failure. */
  constructor() {
    super('Commercial development issue evidence is invalid');
    this.name = 'CommercialDevelopmentSelectionError';
  }
}

/** Throws the stable selection failure. */
function invalid() {
  throw new CommercialDevelopmentSelectionError();
}

/** Returns whether a value is a non-array record. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires one bounded open pull-request projection. */
function validatePullRequest(value, policy) {
  if (!isRecord(value)) {
    return invalid();
  }
  const expected = new Set(['number', 'url', 'title', 'body', 'state']);
  const keys = Object.keys(value);
  if (
    keys.length !== expected.size ||
    keys.some((key) => !expected.has(key)) ||
    !Number.isSafeInteger(value.number) ||
    value.number < 1 ||
    value.number > 1_000_000_000 ||
    value.state !== 'open' ||
    typeof value.url !== 'string' ||
    PULL_REQUEST_URL_PATTERN.exec(value.url)?.[1] !== String(value.number) ||
    typeof value.title !== 'string' ||
    value.title.trim() !== value.title ||
    value.title.length === 0 ||
    Buffer.byteLength(value.title, 'utf8') > policy.maximum_issue_title_bytes ||
    typeof value.body !== 'string' ||
    Buffer.byteLength(value.body, 'utf8') > policy.maximum_issue_body_bytes ||
    CONTROL_CHARACTER_PATTERN.test(value.title) ||
    UNTRUSTED_TEXT_CONTROL_CHARACTER_PATTERN.test(value.body)
  ) {
    return invalid();
  }
  return Object.freeze({
    number: value.number,
    url: value.url,
    title: value.title,
    body: value.body,
    state: 'open',
  });
}

/** Returns whether issue text requests authority outside the initial slice. */
function requestsProhibitedAuthority(issue) {
  const text = `${issue.title}\n${issue.body}`.normalize('NFKC');
  return PROHIBITED_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Returns whether fixed-shape reference text names the exact issue number. */
function textReferencesIssue(text, issueNumber) {
  const expected = String(issueNumber);
  return ISSUE_REFERENCE_PATTERNS.some((pattern) =>
    [...text.matchAll(pattern)].some((match) => match[1] === expected),
  );
}

/** Returns whether one open pull request references an issue. */
function pullRequestReferencesIssue(pullRequest, issueNumber) {
  return textReferencesIssue(
    `${pullRequest.title}\n${pullRequest.body}`,
    issueNumber,
  );
}

/**
 * Selects one explicitly allowlisted buyer-visible issue from bounded GitHub
 * evidence. Untrusted issue text can never expand the repository policy.
 */
export function selectCommercialDevelopmentIssue(value) {
  try {
    if (!isRecord(value)) {
      return invalid();
    }
    const expected = new Set(['issues', 'openPullRequests', 'policy']);
    const keys = Object.keys(value);
    if (
      keys.length !== expected.size ||
      keys.some((key) => !expected.has(key))
    ) {
      return invalid();
    }
    const policy = normalizeCommercialDevelopmentPolicy(value.policy);
    if (
      !Array.isArray(value.issues) ||
      value.issues.length > policy.maximum_open_issues ||
      !Array.isArray(value.openPullRequests) ||
      value.openPullRequests.length > policy.maximum_open_pull_requests
    ) {
      return invalid();
    }
    const issues = value.issues.map((issue) =>
      validateCommercialDevelopmentIssue(issue, policy),
    );
    const pullRequests = value.openPullRequests.map((pullRequest) =>
      validatePullRequest(pullRequest, policy),
    );
    const titleOrder = new Map(
      policy.eligible_issue_titles.map((title, index) => [title, index]),
    );
    const candidates = issues
      .filter((issue) => titleOrder.has(issue.title))
      .filter((issue) => !policy.excluded_issue_numbers.includes(issue.number))
      .filter((issue) => !requestsProhibitedAuthority(issue))
      .filter(
        (issue) =>
          !pullRequests.some((pullRequest) =>
            pullRequestReferencesIssue(pullRequest, issue.number),
          ),
      )
      .sort(
        (left, right) =>
          titleOrder.get(left.title) - titleOrder.get(right.title) ||
          left.number - right.number,
      );
    return candidates[0];
  } catch (error) {
    if (error instanceof CommercialDevelopmentSelectionError) {
      throw error;
    }
    if (error instanceof CommercialDevelopmentContractError) {
      return invalid();
    }
    return invalid();
  }
}
