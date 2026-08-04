import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createNotificationRuntime } from './notification-runtime';
import {
  NotificationPersistenceError,
  NotificationReplayConflictError,
  PostgresInAppDeliveryGateway,
  PostgresReminderRepository,
  /** Represents the notification sql client values used by deterministic test fixtures. */
  type NotificationSqlClient,
  /** Represents the notification sql query result values used by deterministic test fixtures. */
  type NotificationSqlQueryResult,
} from './postgres-reminder-repository';
import {
  ReminderScheduler,
  idempotencyKey,
  /** Represents the reminder occurrence values used by deterministic test fixtures. */
  type ReminderOccurrence,
} from './reminder-scheduler';

const DATABASE_URL = process.env.NOTIFICATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;

/** Implements the pool sql client test double with observable deterministic behavior. */
class PoolSqlClient implements NotificationSqlClient {
  /** Creates the component with explicit dependencies and deterministic initial state. */
  constructor(private readonly pool: Pool) {}

  /** Executes one parameterized query through the bounded SQL or test-double contract. */
  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }
}

/** Supports the require database url test scenario without hiding production behavior. */
function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error(
      'NOTIFICATION_DATABASE_URL is required for integration tests',
    );
  }
  return DATABASE_URL;
}

/** Supports the apply migration test scenario without hiding production behavior. */
async function applyMigration(pool: Pool): Promise<void> {
  const sql = await readFile(
    /** Supports the resolve test scenario without hiding production behavior. */
    resolve(__dirname, '../migrations/0001_durable_reminder_inbox.sql'),
    'utf8',
  );
  await pool.query(sql);
}

/** Supports the reset schema test scenario without hiding production behavior. */
async function resetSchema(): Promise<void> {
  await administrativePool.query(
    'DROP SCHEMA IF EXISTS notification_service CASCADE',
  );
  await applyMigration(administrativePool);
}

/** Supports the repository test scenario without hiding production behavior. */
function repository(
  pool: Pool,
  claimLeaseSeconds = 30,
): PostgresReminderRepository {
  return new PostgresReminderRepository(
    new PoolSqlClient(pool),
    claimLeaseSeconds,
  );
}

/** Supports the gateway test scenario without hiding production behavior. */
function gateway(pool: Pool): PostgresInAppDeliveryGateway {
  return new PostgresInAppDeliveryGateway(new PoolSqlClient(pool));
}

