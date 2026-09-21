import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptStatusApplication,
  PluginDeliveryAttemptStatusAuthorityError,
} from './plugin-delivery-attempt-status';
import type {
  PluginDeliveryAttemptStatusSqlClient,
  PluginDeliveryAttemptStatusSqlResult,
} from './plugin-delivery-attempt-status-repository';
import { PostgresPluginDeliveryAttemptStatusStore } from './plugin-delivery-attempt-status-repository';
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
const OTHER_USER_ID = '77777777-7777-4777-8777-777777777777';
const CLAIM_TOKEN_DIGEST =
  'a9703d75e61670054471bf04ee63439c365fcb5f0c54dcb9d8d44ffb30cc56a1';
const CHECKED_AT = '2026-09-09T03:00:00.000Z';
const CLAIM_EXPIRES_AT = '2026-09-09T03:05:00.000Z';

class PoolSqlClient implements PluginDeliveryAttemptStatusSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PluginDeliveryAttemptStatusSqlResult<Row>> {
    const result = await this.pool.query<Row & QueryResultRow>(text, [
      ...values,
    ]);
    return { rows: result.rows, rowCount: result.rowCount };
  }
}

let fixturePool: Pool;

beforeAll(() => {
  if (TEST_DATABASE_TARGET && DATABASE_URL) {
    fixturePool = new Pool({ connectionString: DATABASE_URL, max: 4 });
  }
});

afterAll(async () => {
  if (fixturePool) {
    await fixturePool.end();
  }
});

async function prepareClaimedAttempt(): Promise<void> {
  await fixturePool.query('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
  for (const migration of MIGRATIONS) {
    await fixturePool.query(migration);
  }
  await fixturePool.query(`
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
      '2026-09-09T01:20:00.000Z', '2026-09-09T02:55:00.000Z',
      '2026-09-09T01:20:00.000Z', NULL, NULL, '${CLAIM_TOKEN_DIGEST}',
      '2026-09-09T02:55:00.000Z', '${CLAIM_EXPIRES_AT}'
    );
  `);
}

function context(userId = USER_ID) {
  return { workspaceId: WORKSPACE_ID, actorUserId: userId };
}

async function readWithFreshPool(userId = USER_ID) {
  if (!DATABASE_URL) {
    throw new Error('database unavailable');
  }
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1 });
  try {
    const app = new PluginDeliveryAttemptStatusApplication(
      new PostgresPluginDeliveryAttemptStatusStore(new PoolSqlClient(pool)),
      () => new Date(CHECKED_AT),
    );
    return await app.read(context(userId), DELIVERY_ID);
  } finally {
    await pool.end();
  }
}

describeWithPostgres(
  'plugin delivery-attempt operator status PostgreSQL acceptance',
  () => {
    beforeEach(async () => {
      await prepareClaimedAttempt();
    });

    it('recovers the same credential-free active-claim status after repository restart', async () => {
      const first = await readWithFreshPool();
      const second = await readWithFreshPool();

      expect(first).toEqual({
        authorityVersion: 'life-os.plugin-delivery-attempt-status.v1',
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        deliveryStatus: 'pending',
        attemptCount: 1,
        maxAttempts: 3,
        requestedAt: '2026-09-09T01:20:00.000Z',
        updatedAt: '2026-09-09T02:55:00.000Z',
        nextAttemptAt: '2026-09-09T01:20:00.000Z',
        terminalAt: null,
        lastOutcomeCode: null,
        controlSequence: 0,
        claimState: 'active',
        checkedAt: CHECKED_AT,
      });
      expect(second).toEqual(first);
      expect(Object.keys(second)).not.toContain('claimTokenDigest');
    });

    it('reports an expired claim from durable time evidence without exposing its digest', async () => {
      await fixturePool.query(
        `UPDATE plugin_integration.plugin_delivery_attempt_record
         SET claim_expires_at = $2::timestamptz
         WHERE delivery_id = $1::uuid`,
        [DELIVERY_ID, '2026-09-09T02:59:59.000Z'],
      );

      await expect(readWithFreshPool()).resolves.toMatchObject({
        claimState: 'expired',
        checkedAt: CHECKED_AT,
      });
    });

    it('fails closed for a different requesting user in the same workspace', async () => {
      await expect(readWithFreshPool(OTHER_USER_ID)).rejects.toEqual(
        new PluginDeliveryAttemptStatusAuthorityError(),
      );
    });
  },
);
