import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PostgresPluginDeliveryAttemptClaimStore,
  type PluginDeliveryAttemptClaimSqlClient,
  type PluginDeliveryAttemptClaimSqlResult,
} from './plugin-delivery-attempt-claim-repository';
import {
  PostgresPluginDeliveryAttemptRetryStore,
  type PluginDeliveryAttemptRetrySqlClient,
  type PluginDeliveryAttemptRetrySqlResult,
} from './plugin-delivery-attempt-retry-repository';
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
const CLAIM_DIGEST = 'a'.repeat(64);

class PoolSqlClient
  implements
    PluginDeliveryAttemptClaimSqlClient,
    PluginDeliveryAttemptRetrySqlClient
{
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<
    | PluginDeliveryAttemptClaimSqlResult<Row>
    | PluginDeliveryAttemptRetrySqlResult<Row>
  > {
    const result = await this.pool.query<Row & QueryResultRow>(text, [
      ...values,
    ]);
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

describeWithPostgres(
  'plugin delivery retry PostgreSQL acceptance',
  () => {
    beforeEach(async () => {
      await prepareAttempt();
    });

    it('consumes an active claim and durably schedules the deterministic retry', async () => {
      const client = new PoolSqlClient(pool);
      const claims = new PostgresPluginDeliveryAttemptClaimStore(client);
      const retries = new PostgresPluginDeliveryAttemptRetryStore(client);

      await expect(
        claims.claimDue({
          deliveryId: DELIVERY_ID,
          workspaceId: WORKSPACE_ID,
          requestedByUserId: USER_ID,
          claimTokenDigest: CLAIM_DIGEST,
          claimedAt: '2026-09-08T13:00:00.000Z',
          leaseExpiresAt: '2026-09-08T13:01:00.000Z',
        }),
      ).resolves.toMatchObject({ attemptNumber: 1 });

      await expect(
        retries.recordRetryableFailure({
          deliveryId: DELIVERY_ID,
          workspaceId: WORKSPACE_ID,
          requestedByUserId: USER_ID,
          claimTokenDigest: CLAIM_DIGEST,
          occurredAt: '2026-09-08T13:00:10.000Z',
        }),
      ).resolves.toMatchObject({
        attemptNumber: 1,
        deliveryStatus: 'pending',
        outcomeCode: 'retryable_failure',
        nextAttemptAt: '2026-09-08T13:00:40.000Z',
        terminalAt: null,
      });

      const durable = await pool.query<{
        attempt_count: number;
        delivery_status: string;
        last_outcome_code: string | null;
        next_attempt_at: Date;
        claim_token_digest: string | null;
        claim_started_at: Date | null;
        claim_expires_at: Date | null;
      }>(
        `SELECT attempt_count, delivery_status, last_outcome_code,
                next_attempt_at, claim_token_digest, claim_started_at, claim_expires_at
         FROM plugin_integration.plugin_delivery_attempt_record
         WHERE delivery_id = $1::uuid`,
        [DELIVERY_ID],
      );
      expect(durable.rows).toEqual([
        {
          attempt_count: 1,
          delivery_status: 'pending',
          last_outcome_code: 'retryable_failure',
          next_attempt_at: new Date('2026-09-08T13:00:40.000Z'),
          claim_token_digest: null,
          claim_started_at: null,
          claim_expires_at: null,
        },
      ]);
    });
  },
);
