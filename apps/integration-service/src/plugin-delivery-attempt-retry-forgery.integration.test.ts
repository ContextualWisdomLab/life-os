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
].map((name) =>
  readFileSync(join(__dirname, '..', 'migrations', name), 'utf8'),
);

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const FORGED_DELIVERY_ID = '66666666-6666-4666-8666-666666666666';

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
       '22222222-2222-4222-8222-222222222222', $1::uuid, $2::uuid,
       'example.plugin', '1.0.0', repeat('a', 64), ARRAY['delivery.https'],
       'active', '2026-09-08T04:00:00.000Z', NULL
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
});

describeWithPostgres('plugin delivery retry creation boundary', () => {
  it('rejects direct insertion of a forged terminal lifecycle state', async () => {
    await expect(
      pool.query(
        `INSERT INTO plugin_integration.plugin_delivery_attempt_record (
           authority_version, delivery_id, grant_id, installation_id,
           workspace_id, requested_by_user_id, delivery_status, attempt_count,
           max_attempts, requested_at, updated_at, next_attempt_at, terminal_at,
           last_outcome_code, claim_token_digest, claim_started_at, claim_expires_at
         ) VALUES (
           'life-os.plugin-delivery-attempt.v1', $1::uuid,
           '11111111-1111-4111-8111-111111111111',
           '22222222-2222-4222-8222-222222222222', $2::uuid, $3::uuid,
           'failed', 1, 1, '2026-09-08T04:20:00.000Z',
           '2026-09-08T04:21:00.000Z', NULL, '2026-09-08T04:21:00.000Z',
           'attempt_limit', NULL, NULL, NULL
         )`,
        [FORGED_DELIVERY_ID, WORKSPACE_ID, USER_ID],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'plugin_delivery_attempt_initial_shape_check',
    });

    const durable = await pool.query(
      `SELECT delivery_id
         FROM plugin_integration.plugin_delivery_attempt_record
        WHERE delivery_id = $1::uuid`,
      [FORGED_DELIVERY_ID],
    );
    expect(durable.rowCount).toBe(0);
  });
});
