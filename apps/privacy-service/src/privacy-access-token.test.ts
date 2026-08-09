import { describe, expect, it } from 'vitest';
import {
  PrivacyAccessTokenError,
  createPrivacyAccessGrantToken,
  parsePrivacyGrantKeyRing,
  verifyPrivacyAccessGrantToken,
} from './privacy-access-token';
import {
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
  type PrivacyAccessDecision,
} from './privacy-access-domain';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const ACTIVE_SECRET = Buffer.alloc(32, 0x41).toString('base64url');
const PREVIOUS_SECRET = Buffer.alloc(32, 0x42).toString('base64url');
const NOW = new Date('2026-08-07T01:05:00.000Z');

/** Creates one allowed ordinary access decision. */
function decision(
  overrides: Partial<PrivacyAccessDecision> = {},
): PrivacyAccessDecision {
  return {
    decisionId: DECISION_ID,
    grantId: GRANT_ID,
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    purpose: 'workspace_operation',
    action: 'read',
    resourceCategory: 'planning_content',
    accessMode: 'ordinary',
    outcome: 'allowed',
    policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
    policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
    requestDigest: 'a'.repeat(64),
    reasonDigest: 'b'.repeat(64),
    issuedAt: '2026-08-07T01:00:00.000Z',
    expiresAt: '2026-08-07T01:10:00.000Z',
    ...overrides,
  };
}

/** Creates one active-only signing key environment. */
function activeEnvironment() {
  return {
    PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-2026-08-a',
    PRIVACY_GRANT_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
  };
}

describe('privacy grant key ring', () => {
  it('creates one immutable active-only key ring', () => {
    const keyRing = parsePrivacyGrantKeyRing(activeEnvironment());
    expect(keyRing).toEqual({
      active: {
        keyId: 'privacy-2026-08-a',
        secret: ACTIVE_SECRET,
      },
    });
    expect(Object.isFrozen(keyRing)).toBe(true);
    expect(Object.isFrozen(keyRing.active)).toBe(true);
  });

  it('creates one active and previous verification overlap', () => {
    const keyRing = parsePrivacyGrantKeyRing({
      ...activeEnvironment(),
      PRIVACY_GRANT_PREVIOUS_KEY_ID: 'privacy-2026-07-z',
      PRIVACY_GRANT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    });
    expect(keyRing.previous).toEqual({
      keyId: 'privacy-2026-07-z',
      secret: PREVIOUS_SECRET,
    });
    expect(Object.isFrozen(keyRing.previous)).toBe(true);
  });

  it.each([
    {},
    { PRIVACY_GRANT_ACTIVE_KEY_ID: 'active' },
    { PRIVACY_GRANT_ACTIVE_KEY_SECRET: ACTIVE_SECRET },
    {
      ...activeEnvironment(),
      PRIVACY_GRANT_PREVIOUS_KEY_ID: 'previous',
    },
    {
      ...activeEnvironment(),
      PRIVACY_GRANT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    },
    {
      ...activeEnvironment(),
      PRIVACY_GRANT_PREVIOUS_KEY_ID: 'privacy-2026-08-a',
      PRIVACY_GRANT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    },
    {
      ...activeEnvironment(),
      PRIVACY_GRANT_PREVIOUS_KEY_ID: 'privacy-2026-07-z',
      PRIVACY_GRANT_PREVIOUS_KEY_SECRET: ACTIVE_SECRET,
    },
    {
      PRIVACY_GRANT_ACTIVE_KEY_ID: '-invalid',
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
    },
    {
      PRIVACY_GRANT_ACTIVE_KEY_ID: 'active',
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: 'short',
    },
    {
      PRIVACY_GRANT_ACTIVE_KEY_ID: 'a'.repeat(65),
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
    },
  ])('rejects unsafe key configuration %#', (environment) => {
    expect(() => parsePrivacyGrantKeyRing(environment)).toThrow(
      PrivacyAccessTokenError,
    );
  });
});

