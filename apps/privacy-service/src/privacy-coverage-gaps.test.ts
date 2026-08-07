import { createHmac } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import {
  PrivacyAccessApplication,
  PrivacyAccessApplicationError,
} from './privacy-access-application';
import {
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
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
  type PrivacyAccessGrantClaims,
} from './privacy-access-token';
import { parsePrivacyAccessConsumeBody } from './privacy-http-boundary';
import {
  PrivacyServiceContextError,
  createPrivacyServiceContextHeaders,
  parsePrivacyServiceContextKeyRing,
  verifyPrivacyServiceContext,
} from './privacy-service-context';
import {
  PrivacyController,
  type PrivacyAccessDecisionResult,
  type PrivacyAccessOperations,
} from './main';
import { startPrivacyService, type PrivacyNestApplication } from './server';
import {
  PostgresPrivacyAccessRepository,
  PrivacyAccessPersistenceError,
  type PrivacySqlPool,
  type PrivacySqlTransactionClient,
} from './postgres-privacy-access-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-08-07T09:00:30.000Z');
const ISSUED_AT = new Date('2026-08-07T09:00:00.000Z');
const AUDIT_KEY = Buffer.alloc(32, 0x61).toString('base64url');
const GRANT_SECRET = Buffer.alloc(32, 0x62).toString('base64url');
const CONTEXT_SECRET = Buffer.alloc(32, 0x63).toString('base64url');
const DIGEST = 'a'.repeat(64);

class MemoryRepository implements PrivacyAccessRepository {
  async persistDecision(
    _input: PrivacyDecisionPersistenceInput,
  ): Promise<void> {
    return undefined;
  }

  async consumeGrant(
    input: PrivacyGrantConsumptionInput,
  ): Promise<PrivacyGrantConsumptionReceipt> {
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

function grantRing() {
  return parsePrivacyGrantKeyRing({
    PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-active',
    PRIVACY_GRANT_ACTIVE_KEY_SECRET: GRANT_SECRET,
  });
}

function contextRing() {
  return parsePrivacyServiceContextKeyRing({
    PRIVACY_CONTEXT_ACTIVE_KEY_ID: 'privacy-context-active',
    PRIVACY_CONTEXT_ACTIVE_KEY_SECRET: CONTEXT_SECRET,
  });
}

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
    policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
    policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
    requestDigest: DIGEST,
    reasonDigest: 'b'.repeat(64),
    issuedAt: ISSUED_AT.toISOString(),
    expiresAt: '2026-08-07T09:10:00.000Z',
    ...overrides,
  };
}

function claims(
  overrides: Partial<PrivacyAccessGrantClaims> = {},
): PrivacyAccessGrantClaims {
  return {
    schema: 'life-os.privacy-access-grant.v1',
    keyId: 'privacy-active',
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
    issuedAt: ISSUED_AT.toISOString(),
    expiresAt: '2026-08-07T09:10:00.000Z',
    ...overrides,
  };
}

function consumeInput(
  overrides: Partial<PrivacyGrantConsumptionInput> = {},
): PrivacyGrantConsumptionInput {
  return {
    claims: claims(),
    tokenDigest: DIGEST,
    accessEventId: EVENT_ID,
    resourceReferenceDigest: 'c'.repeat(64),
    occurredAt: '2026-08-07T09:05:00.000Z',
    ...overrides,
  };
}

function signedClaims(value: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', GRANT_SECRET)
    .update(payload, 'ascii')
    .digest('base64url');
  return `${payload}.${signature}`;
}

