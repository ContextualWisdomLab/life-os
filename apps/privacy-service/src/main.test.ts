import { describe, expect, it, vi } from 'vitest';
import type {
  PrivacyAccessDecisionResult,
  PrivacyAccessOperations,
} from './main';
import {
  PrivacyController,
  PRIVACY_ACCESS_APPLICATION,
  PRIVACY_CONTEXT_KEY_RING,
  PRIVACY_RUNTIME,
} from './main';
import {
  createPrivacyServiceContextHeaders,
  parsePrivacyServiceContextKeyRing,
} from './privacy-service-context';
import type { PrivacyGrantConsumptionReceipt } from './privacy-access-repository';
import type { PrivacyAccessDecision } from './privacy-access-domain';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const SECRET = Buffer.alloc(32, 0x41).toString('base64url');
const NOW = new Date('2026-08-07T06:00:30.000Z');
const ISSUED_AT = new Date('2026-08-07T06:00:00.000Z');

function keyRing() {
  return parsePrivacyServiceContextKeyRing({
    PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'privacy-context-active',
    PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: SECRET,
  });
}

function headers(path: string): Record<string, string> {
  return {
    host: 'privacy-service:4108',
    ...createPrivacyServiceContextHeaders(
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        method: 'POST',
        path,
        issuedAt: ISSUED_AT,
      },
      keyRing(),
    ),
  };
}

function decision(outcome: 'allowed' | 'denied'): PrivacyAccessDecision {
  const base = {
    decisionId: DECISION_ID,
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    purpose: 'workspace_operation' as const,
    action: 'read' as const,
    resourceCategory: 'planning_content' as const,
    accessMode: 'ordinary' as const,
    outcome,
    policyRevisionId: '7a25c6b5-9fd7-45f3-9bd9-180dbc668c92',
    policyDigest: 'a'.repeat(64),
    requestDigest: 'b'.repeat(64),
    reasonDigest: 'c'.repeat(64),
    issuedAt: ISSUED_AT.toISOString(),
  };
  return outcome === 'allowed'
    ? {
        ...base,
        grantId: GRANT_ID,
        expiresAt: '2026-08-07T06:10:00.000Z',
      }
    : base;
}

function receipt(): PrivacyGrantConsumptionReceipt {
  return {
    accessEventId: EVENT_ID,
    grantId: GRANT_ID,
    decisionId: DECISION_ID,
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    purpose: 'workspace_operation',
    action: 'read',
    resourceCategory: 'planning_content',
    accessMode: 'ordinary',
    policyRevisionId: '7a25c6b5-9fd7-45f3-9bd9-180dbc668c92',
    policyDigest: 'a'.repeat(64),
    occurredAt: NOW.toISOString(),
  };
}

function operations(result: PrivacyAccessDecisionResult): {
  boundary: PrivacyAccessOperations;
  decide: ReturnType<typeof vi.fn<PrivacyAccessOperations['decide']>>;
  consume: ReturnType<typeof vi.fn<PrivacyAccessOperations['consume']>>;
} {
  const decide = vi.fn<PrivacyAccessOperations['decide']>(async () => result);
  const consume = vi.fn<PrivacyAccessOperations['consume']>(async () =>
    receipt(),
  );
  return { boundary: { decide, consume }, decide, consume };
}

describe('PrivacyController', () => {
  it('returns one credential-free health response', () => {
    const fixture = operations({
      decision: decision('allowed'),
      grantToken: 'a.b',
    });
    const controller = new PrivacyController(
      fixture.boundary,
      keyRing(),
      () => NOW,
    );
    expect(controller.health()).toEqual({
      status: 'ok',
      service: 'privacy-service',
    });
  });

  it('derives ownership only from signed headers and returns an allowed grant', async () => {
    const expected: PrivacyAccessDecisionResult = {
      decision: decision('allowed'),
      grantToken: `${'a'.repeat(64)}.${'b'.repeat(43)}`,
    };
    const fixture = operations(expected);
    const controller = new PrivacyController(
      fixture.boundary,
      keyRing(),
      () => NOW,
    );

    await expect(
      controller.decide(headers('/v1/privacy/access-decisions'), {
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 600,
      }),
    ).resolves.toBe(expected);
    expect(fixture.decide).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
  });

  it('returns a bounded 403 receipt after persisting a denied decision', async () => {
    const fixture = operations({ decision: decision('denied') });
    const controller = new PrivacyController(
      fixture.boundary,
      keyRing(),
      () => NOW,
    );
    await expect(
      controller.decide(headers('/v1/privacy/access-decisions'), {
        purpose: 'workspace_operation',
        action: 'export',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 600,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('consumes one exact token with trusted ownership', async () => {
    const fixture = operations({
      decision: decision('allowed'),
      grantToken: 'a.b',
    });
    const controller = new PrivacyController(
      fixture.boundary,
      keyRing(),
      () => NOW,
    );
    const grantToken = `${'a'.repeat(64)}.${'b'.repeat(43)}`;

    await expect(
      controller.consume(headers('/v1/privacy/access-grants/consume'), {
        grantToken,
        resourceReference: 'profile-primary',
      }),
    ).resolves.toEqual(receipt());
    expect(fixture.consume).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      grantToken,
      resourceReference: 'profile-primary',
    });
  });

  it('fails before the application on forged context and ownership injection', async () => {
    const fixture = operations({
      decision: decision('allowed'),
      grantToken: 'a.b',
    });
    const controller = new PrivacyController(
      fixture.boundary,
      keyRing(),
      () => NOW,
    );
    const forged = {
      ...headers('/v1/privacy/access-decisions'),
      'x-life-os-context-signature': 'forged',
    };
    await expect(
      controller.decide(forged, {
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 600,
      }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      controller.decide(headers('/v1/privacy/access-decisions'), {
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 600,
        workspaceId: WORKSPACE_ID,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(fixture.decide).not.toHaveBeenCalled();
  });

  it('maps application failures without leaking nested details', async () => {
    const fixture = operations({
      decision: decision('allowed'),
      grantToken: 'a.b',
    });
    fixture.decide.mockRejectedValueOnce(
      new Error('database password private'),
    );
    const controller = new PrivacyController(
      fixture.boundary,
      keyRing(),
      () => NOW,
    );
    await expect(
      controller.decide(headers('/v1/privacy/access-decisions'), {
        purpose: 'workspace_operation',
        action: 'read',
        resourceCategory: 'planning_content',
        requestedTtlSeconds: 600,
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});

describe('privacy application module tokens', () => {
  it('uses distinct symbols for runtime, application, and context key ring', () => {
    expect(PRIVACY_RUNTIME).not.toBe(PRIVACY_ACCESS_APPLICATION);
    expect(PRIVACY_RUNTIME).not.toBe(PRIVACY_CONTEXT_KEY_RING);
    expect(PRIVACY_ACCESS_APPLICATION).not.toBe(PRIVACY_CONTEXT_KEY_RING);
  });
});
