import { createHash, createHmac, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const MINIMUM_TTL_SECONDS = 30;
const MAXIMUM_ORDINARY_TTL_SECONDS = 900;
const MAXIMUM_BREAK_GLASS_TTL_SECONDS = 300;
const MINIMUM_REASON_CHARACTERS = 20;
const MAXIMUM_REASON_CHARACTERS = 500;
const MAXIMUM_REASON_BYTES = 2_048;
const MINIMUM_DIGEST_KEY_BYTES = 32;
const MAXIMUM_DIGEST_KEY_BYTES = 4_096;
const DISALLOWED_CONTROL_PATTERN = /[\u0000-\u0008\u000a-\u001f\u007f]/u;

/** Stable policy purposes that describe why original personal data is needed. */
export const PRIVACY_ACCESS_PURPOSES = Object.freeze([
  'workspace_operation',
  'account_support',
  'security_investigation',
  'data_subject_request',
  'legal_obligation',
  'break_glass',
] as const);

/** Stable business operations that may be authorized for personal data. */
export const PRIVACY_ACCESS_ACTIONS = Object.freeze([
  'read',
  'export',
  'correct',
  'administer',
] as const);

/** Service-owned categories used instead of field names or copied PII values. */
export const PRIVACY_RESOURCE_CATEGORIES = Object.freeze([
  'identity_profile',
  'planning_content',
  'habit_content',
  'review_content',
  'calendar_content',
  'notification_content',
  'ai_audit_content',
] as const);

/** One reviewed immutable policy revision identifier. */
export const PRIVACY_ACCESS_POLICY_REVISION_ID =
  '7a25c6b5-9fd7-45f3-9bd9-180dbc668c92';

/** Allowed purpose vocabulary. */
export type PrivacyAccessPurpose = (typeof PRIVACY_ACCESS_PURPOSES)[number];
/** Allowed personal-data action vocabulary. */
export type PrivacyAccessAction = (typeof PRIVACY_ACCESS_ACTIONS)[number];
/** Allowed service-level personal-data category vocabulary. */
export type PrivacyResourceCategory =
  (typeof PRIVACY_RESOURCE_CATEGORIES)[number];
/** Distinguishes ordinary processing from emergency access. */
export type PrivacyAccessMode = 'ordinary' | 'break_glass';
/** Stable persisted result of one policy evaluation. */
export type PrivacyAccessOutcome = 'allowed' | 'denied';

/** Untrusted decision input after trusted ownership is attached by the boundary. */
export interface PrivacyAccessRequest {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly purpose: PrivacyAccessPurpose;
  readonly action: PrivacyAccessAction;
  readonly resourceCategory: PrivacyResourceCategory;
  readonly requestedTtlSeconds: number;
  readonly requestedAt: Date;
  readonly reason?: string;
}

/** Deterministic seams and keyed evidence material required by policy evaluation. */
export interface PrivacyAccessEvaluationDependencies {
  readonly uuidFactory?: () => string;
  readonly auditDigestKey: string;
}

/** Immutable metadata recorded for every allowed or denied access decision. */
export interface PrivacyAccessDecision {
  readonly decisionId: string;
  readonly grantId?: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly purpose: PrivacyAccessPurpose;
  readonly action: PrivacyAccessAction;
  readonly resourceCategory: PrivacyResourceCategory;
  readonly accessMode: PrivacyAccessMode;
  readonly outcome: PrivacyAccessOutcome;
  readonly policyRevisionId: string;
  readonly policyDigest: string;
  readonly requestDigest: string;
  readonly reasonDigest: string;
  readonly issuedAt: string;
  readonly expiresAt?: string;
}

/** Stable credential-free failure for malformed access-policy input. */
export class PrivacyAccessValidationError extends Error {
  /** Creates one error without retaining rejected input or secret material. */
  constructor() {
    super('Privacy access request is invalid');
    this.name = 'PrivacyAccessValidationError';
  }
}

interface PolicyRule {
  readonly purpose: PrivacyAccessPurpose;
  readonly actions: readonly PrivacyAccessAction[];
  readonly resourceCategories: readonly PrivacyResourceCategory[];
  readonly reasonRequired: boolean;
}

const ORDINARY_CONTENT_CATEGORIES = Object.freeze([
  'planning_content',
  'habit_content',
  'review_content',
  'calendar_content',
  'notification_content',
] satisfies readonly PrivacyResourceCategory[]);

const PRIVILEGED_CATEGORIES = Object.freeze([
  ...PRIVACY_RESOURCE_CATEGORIES,
] satisfies readonly PrivacyResourceCategory[]);

const POLICY_RULES = Object.freeze([
  Object.freeze({
    purpose: 'workspace_operation',
    actions: Object.freeze(['read', 'correct']),
    resourceCategories: ORDINARY_CONTENT_CATEGORIES,
    reasonRequired: false,
  }),
  Object.freeze({
    purpose: 'account_support',
    actions: Object.freeze(['read']),
    resourceCategories: Object.freeze(['identity_profile']),
    reasonRequired: true,
  }),
  Object.freeze({
    purpose: 'security_investigation',
    actions: Object.freeze(['read']),
    resourceCategories: Object.freeze([
      'identity_profile',
      'notification_content',
      'ai_audit_content',
    ]),
    reasonRequired: true,
  }),
  Object.freeze({
    purpose: 'data_subject_request',
    actions: Object.freeze(['read', 'export']),
    resourceCategories: PRIVILEGED_CATEGORIES,
    reasonRequired: true,
  }),
  Object.freeze({
    purpose: 'legal_obligation',
    actions: Object.freeze(['read', 'export']),
    resourceCategories: PRIVILEGED_CATEGORIES,
    reasonRequired: true,
  }),
  Object.freeze({
    purpose: 'break_glass',
    actions: Object.freeze(['read']),
    resourceCategories: PRIVILEGED_CATEGORIES,
    reasonRequired: true,
  }),
] satisfies readonly PolicyRule[]);

const CANONICAL_POLICY = JSON.stringify({
  schema: 'life-os.privacy-access-policy.v1',
  revisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
  ordinaryMaximumTtlSeconds: MAXIMUM_ORDINARY_TTL_SECONDS,
  breakGlassMaximumTtlSeconds: MAXIMUM_BREAK_GLASS_TTL_SECONDS,
  rules: POLICY_RULES,
});

/** Canonical SHA-256 evidence for the exact reviewed access matrix. */
export const PRIVACY_ACCESS_POLICY_DIGEST = createHash('sha256')
  .update(CANONICAL_POLICY, 'utf8')
  .digest('hex');

function invalid(): never {
  throw new PrivacyAccessValidationError();
}

function codePointLength(value: string): number {
  return [...value].length;
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : invalid();
}

function requirePurpose(value: unknown): PrivacyAccessPurpose {
  return typeof value === 'string' &&
    (PRIVACY_ACCESS_PURPOSES as readonly string[]).includes(value)
    ? (value as PrivacyAccessPurpose)
    : invalid();
}

function requireAction(value: unknown): PrivacyAccessAction {
  return typeof value === 'string' &&
    (PRIVACY_ACCESS_ACTIONS as readonly string[]).includes(value)
    ? (value as PrivacyAccessAction)
    : invalid();
}

function requireResourceCategory(value: unknown): PrivacyResourceCategory {
  return typeof value === 'string' &&
    (PRIVACY_RESOURCE_CATEGORIES as readonly string[]).includes(value)
    ? (value as PrivacyResourceCategory)
    : invalid();
}

function requireDigestKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    DISALLOWED_CONTROL_PATTERN.test(value)
  ) {
    return invalid();
  }
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (
    byteLength < MINIMUM_DIGEST_KEY_BYTES ||
    byteLength > MAXIMUM_DIGEST_KEY_BYTES
  ) {
    return invalid();
  }
  return value;
}

