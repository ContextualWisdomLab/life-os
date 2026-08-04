import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PostgresInAppDeliveryGateway,
  PostgresReminderRepository,
  type NotificationSqlClient,
  type NotificationSqlQueryResult,
} from './postgres-reminder-repository';
import {
  ReminderScheduler,
  type ReminderOccurrence,
} from './reminder-scheduler';

const DATABASE_URL = process.env.NOTIFICATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;

class PoolSqlClient implements NotificationSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }
}

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

function repository(
  pool: Pool,
  claimLeaseSeconds = 30,
): PostgresReminderRepository {
  return new PostgresReminderRepository(
    new PoolSqlClient(pool),
    claimLeaseSeconds,
  );
}

function gateway(pool: Pool): PostgresInAppDeliveryGateway {
  return new PostgresInAppDeliveryGateway(new PoolSqlClient(pool));
}

function occurrence(
  workspaceId: string,
  overrides: Partial<ReminderOccurrence> = {},
): ReminderOccurrence {
  return {
    id: randomUUID(),
    workspaceId,
    title: 'Persist durable reminder',
    dueAt: '2026-08-04T12:00:00.000Z',
    timeZone: 'Asia/Seoul',
    quietHours: null,
    maxPerLocalDay: 4,
    deliveryAttempt: 0,
    ...overrides,
  };
}

describeWithPostgres('PostgreSQL notification repository integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-notification-integration-admin',
      max: 12,
    });
  });

  beforeEach(async () => {
    await administrativePool.query(
      'DROP SCHEMA IF EXISTS notification_service CASCADE',
    );
    await applyMigration(administrativePool);
  });

  afterAll(async () => {
    await administrativePool.query(
      'DROP SCHEMA IF EXISTS notification_service CASCADE',
    );
    await administrativePool.end();
  });

  it('preserves tenant-isolated reminders across pool restarts', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const visible = occurrence(workspaceId);
    const privateReminder = occurrence(otherWorkspaceId);
    const firstPool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-notification-integration-first',
      max: 2,
    });
    const firstRepository = repository(firstPool);
    await firstRepository.schedule(visible);
    await firstRepository.schedule(privateReminder);
    await firstPool.end();

    const restartedPool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-notification-integration-restarted',
      max: 2,
    });
    const restartedRepository = repository(restartedPool);
    const reminders = await restartedRepository.listReminders(workspaceId, 10);

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject(visible);
    expect(reminders[0]?.status).toBe('pending');
    await expect(
      restartedRepository.listReminders(otherWorkspaceId, 10),
    ).resolves.toHaveLength(1);
    await restartedPool.end();
  });

  it('serializes concurrent workers into one active claim', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool, 300);
    await durableRepository.schedule(reminder);
    const key = `${workspaceId}:${reminder.id}:${reminder.dueAt}`;

    const claims = await Promise.all(
      Array.from({ length: 16 }, () =>
        durableRepository.claim(workspaceId, reminder.id, key),
      ),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((claimed) => !claimed)).toHaveLength(15);
  });

  it('recovers an expired lease and completes an exact inbox replay once', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool, 30);
    const inAppGateway = gateway(administrativePool);
    await durableRepository.schedule(reminder);
    const key = `${workspaceId}:${reminder.id}:${reminder.dueAt}`;
    await expect(
      durableRepository.claim(workspaceId, reminder.id, key),
    ).resolves.toBe(true);
    await inAppGateway.deliver({
      workspaceId,
      reminderId: reminder.id,
      title: reminder.title,
      dueAt: reminder.dueAt,
      timeZone: reminder.timeZone,
      idempotencyKey: key,
    });
    await administrativePool.query(
      `UPDATE notification_service.reminder_occurrences
       SET claim_expires_at = clock_timestamp() - interval '1 second'
       WHERE workspace_id = $1 AND reminder_id = $2`,
      [workspaceId, reminder.id],
    );

    const scheduler = new ReminderScheduler(
      durableRepository,
      inAppGateway,
      10,
    );
    await expect(
      scheduler.run(new Date('2026-08-04T12:01:00.000Z')),
    ).resolves.toEqual({
      scanned: 1,
      delivered: 1,
      deferred: 0,
      failed: 0,
      duplicateClaims: 0,
      invalid: 0,
    });
    await expect(
      scheduler.run(new Date('2026-08-04T12:02:00.000Z')),
    ).resolves.toMatchObject({ scanned: 0, delivered: 0 });
    await expect(
      durableRepository.listInbox(workspaceId, 10),
    ).resolves.toHaveLength(1);
    await expect(
      durableRepository.listOutcomes(workspaceId, 10),
    ).resolves.toMatchObject([{ kind: 'delivered', reminderId: reminder.id }]);
  });

  it('enforces immutable outcome history for update, delete, and truncate', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool);
    const scheduler = new ReminderScheduler(
      durableRepository,
      gateway(administrativePool),
      10,
    );
    await durableRepository.schedule(reminder);
    await scheduler.run(new Date('2026-08-04T12:01:00.000Z'));
    const [outcome] = await durableRepository.listOutcomes(workspaceId, 10);
    expect(outcome).toBeDefined();

    await expect(
      administrativePool.query(
        `UPDATE notification_service.reminder_outcomes
         SET occurred_at = occurred_at + interval '1 second'
         WHERE outcome_id = $1`,
        [outcome?.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      administrativePool.query(
        `DELETE FROM notification_service.reminder_outcomes
         WHERE outcome_id = $1`,
        [outcome?.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      administrativePool.query(
        'TRUNCATE notification_service.reminder_outcomes',
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      durableRepository.listOutcomes(workspaceId, 10),
    ).resolves.toHaveLength(1);
  });
});
