import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  '0008_plugin_delivery_attempt_retry_transition.sql',
  '0009_plugin_delivery_attempt_outcome_record.sql',
].map((name) =>
  readFileSync(join(__dirname, '..', 'migrations', name), 'utf8'),
);

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

let pool: Pool;

beforeAll(() => {
  if (TEST_DATABASE_TARGET && DATABASE_URL) {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  }
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});

beforeEach(async () => {
  await pool.query('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
  for (const migration of MIGRATIONS) {
    await pool.query(migration);
  }
  await pool.query(
    `INSERT INTO plugin_integration.plugin_installation_record (
       installation_id, workspace_id, installed_by_user_id, plugin_id,
       plugin_contract_version, manifest_sha256, granted_capabilities,
       installation_status, installed_at, revoked_at
     ) VALUES (
       '22222222-2222-4222-8222-222222222222',
       $1::uuid, $2::uuid, 'example.plugin', '1.0.0',
       repeat('a', 64), ARRAY['delivery.https'], 'active',
       '2026-09-08T04:00:00.000Z', NULL
     )`,
    [WORKSPACE_ID, USER_ID],
  );
  await pool.query(
    `INSERT INTO plugin_integration.plugin_delivery_origin_grant_record (
       authority_version, grant_id, installation_id, workspace_id,
       granted_by_user_id, origin_uri, grant_status, granted_at, revoked_at
     ) VALUES (
       'life-os.plugin-delivery-origin.v1',
       '11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222', $1::uuid, $2::uuid,
       'https://api.example.com', 'active', '2026-09-08T04:10:00.000Z', NULL
     )`,
    [WORKSPACE_ID, USER_ID],
  );
  await pool.query(
    `INSERT INTO plugin_integration.plugin_delivery_attempt_record (
       authority_version, delivery_id, grant_id, installation_id, workspace_id,
       requested_by_user_id, delivery_status, attempt_count, max_attempts,
       requested_at, updated_at, next_attempt_at, terminal_at, last_outcome_code
     ) VALUES (
       'life-os.plugin-delivery-attempt.v1', $3::uuid,
       '11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222', $1::uuid, $2::uuid,
       'pending', 0, 2, '2026-09-08T04:20:00.000Z',
       '2026-09-08T04:20:00.000Z', '2026-09-08T04:20:00.000Z', NULL, NULL
     )`,
    [WORKSPACE_ID, USER_ID, DELIVERY_ID],
  );
});

describeWithPostgres(
  'plugin delivery outcome source-transition acceptance',
  () => {
    it('rejects a directly forged outcome that was not emitted by a consumed claim transition', async () => {
      await expect(
        pool.query(
          `INSERT INTO plugin_integration.plugin_delivery_attempt_outcome_record (
           authority_version, delivery_id, attempt_number, outcome_code, occurred_at
         ) VALUES (
           'life-os.plugin-delivery-attempt-outcome.v1', $1::uuid, 1,
           'retryable_failure', '2026-09-08T13:00:10.000Z'
         )`,
          [DELIVERY_ID],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'plugin_delivery_attempt_outcome_source_transition_check',
      });

      const result = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM plugin_integration.plugin_delivery_attempt_outcome_record
        WHERE delivery_id = $1::uuid`,
        [DELIVERY_ID],
      );
      expect(result.rows).toEqual([{ count: '0' }]);

      const attempt = await pool.query<{
        attempt_count: number;
        claim_token_digest: string | null;
        last_outcome_code: string | null;
      }>(
        `SELECT attempt_count, claim_token_digest, last_outcome_code
           FROM plugin_integration.plugin_delivery_attempt_record
          WHERE delivery_id = $1::uuid`,
        [DELIVERY_ID],
      );
      expect(attempt.rows).toEqual([
        {
          attempt_count: 0,
          claim_token_digest: null,
          last_outcome_code: null,
        },
      ]);
    });
  },
);