function normalizeReason(value: unknown, required: boolean): string {
  if (value === undefined && !required) {
    return '';
  }
  if (typeof value !== 'string' || DISALLOWED_CONTROL_PATTERN.test(value)) {
    return invalid();
  }
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ');
  if (
    normalized === '' ||
    codePointLength(normalized) < MINIMUM_REASON_CHARACTERS ||
    codePointLength(normalized) > MAXIMUM_REASON_CHARACTERS ||
    Buffer.byteLength(normalized, 'utf8') > MAXIMUM_REASON_BYTES
  ) {
    return invalid();
  }
  return normalized;
}

function requireRequestedAt(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return invalid();
  }
  return new Date(value.getTime());
}

function accessMode(purpose: PrivacyAccessPurpose): PrivacyAccessMode {
  return purpose === 'break_glass' ? 'break_glass' : 'ordinary';
}

function requireTtl(value: unknown, mode: PrivacyAccessMode): number {
  const maximum =
    mode === 'break_glass'
      ? MAXIMUM_BREAK_GLASS_TTL_SECONDS
      : MAXIMUM_ORDINARY_TTL_SECONDS;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < MINIMUM_TTL_SECONDS ||
    (value as number) > maximum
  ) {
    return invalid();
  }
  return value as number;
}

function policyRule(purpose: PrivacyAccessPurpose): PolicyRule {
  return POLICY_RULES.find((rule) => rule.purpose === purpose) ?? invalid();
}

