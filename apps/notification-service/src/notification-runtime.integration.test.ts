import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createNotificationRuntime,
  type NotificationRuntime,
} from './notification-runtime';
import { NotificationPersistenceError } from './postgres-reminder-repository';

const DATABASE_URL = process.env.NOTIFICATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;
let runtime: NotificationRuntime | undefined;

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error(
      'NOTIFICATION_DATABASE_URL is required for integration tests',
    );
  }
  return DATABASE_URL;
}

async function applyMigration(pool: Pool): Promise<void> {
  const sql = await readFile(
    resolve(__dirname, '../migrations/0001_durable_reminder_inbox.sql'),
    'utf8',
  );
  await pool.query(sql);
}

async function resetSchema(): Promise<void> {
  await administrativePool.query(
    'DROP SCHEMA IF EXISTS notification_service CASCADE',
  );
  await applyMigration(administrativePool);
}

describeWithPostgres('production notification runtime integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-notification-runtime-integration-admin',
      max: 2,
    });
  });

  beforeEach(async () => {
    if (runtime) {
      await runtime.close();
      runtime = undefined;
    }
    await resetSchema();
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.close();
    }
    await administrativePool.query(
      'DROP SCHEMA IF EXISTS notification_service CASCADE',
    );
    await administrativePool.end();
  });

  it('composes, executes, and closes the default node-postgres runtime', async () => {
    const now = '2026-08-04T12:00:00.000Z';
    const workspaceId = randomUUID();
    const reminderId = randomUUID();
    runtime = createNotificationRuntime({
      NOTIFICATION_DATABASE_URL: requireDatabaseUrl(),
      NOTIFICATION_DATABASE_POOL_MAX: '2',
      NOTIFICATION_CLAIM_LEASE_SECONDS: '30',
      NOTIFICATION_REMINDER_BATCH_SIZE: '5',
    });

    await runtime.repository.schedule({
      id: reminderId,
      workspaceId,
      title: 'Exercise the production runtime',
      dueAt: now,
      timeZone: 'UTC',
      quietHours: null,
      maxPerLocalDay: 4,
      deliveryAttempt: 0,
    });

    await expect(runtime.scheduler.run(new Date(now))).resolves.toMatchObject({
      scanned: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(runtime.repository.listInbox(workspaceId)).resolves.toEqual([
      expect.objectContaining({
        workspaceId,
        reminderId,
        title: 'Exercise the production runtime',
      }),
    ]);

    await runtime.close();
    await runtime.close();
    await expect(runtime.repository.listDue(now, 1)).rejects.toBeInstanceOf(
      NotificationPersistenceError,
    );
    runtime = undefined;
  });
});
