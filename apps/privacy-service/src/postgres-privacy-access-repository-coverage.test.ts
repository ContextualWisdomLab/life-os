import { describe, expect, it, vi } from 'vitest';
import {
  PostgresPrivacyAccessRepository,
  PrivacyAccessPersistenceError,
  type PrivacySqlPool,
  type PrivacySqlQueryResult,
  type PrivacySqlTransactionClient,
} from './postgres-privacy-access-repository';
import {
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
  type PrivacyAccessDecision,
} from './privacy-access-domain';
import type {
  PrivacyDecisionPersistenceInput,
  PrivacyGrantConsumptionInput,
} from './privacy-access-repository';
import type { PrivacyAccessGrantClaims } from './privacy-access-token';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const ISSUED_AT = '2026-08-07T08:00:00.000Z';
const EXPIRES_AT = '2026-08-07T08:10:00.000Z';
const OCCURRED_AT = '2026-08-07T08:05:00.000Z';
const DIGEST = 'a'.repeat(64);

class Client implements PrivacySqlTransactionClient {
  readonly query = vi.fn(
    async <Row>(
      _text: string,
      _values?: readonly unknown[],
    ): Promise<PrivacySqlQueryResult<Row>> => ({ rows: [] }),
  );
  readonly release = vi.fn(() => undefined);
}

class Pool implements PrivacySqlPool {
  readonly client = new Client();
  readonly connect = vi.fn(async () => this.client);
}

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
    requestDigest: DIGEST,
    reasonDigest: 'b'.repeat(64),
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
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
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function consume(
  overrides: Partial<PrivacyGrantConsumptionInput> = {},
): PrivacyGrantConsumptionInput {
  return {
    claims: claims(),
    tokenDigest: DIGEST,
    accessEventId: EVENT_ID,
    resourceReferenceDigest: 'c'.repeat(64),
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    grant_id: GRANT_ID,
    decision_id: DECISION_ID,
    workspace_id: WORKSPACE_ID,
    actor_id: ACTOR_ID,
    purpose_code: 'workspace_operation',
    action_code: 'read',
    resource_category: 'planning_content',
    access_mode: 'ordinary',
    policy_revision_id: PRIVACY_ACCESS_POLICY_REVISION_ID,
    policy_digest: PRIVACY_ACCESS_POLICY_DIGEST,
    occurred_at: OCCURRED_AT,
    ...overrides,
  };
}

describe('privacy repository validation coverage', () => {
  it.each([
    null,
    {},
    { decision: null },
    {
      decision: decision({ outcome: 'unknown' as never }),
      tokenDigest: DIGEST,
    },
    {
      decision: decision({
        policyRevisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
      tokenDigest: DIGEST,
    },
    {
      decision: decision({ purpose: 'break_glass', accessMode: 'ordinary' }),
      tokenDigest: DIGEST,
    },
    {
      decision: decision({ requestDigest: 'short' }),
      tokenDigest: DIGEST,
    },
    {
      decision: decision({ reasonDigest: 'short' }),
      tokenDigest: DIGEST,
    },
    {
      decision: decision({ expiresAt: new Date(Number.NaN) as never }),
      tokenDigest: DIGEST,
    },
  ])('rejects additional malformed decision %#', async (input) => {
    const pool = new Pool();
    await expect(
      new PostgresPrivacyAccessRepository(pool).persistDecision(
        input as PrivacyDecisionPersistenceInput,
      ),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { claims: null },
    { claims: claims({ schema: 'other' as never }) },
    { claims: claims({ keyId: '' }) },
    {
      claims: claims({
        policyRevisionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    },
    { claims: claims({ purpose: 'break_glass', accessMode: 'ordinary' }) },
    { claims: claims({ issuedAt: new Date(Number.NaN) as never }) },
  ])('rejects additional malformed consumption %#', async (input) => {
    const pool = new Pool();
    await expect(
      new PostgresPrivacyAccessRepository(pool).consumeGrant(
        input as PrivacyGrantConsumptionInput,
      ),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('sanitizes pool connection failures for both operations', async () => {
    const pool = new Pool();
    pool.connect.mockRejectedValue(new Error('private connection string'));
    const repository = new PostgresPrivacyAccessRepository(pool);
    await expect(
      repository.persistDecision({ decision: decision(), tokenDigest: DIGEST }),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    await expect(repository.consumeGrant(consume())).rejects.toEqual(
      new PrivacyAccessPersistenceError(),
    );
  });

  it('masks rollback failure after a transaction error', async () => {
    const pool = new Pool();
    pool.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('private write failure'))
      .mockRejectedValueOnce(new Error('private rollback failure'));
    await expect(
      new PostgresPrivacyAccessRepository(pool).persistDecision({
        decision: decision(),
        tokenDigest: DIGEST,
      }),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    expect(pool.client.release).toHaveBeenCalledOnce();
  });

  it.each([
    { grant_id: 'numeric-1' },
    { decision_id: 'numeric-2' },
    { policy_revision_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { occurred_at: new Date(Number.NaN) },
    { occurred_at: '2026-08-07T08:05:00Z' },
  ])('rejects remaining malformed returned row %#', async (override) => {
    const pool = new Pool();
    pool.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row(override)] });
    await expect(
      new PostgresPrivacyAccessRepository(pool).consumeGrant(consume()),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    expect(pool.client.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it.each([
    { grant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { decision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { policy_revision_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
    { policy_digest: 'd'.repeat(64) },
    { occurred_at: '2026-08-07T08:05:01.000Z' },
  ])('rejects exact returned-row mismatch %#', async (override) => {
    const pool = new Pool();
    pool.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row(override)] });
    await expect(
      new PostgresPrivacyAccessRepository(pool).consumeGrant(consume()),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
  });
});