describe('privacy access grant token', () => {
  it('signs canonical claims with only the active key', () => {
    const keyRing = parsePrivacyGrantKeyRing(activeEnvironment());
    const token = createPrivacyAccessGrantToken(decision(), keyRing);
    const [payload, signature] = token.split('.');
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(token).not.toContain(ACTIVE_SECRET);
    expect(token).not.toContain('workspace_operation');

    const verified = verifyPrivacyAccessGrantToken(token, keyRing, {
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      now: NOW,
    });
    expect(verified).toEqual({
      schema: 'life-os.privacy-access-grant.v1',
      keyId: 'privacy-2026-08-a',
      grantId: GRANT_ID,
      decisionId: DECISION_ID,
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      accessMode: 'ordinary',
      policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
      policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
      issuedAt: '2026-08-07T01:00:00.000Z',
      expiresAt: '2026-08-07T01:10:00.000Z',
    });
    expect(Object.isFrozen(verified)).toBe(true);
  });

  it('verifies a previous overlap token but never signs with the previous key', () => {
    const previousOnly = parsePrivacyGrantKeyRing({
      PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-2026-07-z',
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: PREVIOUS_SECRET,
    });
    const token = createPrivacyAccessGrantToken(decision(), previousOnly);
    const overlap = parsePrivacyGrantKeyRing({
      ...activeEnvironment(),
      PRIVACY_GRANT_PREVIOUS_KEY_ID: 'privacy-2026-07-z',
      PRIVACY_GRANT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
    });
    expect(
      verifyPrivacyAccessGrantToken(token, overlap, {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        now: NOW,
      }).keyId,
    ).toBe('privacy-2026-07-z');
    const newlySigned = createPrivacyAccessGrantToken(decision(), overlap);
    const payload = JSON.parse(
      Buffer.from(newlySigned.split('.')[0] ?? '', 'base64url').toString(
        'utf8',
      ),
    ) as { keyId: string };
    expect(payload.keyId).toBe('privacy-2026-08-a');
  });

  it.each([
    '',
    'one-part',
    'a.b.c',
    '*.signature',
    `${Buffer.from('{', 'utf8').toString('base64url')}.signature`,
    `${Buffer.from('null', 'utf8').toString('base64url')}.signature`,
    `${'a'.repeat(16_385)}.signature`,
  ])('rejects malformed token %#', (token) => {
    const keyRing = parsePrivacyGrantKeyRing(activeEnvironment());
    expect(() =>
      verifyPrivacyAccessGrantToken(token, keyRing, {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        now: NOW,
      }),
    ).toThrow(PrivacyAccessTokenError);
  });

  it('rejects forged signatures and altered claims', () => {
    const keyRing = parsePrivacyGrantKeyRing(activeEnvironment());
    const token = createPrivacyAccessGrantToken(decision(), keyRing);
    const [payload, signature] = token.split('.');
    const claims = JSON.parse(
      Buffer.from(payload ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    claims.resourceCategory = 'identity_profile';
    const altered = `${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.${signature}`;
    const forged = `${payload}.${Buffer.alloc(32, 0x66).toString('base64url')}`;
    for (const candidate of [altered, forged]) {
      expect(() =>
        verifyPrivacyAccessGrantToken(candidate, keyRing, {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          now: NOW,
        }),
      ).toThrow(PrivacyAccessTokenError);
    }
  });

  it.each([
    { workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { actorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { now: new Date('2026-08-07T01:10:00.000Z') },
    { now: new Date('2026-08-07T01:10:00.001Z') },
    { now: new Date('2026-08-07T00:58:59.999Z') },
  ])('rejects context, expiry, and future issuance mismatch %#', (override) => {
    const keyRing = parsePrivacyGrantKeyRing(activeEnvironment());
    const token = createPrivacyAccessGrantToken(decision(), keyRing);
    expect(() =>
      verifyPrivacyAccessGrantToken(token, keyRing, {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        now: NOW,
        ...override,
      }),
    ).toThrow(PrivacyAccessTokenError);
  });

  it('rejects an unknown or retired key identifier without trial verification', () => {
    const oldRing = parsePrivacyGrantKeyRing({
      PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-retired-key',
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: PREVIOUS_SECRET,
    });
    const token = createPrivacyAccessGrantToken(decision(), oldRing);
    const activeRing = parsePrivacyGrantKeyRing(activeEnvironment());
    expect(() =>
      verifyPrivacyAccessGrantToken(token, activeRing, {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        now: NOW,
      }),
    ).toThrow(PrivacyAccessTokenError);
  });

  it.each([
    { outcome: 'denied' },
    { grantId: undefined },
    { expiresAt: undefined },
    { policyDigest: '0'.repeat(64) },
    { policyRevisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { issuedAt: 'not-a-date' },
    { expiresAt: '2026-08-07T02:00:00.000Z' },
  ])('refuses to sign an invalid allowed decision %#', (override) => {
    const keyRing = parsePrivacyGrantKeyRing(activeEnvironment());
    expect(() =>
      createPrivacyAccessGrantToken(decision(override as never), keyRing),
    ).toThrow(PrivacyAccessTokenError);
  });

  it('uses stable errors that do not retain rejected tokens or key material', () => {
    const keyRing = parsePrivacyGrantKeyRing(activeEnvironment());
    const rejected = `private-${'x'.repeat(40)}`;
    let failure: unknown;
    try {
      verifyPrivacyAccessGrantToken(rejected, keyRing, {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        now: NOW,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toEqual(new PrivacyAccessTokenError());
    expect(String(failure)).not.toContain(rejected);
    expect(String(failure)).not.toContain(ACTIVE_SECRET);
  });
});
