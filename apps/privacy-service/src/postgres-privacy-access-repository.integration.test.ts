import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  PrivacyAccessApplication,
  readOriginalPersonalData,
} from './privacy-access-application';
import {
  PostgresPrivacyAccessRepository,
  type PrivacySqlPool,
  type PrivacySqlQueryResult,
  type PrivacySqlTransactionClient,
} from './postgres-privacy-access-repository';
import { parsePrivacyGrantKeyRing } from './privacy-access-token';

const DATABASE_URL = process.env.PRIVACY_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DECISION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-08-07T07:00:00.000Z');
const AUDIT_KEY = Buffer.alloc(32, 0x41).toString('base64url');
const GRANT_KEY = Buffer.alloc(32, 0x42).toString('base64url');
let administrativePool: Pool;

class PgTransactionClient implements PrivacySqlTransactionClient {
  constructor(private readonly client: PoolClient) {}

  async query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PrivacySqlQueryResult<Row>> {
    const result = await this.client.query<Row>(
      text,
      values === undefined ? undefined : [...values],
    );
    return { rows: result.rows };
  }

  release(): void {
    this.client.release();
  }
}

class PgPrivacyPool implements PrivacySqlPool {
  constructor(private readonly pool: Pool) {}

  async connect(): Promise<PrivacySqlTransactionClient> {
    return new PgTransactionClient(await this.pool.connect());
  }
}

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('PRIVACY_DATABASE_URL is required');
  }
  return DATABASE_URL;
}

async function applyMigration(pool: Pool): Promise<void> {
  const migration = await readFile(
    resolve(__dirname, '../migrations/0001_purpose_bound_privacy_access.sql'),
    'utf8',
  );
  await pool.query(migration);
}

function application(pool: Pool) {
  const identifiers = [DECISION_ID, GRANT_ID];
  return new PrivacyAccessApplication({
    repository: new PostgresPrivacyAccessRepository(new PgPrivacyPool(pool)),
    grantKeyRing: parsePrivacyGrantKeyRing({
      PRIVACY_GRANT_ACTIVE_KEY_ID: 'privacy-active',
      PRIVACY_GRANT_ACTIVE_KEY_SECRET: GRANT_KEY,
    }),
    auditDigestKey: AUDIT_KEY,
    uuidFactory: () => identifiers.shift() ?? EVENT_ID,
    clock: () => new Date(NOW.getTime()),
  });
}