function keyedDigest(key: string, label: string, value: string): string {
  const digest = createHmac('sha256', key)
    .update(`${label}\u0000${value}`, 'utf8')
    .digest('hex');
  return SHA_256_PATTERN.test(digest) ? digest : invalid();
}

function canonicalRequest(input: {
  workspaceId: string;
  actorId: string;
  purpose: PrivacyAccessPurpose;
  action: PrivacyAccessAction;
  resourceCategory: PrivacyResourceCategory;
  requestedTtlSeconds: number;
  requestedAt: string;
  reason: string;
}): string {
  return JSON.stringify({
    schema: 'life-os.privacy-access-request.v1',
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    purpose: input.purpose,
    action: input.action,
    resourceCategory: input.resourceCategory,
    requestedTtlSeconds: input.requestedTtlSeconds,
    requestedAt: input.requestedAt,
    reason: input.reason,
    policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
    policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
  });
}

/**
 * Evaluates one explicit purpose/action/category combination without loading or
 * transforming personal data and returns immutable append-only decision input.
 */
export function evaluatePrivacyAccessRequest(
  input: PrivacyAccessRequest,
  dependencies: PrivacyAccessEvaluationDependencies,
): PrivacyAccessDecision {
  if (!input || typeof input !== 'object') {
    return invalid();
  }
  const workspaceId = requireUuidV4(input.workspaceId);
  const actorId = requireUuidV4(input.actorId);
  const purpose = requirePurpose(input.purpose);
  const action = requireAction(input.action);
  const resourceCategory = requireResourceCategory(input.resourceCategory);
  const mode = accessMode(purpose);
  const ttlSeconds = requireTtl(input.requestedTtlSeconds, mode);
  const requestedAt = requireRequestedAt(input.requestedAt);
  const rule = policyRule(purpose);
  const reason = normalizeReason(input.reason, rule.reasonRequired);
  const digestKey = requireDigestKey(dependencies.auditDigestKey);
  const uuidFactory = dependencies.uuidFactory ?? randomUUID;
  const decisionId = requireUuidV4(uuidFactory());
  const allowed =
    rule.actions.includes(action) &&
    rule.resourceCategories.includes(resourceCategory);
  const issuedAt = requestedAt.toISOString();
  const requestDocument = canonicalRequest({
    workspaceId,
    actorId,
    purpose,
    action,
    resourceCategory,
    requestedTtlSeconds: ttlSeconds,
    requestedAt: issuedAt,
    reason,
  });
  const base = {
    decisionId,
    workspaceId,
    actorId,
    purpose,
    action,
    resourceCategory,
    accessMode: mode,
    outcome: allowed ? ('allowed' as const) : ('denied' as const),
    policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
    policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
    requestDigest: keyedDigest(digestKey, 'request', requestDocument),
    reasonDigest: keyedDigest(digestKey, 'reason', reason || 'none'),
    issuedAt,
  };
  if (!allowed) {
    return Object.freeze(base);
  }
  const grantId = requireUuidV4(uuidFactory());
  const expiresAt = new Date(
    requestedAt.getTime() + ttlSeconds * 1_000,
  ).toISOString();
  return Object.freeze({ ...base, grantId, expiresAt });
}
