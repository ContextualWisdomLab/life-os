import { describe, expect, it, vi } from 'vitest';
import {
  PostgresPrivacyAccessRepository,
  PrivacyAccessPersistenceError,
  type PrivacySqlPool,
  type PrivacySqlQueryResult,
  type PrivacySqlTransactionClient,
} from './postgres-privacy-access-repository';
import type {
  PrivacyDecisionPersistenceInput,
  PrivacyGrantConsumptionInput,
} from './privacy-access-repository';
import {
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
  type PrivacyAccessDecision,
} from './privacy-access-domain';
import type { PrivacyAccessGrantClaims } from './privacy-access-token';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const TOKEN_DIGEST = 'a'.repeat(64);
const REFERENCE_DIGEST = 'b'.repeat(64);
const REQUEST_DIGEST = 'c'.repeat(64);
const REASON_DIGEST = 'd'.repeat(64);
const ISSUED_AT = '2026-08-07T04:00:00.000Z';
const EXPIRES_AT = '2026-08-07T04:10:00.000Z';
const OCCURRED_AT = '2026-08-07T04:05:00.000Z';

interface QueryCall {
  readonly text: string;
  readonly values?: readonly unknown[];
}

class RecordingTransactionClient implements PrivacySqlTransactionClient {
  readonly calls: QueryCall[] = [];
  readonly queuedRows: unknown[][] = [];
  released = false;

  async query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PrivacySqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: (this.queuedRows.shift() ?? []) as Row[] };
  }

  release(): void {
    this.released = true;
  }
}

class RecordingPool implements PrivacySqlPool {
  readonly client = new RecordingTransactionClient();
  connectCalls = 0;

  async connect(): Promise<PrivacySqlTransactionClient> {
    this.connectCalls += 1;
    return this.client;
  }
}

/** Creates one valid allowed decision. */
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
    requestDigest: REQUEST_DIGEST,
    reasonDigest: REASON_DIGEST,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

/** Creates one valid denied decision. */
function deniedDecision(): PrivacyAccessDecision {
  const {
    grantId: _grantId,
    expiresAt: _expiresAt,
    ...decision
  } = allowedDecision({ outcome: 'denied' });
  return decision;
}

/** Creates one valid compact-token claim set. */
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

