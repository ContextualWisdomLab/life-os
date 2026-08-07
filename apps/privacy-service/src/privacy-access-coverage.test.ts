import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PrivacyAccessApplication,
  PrivacyAccessApplicationError,
} from './privacy-access-application';
import {
  PrivacyAccessValidationError,
  evaluatePrivacyAccessRequest,
  type PrivacyAccessDecision,
} from './privacy-access-domain';
import type {
  PrivacyAccessRepository,
  PrivacyDecisionPersistenceInput,
  PrivacyGrantConsumptionInput,
  PrivacyGrantConsumptionReceipt,
} from './privacy-access-repository';
import {
  PrivacyAccessTokenError,
  createPrivacyAccessGrantToken,
  parsePrivacyGrantKeyRing,
  verifyPrivacyAccessGrantToken,
} from './privacy-access-token';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const AUDIT_KEY = Buffer.alloc(32, 0x31).toString('base64url');
const ACTIVE_SECRET = Buffer.alloc(32, 0x32).toString('base64url');
const PREVIOUS_SECRET = Buffer.alloc(32, 0x33).toString('base64url');
const NOW = new Date('2026-08-07T03:00:00.000Z');

class MemoryRepository implements PrivacyAccessRepository {
  readonly decisions: PrivacyDecisionPersistenceInput[] = [];
  readonly consumptions: PrivacyGrantConsumptionInput[] = [];

  async persistDecision(input: PrivacyDecisionPersistenceInput): Promise<void> {
    this.decisions.push(input);
  }

  async consumeGrant(
    input: PrivacyGrantConsumptionInput,
  ): Promise<PrivacyGrantConsumptionReceipt> {
    this.consumptions.push(input);
    return {
      accessEventId: input.accessEventId,
      grantId: input.claims.grantId,
      decisionId: input.claims.decisionId,
      workspaceId: input.claims.workspaceId,
      actorId: input.claims.actorId,
      purpose: input.claims.purpose,
      action: input.claims.action,
      resourceCategory: input.claims.resourceCategory,
      accessMode: input.claims.accessMode,
      policyRevisionId: input.claims.policyRevisionId,
      policyDigest: input.claims.policyDigest,
      occurredAt: input.occurredAt,
    };
  }
}

/** Creates one deterministic allowed decision for token mutation evidence. */
function allowedDecision(
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
    policyRevisionId: '7a25c6b5-9fd7-45f3-9bd9-180dbc668c92',
    policyDigest:
      '8a96ff5f4f4d2f18ba31f38b1db20f99afc1a9018a1a12cf6e230ddf47e7d106',
    requestDigest: 'a'.repeat(64),
    reasonDigest: 'b'.repeat(64),
    issuedAt: '2026-08-07T03:00:00.000Z',
    expiresAt: '2026-08-07T03:10:00.000Z',
    ...overrides,
  };
}

/** Builds a token from arbitrary claims with a known exact key. */
function signedClaims(
  claims: Record<string, unknown>,
  secret = ACTIVE_SECRET,
): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', secret)
    .update(payload, 'ascii')
    .digest('base64url');
  return `${payload}.${signature}`;
}

/** Returns decoded claims from a valid token. */
function decodedClaims(token: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
}

function ring() {
  return parsePrivacyGrantKeyRing({
    PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-active',
    PRIVACY_GRANT_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
    PRIVACY_GRANT_PREVIOUS_KEY_ID: 'privacy-previous',
    PRIVACY_GRANT_PREVIOUS_KEY_SECRET: PREVIOUS_SECRET,
  });
}