describe('privacy exact coverage regressions', () => {
  it('rejects malformed application digest keys and UUIDs', async () => {
    expect(
      () =>
        new PrivacyAccessApplication({
          repository: new MemoryRepository(),
          grantKeyRing: grantRing(),
          auditDigestKey: 42 as never,
        }),
    ).toThrow(PrivacyAccessApplicationError);

    const service = new PrivacyAccessApplication({
      repository: new MemoryRepository(),
      grantKeyRing: grantRing(),
      auditDigestKey: AUDIT_KEY,
      clock: () => NOW,
    });
    for (const workspaceId of [42 as never, 'not-a-uuid']) {
      await expect(
        service.consume({
          workspaceId,
          actorId: ACTOR_ID,
          grantToken: 'a.b',
        }),
      ).rejects.toEqual(new PrivacyAccessApplicationError());
    }
  });

  it('rejects string principals that are not UUIDv4 at the private context boundary', () => {
    expect(() =>
      createPrivacyServiceContextHeaders(
        {
          workspaceId: '11111111-1111-1111-8111-111111111111',
          actorId: ACTOR_ID,
          method: 'POST',
          path: '/v1/privacy/access-decisions',
          issuedAt: ISSUED_AT,
        },
        contextRing(),
      ),
    ).toThrow(PrivacyServiceContextError);
  });

  it('rejects a signed claim with a non-string canonical timestamp', () => {
    const token = createPrivacyAccessGrantToken(allowedDecision(), grantRing());
    const [payload] = token.split('.');
    const decoded = JSON.parse(
      Buffer.from(payload ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    decoded.issuedAt = 42;
    expect(() =>
      verifyPrivacyAccessGrantToken(signedClaims(decoded), grantRing(), {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        now: NOW,
      }),
    ).toThrow(PrivacyAccessTokenError);
  });

  it('rejects non-base64url private-context signatures before comparison', () => {
    const headers = createPrivacyServiceContextHeaders(
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        method: 'POST',
        path: '/v1/privacy/access-grants/consume',
        issuedAt: ISSUED_AT,
      },
      contextRing(),
    );
    expect(() =>
      verifyPrivacyServiceContext(
        { ...headers, 'x-life-os-context-signature': '*' },
        contextRing(),
        'POST',
        '/v1/privacy/access-grants/consume',
        NOW,
      ),
    ).toThrow(PrivacyServiceContextError);
  });

  it('accepts a consume body without an optional resource reference', () => {
    const grantToken = `${'a'.repeat(64)}.${'b'.repeat(43)}`;
    expect(parsePrivacyAccessConsumeBody({ grantToken })).toEqual({
      grantToken,
    });
  });

  it('maps consume-operation failures through the bounded HTTP problem contract', async () => {
    const decide = vi.fn<PrivacyAccessOperations['decide']>(async () => ({
      decision: allowedDecision(),
      grantToken: 'a.b',
    }));
    const consume = vi.fn<PrivacyAccessOperations['consume']>(async () => {
      throw new Error('private downstream detail');
    });
    const application: PrivacyAccessOperations = { decide, consume };
    const controller = new PrivacyController(
      application,
      contextRing(),
      () => NOW,
    );
    const headers = createPrivacyServiceContextHeaders(
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        method: 'POST',
        path: '/v1/privacy/access-grants/consume',
        issuedAt: ISSUED_AT,
      },
      contextRing(),
    );
    const body = {
      grantToken: `${'a'.repeat(64)}.${'b'.repeat(43)}`,
    };
    await expect(controller.consume(headers, body)).rejects.toMatchObject({
      status: 503,
    });
  });

  it('uses the production Nest factory when no test factory is supplied', async () => {
    const application: PrivacyNestApplication = {
      setGlobalPrefix: vi.fn(),
      enableShutdownHooks: vi.fn(),
      listen: vi.fn(async () => undefined),
    };
    const create = vi
      .spyOn(NestFactory, 'create')
      .mockResolvedValue(application as never);
    try {
      await expect(
        startPrivacyService({ PRIVACY_SERVICE_PORT: '5118' }),
      ).resolves.toBe(application);
      expect(create).toHaveBeenCalledOnce();
      expect(application.listen).toHaveBeenCalledWith(5118, '0.0.0.0');
    } finally {
      create.mockRestore();
    }
  });

  it('rejects non-string UUIDs and non-canonical calendar timestamps before SQL', async () => {
    const connect = vi.fn(async () => {
      throw new Error('must not connect');
    });
    const repository = new PostgresPrivacyAccessRepository({
      connect,
    } as PrivacySqlPool);

    await expect(
      repository.persistDecision({
        decision: allowedDecision({ decisionId: 42 as never }),
        tokenDigest: DIGEST,
      }),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    await expect(
      repository.persistDecision({
        decision: allowedDecision({
          issuedAt: '2026-02-30T09:00:00.000Z',
        }),
        tokenDigest: DIGEST,
      }),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects a non-record consumed database row, rolls back, and releases the client', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [null] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const client = {
      query,
      release,
    } as unknown as PrivacySqlTransactionClient;
    const pool = {
      connect: vi.fn(async () => client),
    } as PrivacySqlPool;

    await expect(
      new PostgresPrivacyAccessRepository(pool).consumeGrant(consumeInput()),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('releases the client when consumption and rollback both fail', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('private consume failure'))
      .mockRejectedValueOnce(new Error('private rollback failure'));
    const release = vi.fn();
    const client = {
      query,
      release,
    } as unknown as PrivacySqlTransactionClient;
    const pool = {
      connect: vi.fn(async () => client),
    } as PrivacySqlPool;

    await expect(
      new PostgresPrivacyAccessRepository(pool).consumeGrant(consumeInput()),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
