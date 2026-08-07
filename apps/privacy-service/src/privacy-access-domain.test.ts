import { describe, expect, it } from 'vitest';
import {
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
  PrivacyAccessValidationError,
  evaluatePrivacyAccessRequest,
  type PrivacyAccessRequest,
} from './privacy-access-domain';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const REQUESTED_AT = new Date('2026-08-07T01:00:00.000Z');
const DIGEST_KEY = Buffer.alloc(32, 0x44).toString('base64url');

/** Creates one valid ordinary request with optional field overrides. */
function request(
  overrides: Partial<PrivacyAccessRequest> = {},
): PrivacyAccessRequest {
  return {
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    purpose: 'workspace_operation',
    action: 'read',
    resourceCategory: 'planning_content',
    requestedTtlSeconds: 600,
    requestedAt: REQUESTED_AT,
    ...overrides,
  };
}

/** Evaluates one request with deterministic identifiers and digest key. */
function evaluate(overrides: Partial<PrivacyAccessRequest> = {}) {
  const identifiers = [DECISION_ID, GRANT_ID];
  return evaluatePrivacyAccessRequest(request(overrides), {
    uuidFactory: () => identifiers.shift() ?? GRANT_ID,
    auditDigestKey: DIGEST_KEY,
  });
}

describe('purpose-bound privacy access policy', () => {
  it.each([
    ['workspace_operation', 'read', 'planning_content'],
    ['workspace_operation', 'correct', 'habit_content'],
    ['account_support', 'read', 'identity_profile'],
    ['security_investigation', 'read', 'notification_content'],
    ['security_investigation', 'read', 'ai_audit_content'],
    ['data_subject_request', 'read', 'calendar_content'],
    ['data_subject_request', 'export', 'review_content'],
    ['legal_obligation', 'read', 'identity_profile'],
    ['legal_obligation', 'export', 'planning_content'],
  ] as const)(
    'allows ordinary %s %s for %s',
    (purpose, action, resourceCategory) => {
      const decision = evaluate({
        purpose,
        action,
        resourceCategory,
        reason:
          purpose === 'workspace_operation'
            ? undefined
            : 'Reviewed support case PRIV-2026-08-07.',
      });
      expect(decision).toMatchObject({
        decisionId: DECISION_ID,
        grantId: GRANT_ID,
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        purpose,
        action,
        resourceCategory,
        accessMode: 'ordinary',
        outcome: 'allowed',
        policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
        issuedAt: REQUESTED_AT.toISOString(),
      });
      expect(decision.expiresAt).toBe('2026-08-07T01:10:00.000Z');
      expect(decision.reasonDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(decision.requestDigest).toMatch(/^[0-9a-f]{64}$/u);
      expect(decision.policyDigest).toBe(PRIVACY_ACCESS_POLICY_DIGEST);
      expect(Object.isFrozen(decision)).toBe(true);
    },
  );

  it('allows short read-only break-glass access with a mandatory reason', () => {
    const decision = evaluate({
      purpose: 'break_glass',
      action: 'read',
      resourceCategory: 'identity_profile',
      requestedTtlSeconds: 300,
      reason: 'Active incident IR-2026-004 requires immediate identity review.',
    });

    expect(decision).toMatchObject({
      outcome: 'allowed',
      accessMode: 'break_glass',
      expiresAt: '2026-08-07T01:05:00.000Z',
    });
  });

  it.each([
    ['workspace_operation', 'export', 'planning_content'],
    ['workspace_operation', 'read', 'identity_profile'],
    ['account_support', 'correct', 'identity_profile'],
    ['account_support', 'read', 'planning_content'],
    ['security_investigation', 'export', 'ai_audit_content'],
    ['data_subject_request', 'administer', 'identity_profile'],
    ['legal_obligation', 'correct', 'planning_content'],
    ['break_glass', 'export', 'identity_profile'],
  ] as const)(
    'persists a bounded denial for unsupported %s %s %s',
    (purpose, action, resourceCategory) => {
      const decision = evaluate({
        purpose,
        action,
        resourceCategory,
        reason: 'A sufficiently detailed and bounded business reason.',
      });
      expect(decision).toEqual({
        decisionId: DECISION_ID,
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        purpose,
        action,
        resourceCategory,
        accessMode: purpose === 'break_glass' ? 'break_glass' : 'ordinary',
        outcome: 'denied',
        policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
        policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
        requestDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        reasonDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        issuedAt: REQUESTED_AT.toISOString(),
      });
    },
  );

  it('normalizes equivalent Unicode and whitespace before keyed evidence digesting', () => {
    const first = evaluate({ reason: '  지원\t사례 Ａ-17 검토 완료.  ' });
    const second = evaluate({ reason: '지원 사례 A-17 검토 완료.' });
    expect(first.reasonDigest).toBe(second.reasonDigest);
    expect(first.requestDigest).toBe(second.requestDigest);
  });

  it('uses independent keyed digests instead of retaining raw reasons', () => {
    const reason = 'Customer case CASE-8841 requires account support review.';
    const first = evaluate({
      purpose: 'account_support',
      action: 'read',
      resourceCategory: 'identity_profile',
      reason,
    });
    const second = evaluatePrivacyAccessRequest(
      request({
        purpose: 'account_support',
        action: 'read',
        resourceCategory: 'identity_profile',
        reason,
      }),
      {
        uuidFactory: () => DECISION_ID,
        auditDigestKey: Buffer.alloc(32, 0x45).toString('base64url'),
      },
    );
    expect(first.reasonDigest).not.toBe(second.reasonDigest);
    expect(JSON.stringify(first)).not.toContain(reason);
  });

  it('caps ordinary and break-glass validity windows', () => {
    expect(evaluate({ requestedTtlSeconds: 900 }).expiresAt).toBe(
      '2026-08-07T01:15:00.000Z',
    );
    expect(() => evaluate({ requestedTtlSeconds: 901 })).toThrow(
      PrivacyAccessValidationError,
    );
    expect(() =>
      evaluate({
        purpose: 'break_glass',
        action: 'read',
        resourceCategory: 'planning_content',
        reason: 'Incident response requires immediate read-only access.',
        requestedTtlSeconds: 301,
      }),
    ).toThrow(PrivacyAccessValidationError);
  });

  it.each([
    { workspaceId: '123' },
    { actorId: 'numeric-7' },
    { requestedTtlSeconds: 29 },
    { requestedTtlSeconds: 60.5 },
    { requestedTtlSeconds: Number.NaN },
    { requestedAt: new Date(Number.NaN) },
    { purpose: 'unknown' as never },
    { action: 'delete' as never },
    { resourceCategory: 'all_data' as never },
    { reason: 'short' },
    { reason: 'line\nbreak reason that should never pass validation' },
    { reason: 'x'.repeat(501) },
  ])(
    'rejects malformed request input without repository state %#',
    (override) => {
      expect(() => evaluate(override as never)).toThrow(
        PrivacyAccessValidationError,
      );
    },
  );

  it.each([
    {
      purpose: 'account_support',
      action: 'read',
      resourceCategory: 'identity_profile',
    },
    {
      purpose: 'security_investigation',
      action: 'read',
      resourceCategory: 'notification_content',
    },
    {
      purpose: 'data_subject_request',
      action: 'export',
      resourceCategory: 'planning_content',
    },
    {
      purpose: 'legal_obligation',
      action: 'read',
      resourceCategory: 'review_content',
    },
    {
      purpose: 'break_glass',
      action: 'read',
      resourceCategory: 'calendar_content',
    },
  ] as const)('requires a reason for privileged purpose %#', (override) => {
    expect(() => evaluate(override)).toThrow(PrivacyAccessValidationError);
  });

  it('rejects malformed UUID factories and audit digest keys', () => {
    expect(() =>
      evaluatePrivacyAccessRequest(request(), {
        uuidFactory: () => '1',
        auditDigestKey: DIGEST_KEY,
      }),
    ).toThrow(PrivacyAccessValidationError);
    expect(() =>
      evaluatePrivacyAccessRequest(request(), {
        uuidFactory: () => DECISION_ID,
        auditDigestKey: 'short',
      }),
    ).toThrow(PrivacyAccessValidationError);
  });

  it('uses stable credential-free validation errors', () => {
    const secret = `private-${'x'.repeat(40)}`;
    let failure: unknown;
    try {
      evaluatePrivacyAccessRequest(request({ reason: secret }), {
        uuidFactory: () => DECISION_ID,
        auditDigestKey: 'short',
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toEqual(new PrivacyAccessValidationError());
    expect(String(failure)).not.toContain(secret);
  });
});