describe('privacy domain branch evidence', () => {
  it('uses production UUID generation when no factory is supplied', () => {
    const result = evaluatePrivacyAccessRequest(
      {
        workspaceId: WORKSPACE_ID.toUpperCase(),
        actorId: ` ${ACTOR_ID.toUpperCase()} `,
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 30,
        requestedAt: NOW,
      },
      { auditDigestKey: AUDIT_KEY },
    );
    expect(result.decisionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(result.grantId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(result.workspaceId).toBe(WORKSPACE_ID);
    expect(result.actorId).toBe(ACTOR_ID);
  });

  it.each([
    null,
    undefined,
    42,
    [],
  ])('rejects a non-record request %#', (value) => {
    expect(() =>
      evaluatePrivacyAccessRequest(value as never, {
        auditDigestKey: AUDIT_KEY,
      }),
    ).toThrow(PrivacyAccessValidationError);
  });

  it.each([
    null,
    42,
    `x${String.fromCharCode(0)}${'y'.repeat(40)}`,
    'x'.repeat(4_097),
  ])('rejects malformed digest key %#', (auditDigestKey) => {
    expect(() =>
      evaluatePrivacyAccessRequest(
        {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          purpose: 'workspace_operation',
          action: 'read',
          resourceCategory: 'planning_content',
          requestedTtlSeconds: 30,
          requestedAt: NOW,
        },
        { auditDigestKey: auditDigestKey as never },
      ),
    ).toThrow(PrivacyAccessValidationError);
  });

  it.each([
    null,
    42,
    ' '.repeat(30),
    '한'.repeat(400),
  ])('rejects malformed or byte-oversized reason %#', (reason) => {
    expect(() =>
      evaluatePrivacyAccessRequest(
        {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          purpose: 'account_support',
          action: 'read',
          resourceCategory: 'identity_profile',
          requestedTtlSeconds: 30,
          requestedAt: NOW,
          reason: reason as never,
        },
        {
          auditDigestKey: AUDIT_KEY,
          uuidFactory: () => DECISION_ID,
        },
      ),
    ).toThrow(PrivacyAccessValidationError);
  });
});

describe('privacy token branch evidence', () => {
  it.each([
    null,
    42,
    {
      PRIVACY_GRANT_ACTIVE_KEY_ID: null,
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: ACTIVE_SECRET,
    },
    {
      PRIVACY_GRANT_ACTIVE_KEY_ID: 'active',
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: `x\n${'y'.repeat(40)}`,
    },
    {
      PRIVACY_GRANT_ACTIVE_KEY_ID: 'active',
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: 'x'.repeat(4_097),
    },
  ])('rejects additional unsafe key environment %#', (environment) => {
    expect(() => parsePrivacyGrantKeyRing(environment as never)).toThrow(
      PrivacyAccessTokenError,
    );
  });

  it('signs and verifies break-glass validity at its exact boundaries', () => {
    const token = createPrivacyAccessGrantToken(
      allowedDecision({
        purpose: 'break_glass',
        accessMode: 'break_glass',
        resourceCategory: 'identity_profile',
        expiresAt: '2026-08-07T03:05:00.000Z',
      }),
      ring(),
    );
    expect(
      verifyPrivacyAccessGrantToken(token, ring(), {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        now: new Date('2026-08-07T03:05:00.000Z'),
      }).accessMode,
    ).toBe('break_glass');
  });

  it('rejects invalid key rings at signing and malformed verification context', () => {
    expect(() =>
      createPrivacyAccessGrantToken(allowedDecision(), null as never),
    ).toThrow(PrivacyAccessTokenError);
    expect(() =>
      createPrivacyAccessGrantToken(allowedDecision(), {
        active: { keyId: 'active', secret: 'short' },
      }),
    ).toThrow(PrivacyAccessTokenError);
    const token = createPrivacyAccessGrantToken(allowedDecision(), ring());
    for (const context of [
      null,
      { workspaceId: 42, actorId: ACTOR_ID, now: NOW },
      { workspaceId: WORKSPACE_ID, actorId: 42, now: NOW },
      { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID, now: new Date(NaN) },
    ]) {
      expect(() =>
        verifyPrivacyAccessGrantToken(token, ring(), context as never),
      ).toThrow(PrivacyAccessTokenError);
    }
  });

  it('rejects every malformed or inconsistent signed claim shape', () => {
    const token = createPrivacyAccessGrantToken(allowedDecision(), ring());
    const base = decodedClaims(token);
    const mutations: Array<(claims: Record<string, unknown>) => void> = [
      (claims) => {
        claims.extra = true;
      },
      (claims) => {
        delete claims.action;
      },
      (claims) => {
        claims.schema = 'other';
      },
      (claims) => {
        claims.keyId = 42;
      },
      (claims) => {
        claims.grantId = 'numeric-1';
      },
      (claims) => {
        claims.purpose = 'unknown';
      },
      (claims) => {
        claims.action = 'delete';
      },
      (claims) => {
        claims.resourceCategory = 'all_data';
      },
      (claims) => {
        claims.accessMode = 'emergency';
      },
      (claims) => {
        claims.policyRevisionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      },
      (claims) => {
        claims.policyDigest = '0'.repeat(64);
      },
      (claims) => {
        claims.issuedAt = '2026-08-07T03:00:00Z';
      },
      (claims) => {
        claims.expiresAt = 'not-a-date';
      },
      (claims) => {
        claims.expiresAt = claims.issuedAt;
      },
      (claims) => {
        claims.expiresAt = '2026-08-07T04:00:00.000Z';
      },
    ];
    for (const mutate of mutations) {
      const claims = { ...base };
      mutate(claims);
      expect(() =>
        verifyPrivacyAccessGrantToken(signedClaims(claims), ring(), {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          now: NOW,
        }),
      ).toThrow(PrivacyAccessTokenError);
    }
  });

  it('rejects invalid UTF-8, invalid signature encoding, and unknown previous selection', () => {
    const invalidUtf8 = `${Buffer.from([0xff]).toString('base64url')}.signature`;
    const token = createPrivacyAccessGrantToken(allowedDecision(), ring());
    const [payload] = token.split('.');
    const unknownClaims = decodedClaims(token);
    unknownClaims.keyId = 'privacy-unknown';
    for (const candidate of [
      invalidUtf8,
      `${payload}.*`,
      signedClaims(unknownClaims),
    ]) {
      expect(() =>
        verifyPrivacyAccessGrantToken(candidate, ring(), {
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          now: NOW,
        }),
      ).toThrow(PrivacyAccessTokenError);
    }
  });
});

describe('privacy application branch evidence', () => {
  it('rejects invalid construction and default-clock inputs safely', async () => {
    expect(() => new PrivacyAccessApplication(null as never)).toThrow(
      PrivacyAccessApplicationError,
    );
    expect(() =>
      new PrivacyAccessApplication({
        repository: new MemoryRepository(),
        grantKeyRing: ring(),
        auditDigestKey: 'short',
      }),
    ).toThrow(PrivacyAccessApplicationError);
    const defaulted = new PrivacyAccessApplication({
      repository: new MemoryRepository(),
      grantKeyRing: ring(),
      auditDigestKey: AUDIT_KEY,
    });
    await expect(
      defaulted.decide({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 30,
      }),
    ).resolves.toMatchObject({
      decision: {
        decisionId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        ),
      },
    });
  });

  it('rejects invalid clocks, UUIDs, and every resource-reference boundary', async () => {
    const invalidClock = new PrivacyAccessApplication({
      repository: new MemoryRepository(),
      grantKeyRing: ring(),
      auditDigestKey: AUDIT_KEY,
      clock: () => new Date(NaN),
    });
    await expect(
      invalidClock.decide({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 30,
      }),
    ).rejects.toEqual(new PrivacyAccessApplicationError());

    for (const resourceReference of [
      42,
      ' ',
      'x'.repeat(257),
      '한'.repeat(400),
      `x${String.fromCharCode(0)}y`,
    ]) {
      const repository = new MemoryRepository();
      const identifiers = [DECISION_ID, GRANT_ID, EVENT_ID];
      const service = new PrivacyAccessApplication({
        repository,
        grantKeyRing: ring(),
        auditDigestKey: AUDIT_KEY,
        uuidFactory: () => identifiers.shift() ?? EVENT_ID,
        clock: () => NOW,
      });
      const issued = await service.decide({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 30,
      });
      await expect(
        service.consume({
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          grantToken: issued.grantToken ?? '',
          resourceReference: resourceReference as never,
        }),
      ).rejects.toEqual(new PrivacyAccessApplicationError());
    }
  });
});
