import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptExecutionFenceApplication,
  PluginDeliveryAttemptExecutionFenceAuthorityError,
} from './plugin-delivery-attempt-execution-fence';
import type {
  PluginDeliveryAttemptExecutionFenceSqlClient,
  PluginDeliveryAttemptExecutionFenceSqlResult,
} from './plugin-delivery-attempt-execution-fence-repository';
import { PostgresPluginDeliveryAttemptExecutionFenceStore } from './plugin-delivery-attempt-execution-fence-repository';
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
  '0010_plugin_delivery_attempt_control_lifecycle.sql',
  '0011_plugin_delivery_attempt_control_chronology_guard.sql',
].map((name) =>
  readFileSync(join(__dirname, '..', 'migrations', name), 'utf8'),
);

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN = '66666666-6666-4666-8666-666666666666';
const CLAIM_TOKEN_DIGEST =
  'a9703d75e61670054471bf04ee63439c365fcb5f0c54dcb9d8d44ffb30cc56a1';
const CHECKED_AT = '2026-09-09T02:00:00.000Z';
const CLAIM_EXPIRES_AT = '2026-09-09T02:05:00.000Z';

class PoolSqlClient implements PluginDeliveryAttemptExecutionFenceSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PluginDeliveryAttemptExecutionFenceSqlResult<Row>> {
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

async function prepareClaimedAttempt(): Promise<void> {
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
      '${INSTALLATION_ID}', '${WORKSPACE_ID}', '${USER_ID}', 'example.plugin',
      '1.0.0', repeat('a', 64), ARRAY['delivery.https'], 'active',
      '2026-09-09T01:00:00.000Z', NULL
    );
    INSERT INTO plugin_integration.plugin_delivery_origin_grant_record (
      authority_version, grant_id, installation_id, workspace_id,
      granted_by_user_id, origin_uri, grant_status, granted_at, revoked_at
    ) VALUES (
      'life-os.plugin-delivery-origin.v1', '${GRANT_ID}', '${INSTALLATION_ID}',
      '${WORKSPACE_ID}', '${USER_ID}', 'https://api.example.com', 'active',
      '2026-09-09T01:10:00.000Z', NULL
    );
    INSERT INTO plugin_integration.plugin_delivery_attempt_record (
      authority_version, delivery_id, grant_id, installation_id, workspace_id,
      requested_by_user_id, delivery_status, attempt_count, max_attempts,
      requested_at, updated_at, next_attempt_at, terminal_at, last_outcome_code,
      claim_token_digest, claim_started_at, claim_expires_at
    ) VALUES (
      'life-os.plugin-delivery-attempt.v1', '${DELIVERY_ID}', '${GRANT_ID}',
      '${INSTALLATION_ID}', '${WORKSPACE_ID}', '${USER_ID}', 'pending', 1, 3,
      '2026-09-09T01:20:00.000Z', '2026-09-09T01:55:00.000Z',
      '2026-09-09T01:20:00.000Z', NULL, NULL, '${CLAIM_TOKEN_DIGEST}',
      '2026-09-09T01:55:00.000Z', '${CLAIM_EXPIRES_AT}'
    );
  `);
}

function app(): PluginDeliveryAttemptExecutionFenceApplication {
  return new PluginDeliveryAttemptExecutionFenceApplication(
    new PostgresPluginDeliveryAttemptExecutionFenceStore(new PoolSqlClient(pool)),
    () => new Date(CHECKED_AT),
  );
}

function context() {
  return { workspaceId: WORKSPACE_ID, actorUserId: USER_ID };
}

async function durableClaimSnapshot() {
  const result = await pool.query<{
    attempt_count: number;
    claim_token_digest: string;
    claim_started_at: Date;
    claim_expires_at: Date;
  }>(
    `SELECT attempt_count, claim_token_digest, claim_started_at, claim_expires_at
     FROM plugin_integration.plugin_delivery_attempt_record
     WHERE delivery_id = $1::uuid`,
    [DELIVERY_ID],
  );
  return result.rows.map((row) => ({
    attemptCount: row.attempt_count,
    claimTokenDigest: row.claim_token_digest,
    claimStartedAt: row.claim_started_at.toISOString(),
    claimExpiresAt: row.claim_expires_at.toISOString(),
  }));
}

describeWithPostgres(
  'plugin delivery-attempt pre-execution fence PostgreSQL acceptance',
  () => {
    beforeEach(async () => {
      await prepareClaimedAttempt();
    });

    it('accepts only the exact live claim with active grant and installation', async () => {
      await expect(app().check(context(), DELIVERY_ID, CLAIM_TOKEN)).resolves.toEqual({
        authorityVersion: 'life-os.plugin-delivery-attempt-execution-fence.v1',
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        attemptNumber: 1,
        checkedAt: CHECKED_AT,
        claimExpiresAt: CLAIM_EXPIRES_AT,
      });
    });

    it('fails closed after delivery-origin revocation without mutating the accepted claim', async () => {
      const before = await durableClaimSnapshot();
      await pool.query(
        `UPDATE plugin_integration.plugin_delivery_origin_grant_record
         SET grant_status = 'revoked', revoked_at = $2::timestamptz
         WHERE grant_id = $1::uuid`,
        [GRANT_ID, '2026-09-09T01:59:00.000Z'],
      );

      await expect(
        app().check(context(), DELIVERY_ID, CLAIM_TOKEN),
      ).rejects.toEqual(new PluginDeliveryAttemptExecutionFenceAuthorityError());
      await expect(durableClaimSnapshot()).resolves.toEqual(before);
    });

    it('fails closed after installation revocation without mutating the accepted claim', async () => {
      const before = await durableClaimSnapshot();
      await pool.query(
        `UPDATE plugin_integration.plugin_installation_record
         SET installation_status = 'revoked', revoked_at = $2::timestamptz
         WHERE installation_id = $1::uuid`,
        [INSTALLATION_ID, '2026-09-09T01:59:00.000Z'],
      );

      await expect(
        app().check(context(), DELIVERY_ID, CLAIM_TOKEN),
      ).rejects.toEqual(new PluginDeliveryAttemptExecutionFenceAuthorityError());
      await expect(durableClaimSnapshot()).resolves.toEqual(before);
    });
  },
);