/** Supports the occurrence test scenario without hiding production behavior. */
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
  /** Supports the before all test scenario without hiding production behavior. */
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-notification-integration-admin',
      max: 12,
    });
  });

  /** Supports the before each test scenario without hiding production behavior. */
  beforeEach(async () => {
    await resetSchema();
  });

  /** Supports the after all test scenario without hiding production behavior. */
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

  it('returns due reminders by instant and identifier deterministically', async () => {
    const workspaceId = randomUUID();
    const durableRepository = repository(administrativePool);
    const firstId = '00000000-0000-4000-8000-000000000001';
    const secondId = '00000000-0000-4000-8000-000000000002';
    const laterId = '00000000-0000-4000-8000-000000000003';
    await durableRepository.schedule(
      /** Supports the occurrence test scenario without hiding production behavior. */
      occurrence(workspaceId, {
        id: secondId,
        dueAt: '2026-08-04T10:00:00.000Z',
      }),
    );
    await durableRepository.schedule(
      /** Supports the occurrence test scenario without hiding production behavior. */
      occurrence(workspaceId, {
        id: laterId,
        dueAt: '2026-08-04T11:00:00.000Z',
      }),
    );
    await durableRepository.schedule(
      /** Supports the occurrence test scenario without hiding production behavior. */
      occurrence(workspaceId, {
        id: firstId,
        dueAt: '2026-08-04T10:00:00.000Z',
      }),
    );

    const due = await durableRepository.listDue('2026-08-04T12:00:00.000Z', 10);

    expect(due.map((reminder) => reminder.id)).toEqual([
      firstId,
      secondId,
      laterId,
    ]);
  });

  it('serializes concurrent workers into one active claim', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool, 300);
    await durableRepository.schedule(reminder);

    const claims = await Promise.all(
      Array.from({ length: 16 }, () =>
        durableRepository.claim(
          workspaceId,
          reminder.id,
          reminder.dueAt,
          reminder.deliveryAttempt,
        ),
      ),
    );

    expect(claims.filter((claimKey) => claimKey !== null)).toHaveLength(1);
    expect(claims.filter((claimKey) => claimKey === null)).toHaveLength(15);
  });

  it('rejects a claim when the observed row version has changed', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool, 300);
    await durableRepository.schedule(reminder);
    const [observed] = await durableRepository.listDue(
      '2026-08-04T12:01:00.000Z',
      10,
    );
    if (observed === undefined) {
      throw new Error('expected one due reminder');
    }
    await administrativePool.query(
      `UPDATE notification_service.reminder_occurrences
       SET due_instant = due_instant + interval '1 minute',
           delivery_attempt_count = delivery_attempt_count + 1
       WHERE workspace_id = $1 AND reminder_id = $2`,
      [workspaceId, reminder.id],
    );

    await expect(
      durableRepository.claim(
        observed.workspaceId,
        observed.id,
        observed.dueAt,
        observed.deliveryAttempt,
      ),
    ).resolves.toBeNull();
  });

  it('fences an expired owner after a replacement claim is acquired', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool, 30);
    await durableRepository.schedule(reminder);
    const deliveryKey = idempotencyKey(reminder);
    const firstClaim = await durableRepository.claim(
      workspaceId,
      reminder.id,
      reminder.dueAt,
      reminder.deliveryAttempt,
    );
    expect(firstClaim).not.toBeNull();
    await administrativePool.query(
      `UPDATE notification_service.reminder_occurrences
       SET claim_expires_at = clock_timestamp() - interval '1 second'
       WHERE workspace_id = $1 AND reminder_id = $2`,
      [workspaceId, reminder.id],
    );
    const secondClaim = await durableRepository.claim(
      workspaceId,
      reminder.id,
      reminder.dueAt,
      reminder.deliveryAttempt,
    );
    expect(secondClaim).not.toBeNull();
    expect(secondClaim).not.toBe(firstClaim);

    await expect(
      durableRepository.markDelivered(
        reminder,
        '2026-08-04T12:00:01.000Z',
        firstClaim as string,
        deliveryKey,
      ),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);
    await expect(
      durableRepository.markDelivered(
        reminder,
        '2026-08-04T12:00:01.000Z',
        secondClaim as string,
        deliveryKey,
      ),
    ).resolves.toBeUndefined();
    await expect(
      durableRepository.listOutcomes(workspaceId, 10),
    ).resolves.toHaveLength(1);
  });

  it('recovers an expired lease and completes an exact inbox replay once', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool, 30);
    const inAppGateway = gateway(administrativePool);
    await durableRepository.schedule(reminder);
    const key = idempotencyKey(reminder);
    await expect(
      durableRepository.claim(
        workspaceId,
        reminder.id,
        reminder.dueAt,
        reminder.deliveryAttempt,
      ),
    ).resolves.not.toBeNull();
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
      persistenceFailures: 0,
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
    await expect(
      inAppGateway.deliver({
        workspaceId,
        reminderId: reminder.id,
        title: 'Conflicting reminder title',
        dueAt: reminder.dueAt,
        timeZone: reminder.timeZone,
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(NotificationReplayConflictError);
  });

  it('counts delivered evidence by tenant and local calendar date', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const durableRepository = repository(administrativePool);
    const scheduler = new ReminderScheduler(
      durableRepository,
      /** Supports the gateway test scenario without hiding production behavior. */
      gateway(administrativePool),
      10,
    );
    await durableRepository.schedule(
      /** Supports the occurrence test scenario without hiding production behavior. */
      occurrence(workspaceId, {
        dueAt: '2026-08-04T08:00:00.000Z',
      }),
    );
    await durableRepository.schedule(
      /** Supports the occurrence test scenario without hiding production behavior. */
      occurrence(workspaceId, {
        dueAt: '2026-08-04T08:01:00.000Z',
      }),
    );
    await durableRepository.schedule(
      /** Supports the occurrence test scenario without hiding production behavior. */
      occurrence(otherWorkspaceId, {
        dueAt: '2026-08-04T08:02:00.000Z',
      }),
    );

    await scheduler.run(new Date('2026-08-04T08:03:00.000Z'));

    await expect(
      durableRepository.countDelivered(workspaceId, '2026-08-04'),
    ).resolves.toBe(2);
    await expect(
      durableRepository.countDelivered(otherWorkspaceId, '2026-08-04'),
    ).resolves.toBe(1);
    await expect(
      durableRepository.countDelivered(workspaceId, '2026-08-05'),
    ).resolves.toBe(0);
  });

  it('persists quiet-hour and daily-limit deferrals with the next due instant', async () => {
    const workspaceId = randomUUID();
    const durableRepository = repository(administrativePool);
    const scheduler = new ReminderScheduler(
      durableRepository,
      /** Supports the gateway test scenario without hiding production behavior. */
      gateway(administrativePool),
      10,
    );
    const quietReminder = occurrence(workspaceId, {
      dueAt: '2026-08-04T12:00:00.000Z',
      quietHours: { startMinute: 1_200, endMinute: 1_320 },
    });
    await durableRepository.schedule(quietReminder);

    await expect(
      scheduler.run(new Date('2026-08-04T12:01:00.000Z')),
    ).resolves.toMatchObject({ deferred: 1, delivered: 0 });
    await expect(
      durableRepository.listOutcomes(workspaceId, 10),
    ).resolves.toMatchObject([
      {
        reminderId: quietReminder.id,
        kind: 'deferred',
        reason: 'quiet_hours',
        nextAttemptAt: '2026-08-04T13:00:00.000Z',
      },
    ]);
    await expect(
      durableRepository.listReminders(workspaceId, 10),
    ).resolves.toMatchObject([
      {
        id: quietReminder.id,
        dueAt: '2026-08-04T13:00:00.000Z',
        status: 'pending',
      },
    ]);

    await resetSchema();
    const fatigueRepository = repository(administrativePool);
    const fatigueScheduler = new ReminderScheduler(
      fatigueRepository,
      /** Supports the gateway test scenario without hiding production behavior. */
      gateway(administrativePool),
      10,
    );
    const deliveredSeed = occurrence(workspaceId, {
      dueAt: '2026-08-04T09:00:00.000Z',
      maxPerLocalDay: 1,
    });
    await fatigueRepository.schedule(deliveredSeed);
    await fatigueScheduler.run(new Date('2026-08-04T09:01:00.000Z'));
    const fatigueReminder = occurrence(workspaceId, {
      dueAt: '2026-08-04T10:00:00.000Z',
      maxPerLocalDay: 1,
    });
    await fatigueRepository.schedule(fatigueReminder);

    await expect(
      fatigueScheduler.run(new Date('2026-08-04T10:01:00.000Z')),
    ).resolves.toMatchObject({ deferred: 1, delivered: 0 });
    await expect(
      fatigueRepository.listOutcomes(workspaceId, 10),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reminderId: fatigueReminder.id,
          kind: 'deferred',
          reason: 'daily_limit',
          nextAttemptAt: '2026-08-04T15:00:00.000Z',
        }),
        expect.objectContaining({
          reminderId: deliveredSeed.id,
          kind: 'delivered',
        }),
      ]),
    );
  });

  it('persists retryable and terminal failures without provider exception text', async () => {
    const workspaceId = randomUUID();
    const durableRepository = repository(administrativePool);
    const failingGateway = {
      /** Persists or verifies one idempotent in-app reminder delivery. */
      async deliver(): Promise<void> {
        throw new Error('provider token and sensitive exception text');
      },
    };
    const failingScheduler = new ReminderScheduler(
      durableRepository,
      failingGateway,
      10,
    );
    const retryable = occurrence(workspaceId, {
      dueAt: '2026-08-04T12:00:00.000Z',
    });
    await durableRepository.schedule(retryable);

    await expect(
      failingScheduler.run(new Date('2026-08-04T12:01:00.000Z')),
    ).resolves.toMatchObject({ failed: 1 });
    await expect(
      durableRepository.listReminders(workspaceId, 10),
    ).resolves.toMatchObject([
      {
        id: retryable.id,
        dueAt: '2026-08-04T12:06:00.000Z',
        deliveryAttempt: 1,
        status: 'pending',
      },
    ]);
    const [retryOutcome] = await durableRepository.listOutcomes(
      workspaceId,
      10,
    );
    expect(retryOutcome).toMatchObject({
      reminderId: retryable.id,
      kind: 'failed',
      reason: 'delivery_failed',
      nextAttemptAt: '2026-08-04T12:06:00.000Z',
    });
    expect(JSON.stringify(retryOutcome)).not.toContain('provider token');

    await resetSchema();
    const terminalRepository = repository(administrativePool);
    const terminalScheduler = new ReminderScheduler(
      terminalRepository,
      failingGateway,
      10,
    );
    const terminal = occurrence(workspaceId, {
      dueAt: '2026-08-04T13:00:00.000Z',
      deliveryAttempt: 3,
    });
    await terminalRepository.schedule(terminal);
    await expect(
      terminalScheduler.run(new Date('2026-08-04T13:01:00.000Z')),
    ).resolves.toMatchObject({ failed: 1 });
    await expect(
      terminalRepository.listReminders(workspaceId, 10),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: terminal.id,
          deliveryAttempt: 3,
          status: 'failed',
        }),
      ]),
    );
    await expect(
      terminalRepository.listOutcomes(workspaceId, 10),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reminderId: terminal.id,
          kind: 'failed',
          reason: 'attempt_limit',
          nextAttemptAt: null,
        }),
      ]),
    );
  });

  it('composes the production runtime through one owned pool', async () => {
    const workspaceId = randomUUID();
    const runtime = createNotificationRuntime({
      NOTIFICATION_DATABASE_URL: requireDatabaseUrl(),
      NOTIFICATION_DATABASE_POOL_MAX: '2',
      NOTIFICATION_CLAIM_LEASE_SECONDS: '30',
      NOTIFICATION_REMINDER_BATCH_SIZE: '10',
    });
    try {
      await runtime.repository.schedule(occurrence(workspaceId));
      await expect(
        runtime.repository.listReminders(workspaceId, 10),
      ).resolves.toHaveLength(1);
    } finally {
      await runtime.close();
      await runtime.close();
    }
  });

  it('enforces immutable outcome history for update, delete, and truncate', async () => {
    const workspaceId = randomUUID();
    const reminder = occurrence(workspaceId);
    const durableRepository = repository(administrativePool);
    const scheduler = new ReminderScheduler(
      durableRepository,
      /** Supports the gateway test scenario without hiding production behavior. */
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
