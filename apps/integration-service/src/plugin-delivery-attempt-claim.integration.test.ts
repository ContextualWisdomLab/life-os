import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  PluginDeliveryAttemptClaimSqlClient,
  PluginDeliveryAttemptClaimSqlResult,
} from './plugin-delivery-attempt-claim-repository';
import { PostgresPluginDeliveryAttemptClaimStore } from './plugin-delivery-attempt-claim-repository';
import { parsePluginDeliveryAttemptTestDatabaseTarget } from './plugin-delivery-attempt-test-database';

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const TEST_DATABASE_TARGET = DATABASE_URL
  ? parsePluginDeliveryAttemptTestDatabaseTarget(DATABASE_URL)
  : undefined;
const describeWithPostgres = TEST_DATABASE_TARGET ? describe : describe.skip;
const MIGRATIONS = [
  '0001_plugin_installation_record.sql',
  '0002_plugin_credential_binding_record.sql',
  '0003_plugin_operator_context_replay_record.sql',
  '0004_plugin_delivery_origin_grant_record.sql',
  '0005_plugin_credential_active_installation_guard.sql',
  '0006_plugin_delivery_attempt_record.sql',
  '0007_plugin_delivery_attempt_claim_lease.sql',
].map((name) =>
  readFileSync(join(__dirname, '..', 'migrations', name), 'utf8'),
);

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

class PoolSqlClient implements PluginDeliveryAttemptClaimSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PluginDeliveryAttemptClaimSqlResult<Row>> {
    const result = await this.pool.query<Row & QueryResultRow>(text, [...values]);
    return { rows: result.rows, rowCount: result.rowCount };
  }
}

let pool: Pool;

beforeAll(() => {
  if (TEST_DATABASE_TARGET && DATABASE_URL) {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  }
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});

async function prepareAttempt(maxAttempts = 2): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
  for (const migration of MIGRATIONS) {
    await pool.query(migration);
  }
  await pool.query(`
    INSERT INTO plugin_integration.plugin_installation_record (
      installation_id, workspace_id, installed_by_user_id, plugin_id,
      plugin_contract_version, manifest_sha256, granted_capabilities,
      installation_status, installed_at, revoked_at
    ) VALUES (
      '22222222-2222-4222-8222-222222222222',
      '${WORKSPACE_ID}', '${USER_ID}', 'example.plugin', '1.0.0',
      repeat('a', 64), ARRAY['delivery.https'], 'active',
      '2026-09-08T04:00:00.000Z', NULL
    );
    INSERT INTO plugin_integration.plugin_delivery_origin_grant_record (
      authority_version, grant_id, installation_id, workspace_id,
      granted_by_user_id, origin_uri, grant_status, granted_at, revoked_at
    ) VALUES (
      'life-os.plugin-delivery-origin.v1',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '${WORKSPACE_ID}', '${USER_ID}',
      'https://api.example.com', 'active', '2026-09-08T04:10:00.000Z', NULL
    );
    INSERT INTO plugin_integration.plugin_delivery_attempt_record (
      authority_version, delivery_id, grant_id, installation_id, workspace_id,
      requested_by_user_id, delivery_status, attempt_count, max_attempts,
      requested_at, updated_at, next_attempt_at, terminal_at, last_outcome_code
    ) VALUES (
      'life-os.plugin-delivery-attempt.v1', '${DELIVERY_ID}',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222', '${WORKSPACE_ID}', '${USER_ID}',
      'pending', 0, ${maxAttempts}, '2026-09-08T04:20:00.000Z',
      '2026-09-08T04:20:00.000Z', '2026-09-08T04:20:00.000Z', NULL, NULL
    );
  `);
}

describeWithPostgres('plugin delivery-attempt claim lease PostgreSQL acceptance', () => {
  beforeEach(async () => {
    await prepareAttempt();
  });

  it('allows one active lease, recovers exactly at expiry, and enforces the retry budget', async () => {
    const store = new PostgresPluginDeliveryAttemptClaimStore(
      new PoolSqlClient(pool),
    );
    const first = {
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      claimTokenDigest:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      claimedAt: '2026-09-08T10:30:00.000Z',
      leaseExpiresAt: '2026-09-08T10:31:00.000Z',
    } as const;
    const competing = {
      ...first,
      claimTokenDigest:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      claimedAt: '2026-09-08T10:30:30.000Z',
      leaseExpiresAt: '2026-09-08T10:31:30.000Z',
    } as const;
    const recovered = {
      ...first,
      claimTokenDigest:
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      claimedAt: '2026-09-08T10:31:00.000Z',
      leaseExpiresAt: '2026-09-08T10:32:00.000Z',
    } as const;

    await expect(store.claimDue(first)).resolves.toMatchObject({
      attemptNumber: 1,
      claimedAt: first.claimedAt,
      leaseExpiresAt: first.leaseExpiresAt,
    });
    await expect(store.claimDue(competing)).resolves.toBeUndefined();
    await expect(store.claimDue(recovered)).resolves.toMatchObject({
      attemptNumber: 2,
      claimedAt: recovered.claimedAt,
      leaseExpiresAt: recovered.leaseExpiresAt,
    });
    await expect(
      store.claimDue({
        ...recovered,
        claimTokenDigest:
          'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        claimedAt: '2026-09-08T10:32:00.000Z',
        leaseExpiresAt: '2026-09-08T10:33:00.000Z',
      }),
    ).resolves.toBeUndefined();

    const durable = await pool.query<{
      attempt_count: number;
      claim_token_digest: string;
    }>(
      `SELECT attempt_count, claim_token_digest
       FROM plugin_integration.plugin_delivery_attempt_record
       WHERE delivery_id = $1::uuid`,
      [DELIVERY_ID],
    );
    expect(durable.rows).toEqual([
      {
        attempt_count: 2,
        claim_token_digest: recovered.claimTokenDigest,
      },
    ]);
  });

  it('persists no raw worker claim token and keeps lease columns structurally bounded', async () => {
    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'plugin_integration'
        AND table_name = 'plugin_delivery_attempt_record'
        AND column_name LIKE 'claim_%'
      ORDER BY column_name;
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'claim_expires_at',
      'claim_started_at',
      'claim_token_digest',
    ]);
    const comment = await pool.query<{ comment: string }>(`
      SELECT obj_description(
        'plugin_integration.plugin_delivery_attempt_record'::regclass,
        'pg_class'
      ) AS comment;
    `);
    expect(comment.rows[0]?.comment).toContain('SHA-256 token digest');
  });
});
