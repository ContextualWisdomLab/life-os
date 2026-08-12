import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.NOTIFICATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error(
      'NOTIFICATION_DATABASE_URL is required for integration tests',
    );
  }
  return DATABASE_URL;
}

async function applyMigrations(pool: Pool): Promise<void> {
  for (const migration of [
    '0001_durable_reminder_inbox.sql',
    '0002_data_rights_erasure.sql',
  ]) {
    const sql = await readFile(
      resolve(__dirname, '../migrations', migration),
      'utf8',
    );
    await pool.query(sql);
  }
}

async function seedWorkspace(
  pool: Pool,
  workspaceId: string,
): Promise<{ readonly reminderId: string; readonly outcomeId: string }> {
  const reminderId = randomUUID();
  const outcomeId = randomUUID();
  const messageId = randomUUID();

  await pool.query(
    `INSERT INTO notification_service.reminder_occurrences (
       reminder_id,
       workspace_id,
       reminder_title,
       due_instant,
       time_zone,
       daily_delivery_limit,
       delivery_attempt_count,
       occurrence_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      reminderId,
      workspaceId,
      'Data-rights integration reminder',
      '2026-08-12T00:00:00.000Z',
      'UTC',
      3,
      0,
      'pending',
    ],
  );

  await pool.query(
    `INSERT INTO notification_service.reminder_outcomes (
       outcome_id,
       workspace_id,
       reminder_id,
       outcome_kind,
       occurred_at,
       idempotency_key_hash,
       delivery_local_date
     ) VALUES ($1, $2, $3, 'delivered', $4, decode(repeat('ab', 32), 'hex'), $5)`,
    [
      outcomeId,
      workspaceId,
      reminderId,
      '2026-08-12T00:00:01.000Z',
      '2026-08-12',
    ],
  );

  await pool.query(
    `INSERT INTO notification_service.inbox_messages (
       message_id,
       workspace_id,
       reminder_id,
       message_title,
       due_instant,
       time_zone,
       idempotency_key_hash,
       delivered_at
     ) VALUES ($1, $2, $3, $4, $5, $6, decode(repeat('cd', 32), 'hex'), $7)`,
    [
      messageId,
      workspaceId,
      reminderId,
      'Data-rights integration inbox message',
      '2026-08-12T00:00:00.000Z',
      'UTC',
      '2026-08-12T00:00:02.000Z',
    ],
  );

  return { reminderId, outcomeId };
}

async function workspaceRecordCount(
  pool: Pool,
  workspaceId: string,
): Promise<number> {
  const result = await pool.query<{ record_count: string }>(
    `SELECT (
       (SELECT count(*) FROM notification_service.reminder_occurrences WHERE workspace_id = $1) +
       (SELECT count(*) FROM notification_service.reminder_outcomes WHERE workspace_id = $1) +
       (SELECT count(*) FROM notification_service.inbox_messages WHERE workspace_id = $1)
     )::text AS record_count`,
    [workspaceId],
  );
  return Number(result.rows[0]?.record_count ?? Number.NaN);
}

describeWithPostgres('Notification data-rights PostgreSQL integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-notification-data-rights-admin',
      max: 4,
    });
  });

  beforeEach(async () => {
    await administrativePool.query(
      'DROP SCHEMA IF EXISTS notification_service CASCADE',
    );
    await applyMigrations(administrativePool);
  });

  afterAll(async () => {
    await administrativePool.query(
      'DROP SCHEMA IF EXISTS notification_service CASCADE',
    );
    await administrativePool.end();
  });

  it('erases one tenant, replays exactly, rejects conflicting authority, and preserves another tenant', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const requestedByUserId = randomUUID();
    const requestId = randomUUID();
    const idempotencyKey = randomUUID();
    await seedWorkspace(administrativePool, workspaceId);
    const other = await seedWorkspace(administrativePool, otherWorkspaceId);

    await expect(
      administrativePool.query(
        'DELETE FROM notification_service.reminder_outcomes WHERE outcome_id = $1',
        [other.outcomeId],
      ),
    ).rejects.toMatchObject({ code: '55000' });

    const first = await administrativePool.query<{
      result_erased_records: number;
      result_receipt_sha256: string;
    }>(
      'SELECT * FROM notification_service.erase_workspace_data($1, $2, $3, $4)',
      [workspaceId, requestedByUserId, requestId, idempotencyKey],
    );
    expect(first.rows).toEqual([
      {
        result_erased_records: 3,
        result_receipt_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    ]);
    expect(await workspaceRecordCount(administrativePool, workspaceId)).toBe(0);
    expect(await workspaceRecordCount(administrativePool, otherWorkspaceId)).toBe(
      3,
    );

    const replay = await administrativePool.query(
      'SELECT * FROM notification_service.erase_workspace_data($1, $2, $3, $4)',
      [workspaceId, requestedByUserId, requestId, idempotencyKey],
    );
    expect(replay.rows).toEqual(first.rows);

    await expect(
      administrativePool.query(
        'SELECT * FROM notification_service.erase_workspace_data($1, $2, $3, $4)',
        [workspaceId, requestedByUserId, randomUUID(), idempotencyKey],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      administrativePool.query(
        'DELETE FROM notification_service.reminder_outcomes WHERE outcome_id = $1',
        [other.outcomeId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    expect(await workspaceRecordCount(administrativePool, otherWorkspaceId)).toBe(
      3,
    );
  });

  it('rejects non-v4 erasure authority before changing tenant data', async () => {
    const workspaceId = randomUUID();
    await seedWorkspace(administrativePool, workspaceId);

    await expect(
      administrativePool.query(
        'SELECT * FROM notification_service.erase_workspace_data($1, $2, $3, $4)',
        [
          workspaceId,
          randomUUID(),
          '11111111-1111-1111-8111-111111111111',
          randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ code: '22023' });
    expect(await workspaceRecordCount(administrativePool, workspaceId)).toBe(3);
  });

  it(
    'keeps the SECURITY DEFINER erasure function unavailable to an ungranted runtime role',
    async () => {
      const workspaceId = randomUUID();
      await seedWorkspace(administrativePool, workspaceId);

      await administrativePool.query(
        `DO $$
         BEGIN
           IF EXISTS (
             SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolname = 'notification_data_rights_ungranted_test'
           ) THEN
             DROP OWNED BY notification_data_rights_ungranted_test;
             DROP ROLE notification_data_rights_ungranted_test;
           END IF;
         END
         $$`,
      );
      await administrativePool.query(
        'CREATE ROLE notification_data_rights_ungranted_test NOLOGIN',
      );
      try {
        await administrativePool.query(
          'GRANT USAGE ON SCHEMA notification_service TO notification_data_rights_ungranted_test',
        );
        await administrativePool.query(
          'SET ROLE notification_data_rights_ungranted_test',
        );
        await expect(
          administrativePool.query(
            'SELECT * FROM notification_service.erase_workspace_data($1, $2, $3, $4)',
            [workspaceId, randomUUID(), randomUUID(), randomUUID()],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await administrativePool.query('RESET ROLE');
        await administrativePool.query(
          'DROP OWNED BY notification_data_rights_ungranted_test',
        );
        await administrativePool.query(
          'DROP ROLE IF EXISTS notification_data_rights_ungranted_test',
        );
      }
      expect(await workspaceRecordCount(administrativePool, workspaceId)).toBe(3);
    },
  );
});