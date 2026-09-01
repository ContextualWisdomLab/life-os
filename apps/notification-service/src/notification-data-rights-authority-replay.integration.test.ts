import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresNotificationDataRightsAuthorityReplayGuard } from './notification-data-rights-authority-replay';

const DATABASE_URL = process.env.NOTIFICATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const RUNTIME_ROLE = 'notification_data_rights_replay_runtime_test';
let administrativePool: Pool;
let runtimePool: Pool;

/** Requires the CI-provided PostgreSQL URL without exposing it in test failures. */
function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error(
      'NOTIFICATION_DATABASE_URL is required for integration tests',
    );
  }
  return DATABASE_URL;
}

/** Applies every Notification migration in forward order to a clean service schema. */
async function applyMigrations(pool: Pool): Promise<void> {
  for (const migration of [
    '0001_durable_reminder_inbox.sql',
    '0002_data_rights_erasure.sql',
    '0003_data_rights_authority_replay.sql',
  ]) {
    const sql = await readFile(
      resolve(__dirname, '../migrations', migration),
      'utf8',
    );
    await pool.query(sql);
  }
}

/** Creates the same least-privilege replay-table grant required from deployment. */
async function grantRuntimeReplayAuthority(pool: Pool): Promise<void> {
  await pool.query(`
    GRANT USAGE ON SCHEMA notification_service TO ${RUNTIME_ROLE};
    REVOKE ALL PRIVILEGES ON TABLE
      notification_service.data_rights_authority_replay_records
      FROM ${RUNTIME_ROLE};
    GRANT SELECT, INSERT, DELETE ON TABLE
      notification_service.data_rights_authority_replay_records
      TO ${RUNTIME_ROLE};
  `);
}

describeWithPostgres(
  'Notification destructive authority replay PostgreSQL integration',
  () => {
    beforeAll(async () => {
      administrativePool = new Pool({
        connectionString: requireDatabaseUrl(),
        application_name: 'life-os-notification-replay-admin',
        max: 2,
      });
      await administrativePool.query(`DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${RUNTIME_ROLE}'
          ) THEN
            CREATE ROLE ${RUNTIME_ROLE} NOLOGIN;
          END IF;
        END
      $$`);
      runtimePool = new Pool({
        connectionString: requireDatabaseUrl(),
        application_name: 'life-os-notification-replay-runtime',
        options: `-c role=${RUNTIME_ROLE}`,
        max: 2,
      });
    });

    beforeEach(async () => {
      await runtimePool.end();
      await administrativePool.query('RESET ROLE');
      await administrativePool.query(
        'DROP SCHEMA IF EXISTS notification_service CASCADE',
      );
      await applyMigrations(administrativePool);
      await grantRuntimeReplayAuthority(administrativePool);
      runtimePool = new Pool({
        connectionString: requireDatabaseUrl(),
        application_name: 'life-os-notification-replay-runtime',
        options: `-c role=${RUNTIME_ROLE}`,
        max: 2,
      });
    });

    afterAll(async () => {
      await runtimePool.end().catch(() => undefined);
      await administrativePool.query('RESET ROLE').catch(() => undefined);
      await administrativePool
        .query('DROP SCHEMA IF EXISTS notification_service CASCADE')
        .catch(() => undefined);
      await administrativePool
        .query(`DROP OWNED BY ${RUNTIME_ROLE}`)
        .catch(() => undefined);
      await administrativePool
        .query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`)
        .catch(() => undefined);
      await administrativePool.end();
    });

    it('allows the runtime role to consume one live digest exactly once', async () => {
      const guard = new PostgresNotificationDataRightsAuthorityReplayGuard(
        runtimePool,
      );
      const evidence = {
        evidenceDigest: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };

      await expect(guard.consume(evidence)).resolves.toBe(true);
      await expect(guard.consume(evidence)).resolves.toBe(false);

      const stored = await administrativePool.query<{
        evidence_digest: string;
        consumed_at: Date;
        expires_at: Date;
      }>(
        `SELECT evidence_digest, consumed_at, expires_at
         FROM notification_service.data_rights_authority_replay_records`,
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]?.evidence_digest).toBe(evidence.evidenceDigest);
      expect(stored.rows[0]?.consumed_at).toBeInstanceOf(Date);
      expect(stored.rows[0]?.expires_at).toBeInstanceOf(Date);
    });

    it('prunes expired evidence and never grants update authority to the runtime role', async () => {
      await administrativePool.query(
        `INSERT INTO notification_service.data_rights_authority_replay_records
           (evidence_digest, expires_at)
         VALUES ($1, now() - interval '1 second')`,
        ['b'.repeat(64)],
      );
      const guard = new PostgresNotificationDataRightsAuthorityReplayGuard(
        runtimePool,
      );
      await expect(
        guard.consume({
          evidenceDigest: 'c'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      ).resolves.toBe(true);

      const digests = await administrativePool.query<{ evidence_digest: string }>(
        `SELECT evidence_digest
         FROM notification_service.data_rights_authority_replay_records
         ORDER BY evidence_digest`,
      );
      expect(digests.rows).toEqual([{ evidence_digest: 'c'.repeat(64) }]);

      await expect(
        runtimePool.query(
          `UPDATE notification_service.data_rights_authority_replay_records
           SET expires_at = expires_at + interval '1 minute'
           WHERE evidence_digest = $1`,
          ['c'.repeat(64)],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  },
);