describeWithPostgres('PostgreSQL purpose-bound privacy access', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-privacy-integration-admin',
      max: 20,
    });
    await administrativePool.query(
      'DROP SCHEMA IF EXISTS privacy_access CASCADE',
    );
    await applyMigration(administrativePool);
  }, 30_000);

  beforeEach(async () => {
    await administrativePool.query(
      'TRUNCATE privacy_access.privacy_access_events, privacy_access.privacy_access_grants, privacy_access.privacy_access_decisions',
    );
  });

  afterAll(async () => {
    await administrativePool.query(
      'DROP SCHEMA IF EXISTS privacy_access CASCADE',
    );
    await administrativePool.end();
  }, 30_000);

  it('persists allow and deny decisions without raw reason or grant token', async () => {
    const service = application(administrativePool);
    const reason =
      'Support case SUP-8841 requires exact identity verification.';
    const allowed = await service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'account_support',
      action: 'read',
      resourceCategory: 'identity_profile',
      requestedTtlSeconds: 300,
      reason,
    });
    const denied = await service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'export',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 300,
    });

    const decisions = await administrativePool.query(
      `SELECT *
       FROM privacy_access.privacy_access_decisions
       ORDER BY created_at, decision_id`,
    );
    const grants = await administrativePool.query(
      'SELECT * FROM privacy_access.privacy_access_grants',
    );
    expect(decisions.rows).toHaveLength(2);
    expect(grants.rows).toHaveLength(1);
    expect(denied.decision.outcome).toBe('denied');
    const serialized = JSON.stringify({
      decisions: decisions.rows,
      grants: grants.rows,
    });
    expect(serialized).not.toContain(reason);
    expect(serialized).not.toContain(allowed.grantToken ?? 'missing');
    expect(serialized).toContain(allowed.decision.reasonDigest);
  });

  it('survives a pool restart and permits exactly one concurrent consumption', async () => {
    const issuingPool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-privacy-issuing-runtime',
      max: 4,
    });
    const issued = await application(issuingPool).decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
    await issuingPool.end();

    const restartedPool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-privacy-restarted-runtime',
      max: 20,
    });
    const restarted = application(restartedPool);
    const attempts = await Promise.allSettled(
      Array.from({ length: 16 }, () =>
        restarted.consume({
          workspaceId: WORKSPACE_ID,
          actorId: ACTOR_ID,
          grantToken: issued.grantToken ?? '',
          resourceReference: 'planning-item-primary',
        }),
      ),
    );
    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      attempts.filter((result) => result.status === 'rejected'),
    ).toHaveLength(15);
    const events = await restartedPool.query(
      'SELECT * FROM privacy_access.privacy_access_events',
    );
    const grants = await restartedPool.query(
      'SELECT consumed_at, consumed_event_id FROM privacy_access.privacy_access_grants',
    );
    expect(events.rows).toHaveLength(1);
    expect(grants.rows).toEqual([
      expect.objectContaining({
        consumed_at: expect.any(Date),
        consumed_event_id: EVENT_ID,
      }),
    ]);
    await restartedPool.end();
  });

  it('fails closed for cross-tenant, cross-actor, expired, and replayed grants', async () => {
    const service = application(administrativePool);
    const issued = await service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 30,
    });
    for (const command of [
      {
        workspaceId: OTHER_WORKSPACE_ID,
        actorId: ACTOR_ID,
        grantToken: issued.grantToken ?? '',
      },
      {
        workspaceId: WORKSPACE_ID,
        actorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        grantToken: issued.grantToken ?? '',
      },
    ]) {
      await expect(service.consume(command)).rejects.toThrow();
    }
    await administrativePool.query(
      `UPDATE privacy_access.privacy_access_grants
       SET consumed_at = $1::timestamptz,
           consumed_event_id = $2::uuid
       WHERE grant_id = $3::uuid`,
      [NOW.toISOString(), EVENT_ID, GRANT_ID],
    );
    await expect(
      service.consume({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        grantToken: issued.grantToken ?? '',
      }),
    ).rejects.toThrow();
  });

  it('rejects update/delete of evidence and arbitrary grant mutation', async () => {
    const service = application(administrativePool);
    const issued = await service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'workspace_operation',
      action: 'read',
      resourceCategory: 'planning_content',
      requestedTtlSeconds: 600,
    });
    await service.consume({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      grantToken: issued.grantToken ?? '',
    });
    for (const statement of [
      "UPDATE privacy_access.privacy_access_decisions SET purpose_code = 'legal_obligation'",
      'DELETE FROM privacy_access.privacy_access_decisions',
      "UPDATE privacy_access.privacy_access_events SET action_code = 'export'",
      'DELETE FROM privacy_access.privacy_access_events',
      "UPDATE privacy_access.privacy_access_grants SET expires_at = expires_at + interval '1 hour'",
      'DELETE FROM privacy_access.privacy_access_grants',
    ]) {
      await expect(administrativePool.query(statement)).rejects.toThrow();
    }
  });

  it('returns exact original Unicode PII but never persists or logs those values', async () => {
    const service = application(administrativePool);
    const issued = await service.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      purpose: 'account_support',
      action: 'read',
      resourceCategory: 'identity_profile',
      requestedTtlSeconds: 300,
      reason: 'Support case SUP-9982 requires exact profile confirmation.',
    });
    const profile = Object.freeze({
      displayName: '홍길동',
      postalAddress: '대한민국 서울특별시 Example-gil ２１',
      phoneNumber: '+82-10-9876-5432',
      emailAddress: 'synthetic.person@example.test',
    });
    const reader = { read: vi.fn(async () => profile) };
    const returned = await readOriginalPersonalData(
      service,
      {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        grantToken: issued.grantToken ?? '',
        resourceReference: 'profile-primary',
      },
      reader,
    );
    expect(returned).toBe(profile);
    const evidence = await administrativePool.query(
      `SELECT row_to_json(decision_row)::text AS evidence
       FROM privacy_access.privacy_access_decisions AS decision_row
       UNION ALL
       SELECT row_to_json(grant_row)::text
       FROM privacy_access.privacy_access_grants AS grant_row
       UNION ALL
       SELECT row_to_json(event_row)::text
       FROM privacy_access.privacy_access_events AS event_row`,
    );
    const serialized = JSON.stringify(evidence.rows);
    for (const value of Object.values(profile)) {
      expect(serialized).not.toContain(value);
    }
  });
});
