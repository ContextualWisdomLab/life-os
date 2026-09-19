import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptControlApplication,
  PluginDeliveryAttemptControlAuthorityError,
} from './plugin-delivery-attempt-control';
import {
  PostgresPluginDeliveryAttemptControlStore,
  type PluginDeliveryAttemptControlSqlClient,
  type PluginDeliveryAttemptControlSqlResult,
} from './plugin-delivery-attempt-control-repository';
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
  '0008_plugin_delivery_attempt_retry_transition.sql',
  '0009_plugin_delivery_attempt_outcome_record.sql',
  '0010_plugin_delivery_attempt_control_lifecycle.sql',
].map((name) =>
  readFileSync(join(__dirname, '..', 'migrations', name), 'utf8'),
);

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_DIGEST = 'a'.repeat(64);

class PoolSqlClient
  implements
    PluginDeliveryAttemptControlSqlClient,
    PluginDeliveryAttemptClaimSqlClient,
    PluginDeliveryAttemptRetrySqlClient
{
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<
    | PluginDeliveryAttemptControlSqlResult<Row>
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

async function prepareAttempt(maxAttempts = 3): Promise<void> {
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
      '2026-09-08T04:20:00.000Z', '2026-09-09T01:05:00.000Z', NULL, NULL
    );
  `);
}

function context() {
  return { workspaceId: WORKSPACE_ID, actorUserId: USER_ID };
}

describeWithPostgres('plugin delivery control PostgreSQL acceptance', () => {
  beforeEach(async () => {
    await prepareAttempt();
  });

  it('durably pauses and resumes without consuming retry identity and appends both controls', async () => {
    const client = new PoolSqlClient(pool);
    const store = new PostgresPluginDeliveryAttemptControlStore(client);
    let now = '2026-09-09T01:00:00.000Z';
    const app = new PluginDeliveryAttemptControlApplication(
      store,
      () => new Date(now),
    );

    await expect(app.pause(context(), DELIVERY_ID)).resolves.toMatchObject({
      controlSequence: 1,
      controlCode: 'pause',
      deliveryStatus: 'paused',
      nextAttemptAt: '2026-09-09T01:05:00.000Z',
      terminalAt: null,
    });

    now = '2026-09-09T01:02:00.000Z';
    await expect(app.resume(context(), DELIVERY_ID)).resolves.toMatchObject({
      controlSequence: 2,
      controlCode: 'resume',
      deliveryStatus: 'pending',
      nextAttemptAt: now,
      terminalAt: null,
    });

    const attempt = await pool.query(
      `SELECT delivery_status, attempt_count, max_attempts, control_sequence,
              next_attempt_at, terminal_at, last_outcome_code,
              claim_token_digest, claim_started_at, claim_expires_at
       FROM plugin_integration.plugin_delivery_attempt_record
       WHERE delivery_id = $1::uuid`,
      [DELIVERY_ID],
    );
    expect(attempt.rows).toEqual([
      {
        delivery_status: 'pending',
        attempt_count: 0,
        max_attempts: 3,
        control_sequence: 2,
        next_attempt_at: new Date(now),
        terminal_at: null,
        last_outcome_code: null,
        claim_token_digest: null,
        claim_started_at: null,
        claim_expires_at: null,
      },
    ]);

    const controls = await pool.query(
      `SELECT control_sequence, control_code, delivery_status, occurred_at,
              next_attempt_at, terminal_at
       FROM plugin_integration.plugin_delivery_attempt_control_record
       WHERE delivery_id = $1::uuid
       ORDER BY control_sequence`,
      [DELIVERY_ID],
    );
    expect(controls.rows).toEqual([
      {
        control_sequence: 1,
        control_code: 'pause',
        delivery_status: 'paused',
        occurred_at: new Date('2026-09-09T01:00:00.000Z'),
        next_attempt_at: new Date('2026-09-09T01:05:00.000Z'),
        terminal_at: null,
      },
      {
        control_sequence: 2,
        control_code: 'resume',
        delivery_status: 'pending',
        occurred_at: new Date(now),
        next_attempt_at: new Date(now),
        terminal_at: null,
      },
    ]);
  });

  it('does not let pause steal an active worker claim', async () => {
    const client = new PoolSqlClient(pool);
    const claims = new PostgresPluginDeliveryAttemptClaimStore(client);
    const app = new PluginDeliveryAttemptControlApplication(
      new PostgresPluginDeliveryAttemptControlStore(client),
      () => new Date('2026-09-09T01:06:10.000Z'),
    );

    await expect(
      claims.claimDue({
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        claimTokenDigest: CLAIM_DIGEST,
        claimedAt: '2026-09-09T01:06:00.000Z',
        leaseExpiresAt: '2026-09-09T01:07:00.000Z',
      }),
    ).resolves.toMatchObject({ attemptNumber: 1 });

    await expect(app.pause(context(), DELIVERY_ID)).rejects.toMatchObject({
      name: PluginDeliveryAttemptControlAuthorityError.name,
      message: 'Plugin delivery attempt control authority is invalid',
    });
  });

  it('dead-letters only real retry exhaustion and preserves the terminal instant', async () => {
    await prepareAttempt(1);
    const client = new PoolSqlClient(pool);
    const claims = new PostgresPluginDeliveryAttemptClaimStore(client);
    const retries = new PostgresPluginDeliveryAttemptRetryStore(client);
    const app = new PluginDeliveryAttemptControlApplication(
      new PostgresPluginDeliveryAttemptControlStore(client),
      () => new Date('2026-09-09T01:08:00.000Z'),
    );

    await claims.claimDue({
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      claimTokenDigest: CLAIM_DIGEST,
      claimedAt: '2026-09-09T01:06:00.000Z',
      leaseExpiresAt: '2026-09-09T01:07:00.000Z',
    });
    await retries.recordRetryableFailure({
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      claimTokenDigest: CLAIM_DIGEST,
      occurredAt: '2026-09-09T01:06:10.000Z',
    });

    await expect(app.deadLetter(context(), DELIVERY_ID)).resolves.toMatchObject(
      {
        controlSequence: 1,
        controlCode: 'dead_letter',
        deliveryStatus: 'dead_lettered',
        nextAttemptAt: null,
        terminalAt: '2026-09-09T01:06:10.000Z',
      },
    );

    const outcome = await pool.query(
      `SELECT attempt_number, outcome_code, occurred_at
       FROM plugin_integration.plugin_delivery_attempt_outcome_record
       WHERE delivery_id = $1::uuid`,
      [DELIVERY_ID],
    );
    expect(outcome.rows).toEqual([
      {
        attempt_number: 1,
        outcome_code: 'attempt_limit',
        occurred_at: new Date('2026-09-09T01:06:10.000Z'),
      },
    ]);
  });

  it('rejects forged and mutable control evidence', async () => {
    await expect(
      pool.query(
        `INSERT INTO plugin_integration.plugin_delivery_attempt_control_record (
           authority_version, delivery_id, workspace_id, requested_by_user_id,
           control_sequence, control_code, delivery_status, occurred_at,
           next_attempt_at, terminal_at
         ) VALUES (
           'life-os.plugin-delivery-attempt-control.v1', $1::uuid, $2::uuid,
           $3::uuid, 1, 'pause', 'paused', $4::timestamptz,
           $5::timestamptz, NULL
         )`,
        [
          DELIVERY_ID,
          WORKSPACE_ID,
          USER_ID,
          '2026-09-09T01:00:00.000Z',
          '2026-09-09T01:05:00.000Z',
        ],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'plugin_delivery_attempt_control_source_transition_check',
    });

    const client = new PoolSqlClient(pool);
    const app = new PluginDeliveryAttemptControlApplication(
      new PostgresPluginDeliveryAttemptControlStore(client),
      () => new Date('2026-09-09T01:00:00.000Z'),
    );
    await app.pause(context(), DELIVERY_ID);

    await expect(
      pool.query(
        `UPDATE plugin_integration.plugin_delivery_attempt_control_record
         SET delivery_status = 'pending'
         WHERE delivery_id = $1::uuid`,
        [DELIVERY_ID],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        `DELETE FROM plugin_integration.plugin_delivery_attempt_control_record
         WHERE delivery_id = $1::uuid`,
        [DELIVERY_ID],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        'TRUNCATE TABLE plugin_integration.plugin_delivery_attempt_control_record',
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });
});