/** Creates one valid consumption command. */
function consumption(
  overrides: Partial<PrivacyGrantConsumptionInput> = {},
): PrivacyGrantConsumptionInput {
  return {
    claims: claims(),
    tokenDigest: TOKEN_DIGEST,
    accessEventId: EVENT_ID,
    resourceReferenceDigest: REFERENCE_DIGEST,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

/** Returns the expected row emitted by the atomic consumption update. */
function consumedRow(overrides: Record<string, unknown> = {}) {
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
    occurred_at: new Date(OCCURRED_AT),
    ...overrides,
  };
}

describe('PostgresPrivacyAccessRepository decision persistence', () => {
  it('appends an allowed decision and one unconsumed token-digest grant in one transaction', async () => {
    const pool = new RecordingPool();
    const repository = new PostgresPrivacyAccessRepository(pool);
    const input: PrivacyDecisionPersistenceInput = {
      decision: allowedDecision(),
      tokenDigest: TOKEN_DIGEST,
    };

    await repository.persistDecision(input);

    expect(pool.connectCalls).toBe(1);
    expect(pool.client.released).toBe(true);
    expect(pool.client.calls.map((call) => call.text.trim())).toEqual([
      'BEGIN',
      expect.stringContaining(
        'INSERT INTO privacy_access.privacy_access_decisions',
      ),
      expect.stringContaining(
        'INSERT INTO privacy_access.privacy_access_grants',
      ),
      'COMMIT',
    ]);
    const decisionCall = pool.client.calls[1];
    expect(decisionCall?.values).toEqual([
      DECISION_ID,
      GRANT_ID,
      WORKSPACE_ID,
      ACTOR_ID,
      'workspace_operation',
      'read',
      'planning_content',
      'ordinary',
      'allowed',
      PRIVACY_ACCESS_POLICY_REVISION_ID,
      PRIVACY_ACCESS_POLICY_DIGEST,
      REQUEST_DIGEST,
      REASON_DIGEST,
      ISSUED_AT,
      EXPIRES_AT,
    ]);
    const grantCall = pool.client.calls[2];
    expect(grantCall?.values).toEqual([
      GRANT_ID,
      DECISION_ID,
      WORKSPACE_ID,
      ACTOR_ID,
      TOKEN_DIGEST,
      PRIVACY_ACCESS_POLICY_REVISION_ID,
      PRIVACY_ACCESS_POLICY_DIGEST,
      ISSUED_AT,
      EXPIRES_AT,
    ]);
    const sql = pool.client.calls.map((call) => call.text).join('\n');
    for (const secretValue of [
      TOKEN_DIGEST,
      REQUEST_DIGEST,
      REASON_DIGEST,
      WORKSPACE_ID,
    ]) {
      expect(sql).not.toContain(secretValue);
    }
  });

  it('appends a denied decision without creating a grant', async () => {
    const pool = new RecordingPool();
    const repository = new PostgresPrivacyAccessRepository(pool);
    await repository.persistDecision({ decision: deniedDecision() });
    expect(pool.client.calls.map((call) => call.text.trim())).toEqual([
      'BEGIN',
      expect.stringContaining(
        'INSERT INTO privacy_access.privacy_access_decisions',
      ),
      'COMMIT',
    ]);
    expect(pool.client.calls[1]?.values).toEqual([
      DECISION_ID,
      null,
      WORKSPACE_ID,
      ACTOR_ID,
      'workspace_operation',
      'read',
      'planning_content',
      'ordinary',
      'denied',
      PRIVACY_ACCESS_POLICY_REVISION_ID,
      PRIVACY_ACCESS_POLICY_DIGEST,
      REQUEST_DIGEST,
      REASON_DIGEST,
      ISSUED_AT,
      null,
    ]);
  });

  it.each([
    { decision: allowedDecision() },
    { decision: deniedDecision(), tokenDigest: TOKEN_DIGEST },
    {
      decision: allowedDecision({ workspaceId: 'numeric-1' }),
      tokenDigest: TOKEN_DIGEST,
    },
    {
      decision: allowedDecision({ policyDigest: 'short' }),
      tokenDigest: TOKEN_DIGEST,
    },
    {
      decision: allowedDecision({ issuedAt: '2026-08-07T04:00:00Z' }),
      tokenDigest: TOKEN_DIGEST,
    },
    {
      decision: allowedDecision({ expiresAt: ISSUED_AT }),
      tokenDigest: TOKEN_DIGEST,
    },
    {
      decision: allowedDecision(),
      tokenDigest: 'short',
    },
  ])(
    'rejects malformed decision input before opening a connection %#',
    async (input) => {
      const pool = new RecordingPool();
      const repository = new PostgresPrivacyAccessRepository(pool);
      await expect(
        repository.persistDecision(input as PrivacyDecisionPersistenceInput),
      ).rejects.toEqual(new PrivacyAccessPersistenceError());
      expect(pool.connectCalls).toBe(0);
    },
  );

  it('rolls back and sanitizes transaction failures', async () => {
    const pool = new RecordingPool();
    const original = pool.client.query.bind(pool.client);
    let call = 0;
    vi.spyOn(pool.client, 'query').mockImplementation(async (text, values) => {
      call += 1;
      if (call === 3) {
        throw new Error('database credential private');
      }
      return await original(text, values);
    });
    const repository = new PostgresPrivacyAccessRepository(pool);
    await expect(
      repository.persistDecision({
        decision: allowedDecision(),
        tokenDigest: TOKEN_DIGEST,
      }),
    ).rejects.toEqual(new PrivacyAccessPersistenceError());
    expect(pool.client.calls.at(-1)?.text.trim()).toBe('ROLLBACK');
    expect(pool.client.released).toBe(true);
  });
});

describe('PostgresPrivacyAccessRepository grant consumption', () => {
  it('atomically marks an exact unused unexpired grant consumed and appends one event', async () => {
    const pool = new RecordingPool();
    pool.client.queuedRows.push([], [consumedRow()], [], []);
    const repository = new PostgresPrivacyAccessRepository(pool);

    await expect(repository.consumeGrant(consumption())).resolves.toEqual({
      accessEventId: EVENT_ID,
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
      occurredAt: OCCURRED_AT,
    });

    expect(pool.client.calls.map((call) => call.text.trim())).toEqual([
      'BEGIN',
      expect.stringContaining('UPDATE privacy_access.privacy_access_grants'),
      expect.stringContaining(
        'INSERT INTO privacy_access.privacy_access_events',
      ),
      'COMMIT',
    ]);
    expect(pool.client.calls[1]?.text).toContain('consumed_at IS NULL');
    expect(pool.client.calls[1]?.text).toContain('expires_at > $10');
    expect(pool.client.calls[1]?.text).not.toContain('expires_at >= $10');
    expect(pool.client.calls[1]?.text).toContain('issued_at <= $10');
    expect(pool.client.calls[1]?.values).toEqual([
      GRANT_ID,
      DECISION_ID,
      WORKSPACE_ID,
      ACTOR_ID,
      TOKEN_DIGEST,
      PRIVACY_ACCESS_POLICY_REVISION_ID,
      PRIVACY_ACCESS_POLICY_DIGEST,
      EVENT_ID,
      OCCURRED_AT,
      OCCURRED_AT,
    ]);
    expect(pool.client.calls[2]?.values).toEqual([
      EVENT_ID,
      GRANT_ID,
      DECISION_ID,
      WORKSPACE_ID,
      ACTOR_ID,
      'workspace_operation',
      'read',
      'planning_content',
      'ordinary',
      PRIVACY_ACCESS_POLICY_REVISION_ID,
      PRIVACY_ACCESS_POLICY_DIGEST,
      REFERENCE_DIGEST,
      OCCURRED_AT,
    ]);
    expect(pool.client.released).toBe(true);
  });

  it('rolls back when the grant is missing, consumed, expired, or mismatched', async () => {
    const pool = new RecordingPool();
    pool.client.queuedRows.push([], []);
    const repository = new PostgresPrivacyAccessRepository(pool);
    await expect(repository.consumeGrant(consumption())).rejects.toEqual(
      new PrivacyAccessPersistenceError(),
    );
    expect(pool.client.calls.at(-1)?.text.trim()).toBe('ROLLBACK');
  });

  it.each([
    { tokenDigest: 'short' },
    { accessEventId: 'numeric-3' },
    { resourceReferenceDigest: 'short' },
    { occurredAt: '2026-08-07T04:05:00Z' },
    { claims: claims({ workspaceId: 'numeric-1' }) },
    { claims: claims({ policyDigest: 'short' }) },
    { claims: claims({ expiresAt: ISSUED_AT }) },
  ])(
    'rejects malformed consumption input before connection %#',
    async (override) => {
      const pool = new RecordingPool();
      const repository = new PostgresPrivacyAccessRepository(pool);
      await expect(
        repository.consumeGrant(consumption(override as never)),
      ).rejects.toEqual(new PrivacyAccessPersistenceError());
      expect(pool.connectCalls).toBe(0);
    },
  );

  it.each([
    { workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { actor_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { purpose_code: 'unknown' },
    { action_code: 'delete' },
    { resource_category: 'all_data' },
    { access_mode: 'emergency' },
    { policy_digest: 'short' },
    { occurred_at: 'not-a-date' },
  ])('rolls back on malformed returned row %#', async (rowOverride) => {
    const pool = new RecordingPool();
    pool.client.queuedRows.push([], [consumedRow(rowOverride)]);
    const repository = new PostgresPrivacyAccessRepository(pool);
    await expect(repository.consumeGrant(consumption())).rejects.toEqual(
      new PrivacyAccessPersistenceError(),
    );
    expect(pool.client.calls.at(-1)?.text.trim()).toBe('ROLLBACK');
  });

  it('rolls back the grant update if event append fails', async () => {
    const pool = new RecordingPool();
    pool.client.queuedRows.push([], [consumedRow()]);
    const original = pool.client.query.bind(pool.client);
    vi.spyOn(pool.client, 'query').mockImplementation(async (text, values) => {
      if (text.includes('INSERT INTO privacy_access.privacy_access_events')) {
        throw new Error('private event failure');
      }
      return await original(text, values);
    });
    const repository = new PostgresPrivacyAccessRepository(pool);
    await expect(repository.consumeGrant(consumption())).rejects.toEqual(
      new PrivacyAccessPersistenceError(),
    );
    expect(pool.client.calls.at(-1)?.text.trim()).toBe('ROLLBACK');
  });
});
