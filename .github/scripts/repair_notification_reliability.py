from pathlib import Path


def replace_once_or_present(path: str, old: str, new: str) -> None:
    """Replace one exact block, while remaining idempotent across workflow races."""
    target = Path(path)
    text = target.read_text()
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1))


runtime = "apps/notification-service/src/notification-runtime.ts"
replace_once_or_present(
    runtime,
    "import type { OnApplicationShutdown } from '@nestjs/common';",
    "import { Logger, type OnApplicationShutdown } from '@nestjs/common';",
)
replace_once_or_present(
    runtime,
    "type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;\n",
    """type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/** Minimal event boundary needed to observe idle PostgreSQL client failures. */
export interface NotificationPoolErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** Credential-free error logger used by the pool error boundary. */
export type NotificationPoolErrorLogger = (
  message: string,
  context: string,
) => void;

const NOTIFICATION_POOL_ERROR_MESSAGE =
  'Notification PostgreSQL pool reported an idle client error';

function defaultNotificationPoolErrorLogger(
  message: string,
  context: string,
): void {
  Logger.error(message, context);
}

/** Registers a sanitized listener before the PostgreSQL pool can be used. */
export function registerNotificationPoolErrorHandler(
  pool: NotificationPoolErrorSource,
  logError: NotificationPoolErrorLogger = defaultNotificationPoolErrorLogger,
): void {
  pool.on('error', () => {
    logError(NOTIFICATION_POOL_ERROR_MESSAGE, 'NotificationRuntime');
  });
}
""",
)
replace_once_or_present(
    runtime,
    """function defaultPoolFactory(configuration: PoolConfig): NotificationPool {
  return new NodePostgresNotificationPool(new Pool(configuration));
}
""",
    """function defaultPoolFactory(configuration: PoolConfig): NotificationPool {
  const pool = new Pool(configuration);
  registerNotificationPoolErrorHandler(pool);
  return new NodePostgresNotificationPool(pool);
}
""",
)

runtime_test = "apps/notification-service/src/notification-runtime.test.ts"
replace_once_or_present(
    runtime_test,
    "import type { PoolConfig } from 'pg';\nimport { describe, expect, it } from 'vitest';",
    "import { Logger } from '@nestjs/common';\nimport type { PoolConfig } from 'pg';\nimport { describe, expect, it, vi } from 'vitest';",
)
replace_once_or_present(
    runtime_test,
    "  createNotificationRuntime,\n  type NotificationPool,",
    "  createNotificationRuntime,\n  registerNotificationPoolErrorHandler,\n  type NotificationPool,",
)
replace_once_or_present(
    runtime_test,
    """describe('Notification runtime', () => {
  it('builds a bounded PostgreSQL pool configuration', () => {
""",
    """describe('Notification runtime', () => {
  it('handles idle pool errors with one fixed credential-free record', () => {
    let errorListener: ((error: Error) => void) | undefined;
    const source = {
      on(event: 'error', listener: (error: Error) => void): void {
        expect(event).toBe('error');
        errorListener = listener;
      },
    };
    const logger = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);

    registerNotificationPoolErrorHandler(source);
    errorListener?.(
      new Error('postgresql://administrator:secret@database.example.test'),
    );

    expect(logger).toHaveBeenCalledWith(
      'Notification PostgreSQL pool reported an idle client error',
      'NotificationRuntime',
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret');
    logger.mockRestore();
  });

  it('builds a bounded PostgreSQL pool configuration', () => {
""",
)
replace_once_or_present(
    runtime_test,
    """  it('shares one pool across adapters and closes it exactly once', async () => {
""",
    """  it('constructs and closes the production pool without opening a connection', async () => {
    const runtime = createNotificationRuntime({
      NOTIFICATION_DATABASE_URL: DATABASE_URL,
    });

    await runtime.close();
    await runtime.close();
  });

  it('shares one pool across adapters and closes it exactly once', async () => {
""",
)

repository = "apps/notification-service/src/postgres-reminder-repository.ts"
replace_once_or_present(
    repository,
    """function requireLocalDate(value: unknown): string {
  const candidate =
    value instanceof Date ? value.toISOString().slice(0, 10) : value;
""",
    """function requireLocalDate(value: unknown): string {
  const candidate =
    value instanceof Date
      ? [
          String(value.getFullYear()).padStart(4, '0'),
          String(value.getMonth() + 1).padStart(2, '0'),
          String(value.getDate()).padStart(2, '0'),
        ].join('-')
      : value;
""",
)

repository_test = "apps/notification-service/src/postgres-reminder-repository.test.ts"
replace_once_or_present(
    repository_test,
    """  it('rejects invalid limits, dates, identifiers, lease values, and SQL failures', async () => {
""",
    """  it('preserves PostgreSQL date values at a positive-offset boundary', async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'Asia/Seoul';
    try {
      const client = new RecordingSqlClient([
        [outcomeRow({ delivery_local_date: new Date(2026, 7, 4) })],
      ]);

      await expect(
        new PostgresReminderRepository(client).listOutcomes(workspaceId, 10),
      ).resolves.toMatchObject([{ deliveryLocalDate: '2026-08-04' }]);
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });

  it('rejects invalid limits, dates, identifiers, lease values, and SQL failures', async () => {
""",
)

scheduler = "apps/notification-service/src/reminder-scheduler.ts"
replace_once_or_present(
    scheduler,
    """  readonly failed: number;
  readonly duplicateClaims: number;
""",
    """  readonly failed: number;
  readonly persistenceFailures: number;
  readonly duplicateClaims: number;
""",
)
replace_once_or_present(
    scheduler,
    """    let failed = 0;
    let duplicateClaims = 0;
""",
    """    let failed = 0;
    let persistenceFailures = 0;
    let duplicateClaims = 0;
""",
)
replace_once_or_present(
    scheduler,
    """        await this.repository.defer(
          reminder,
          nextAllowedInstant(now, reminder.timeZone, quietHours, false),
          'quiet_hours',
          claimKey,
          deliveryKey,
        );
        deferred += 1;
        continue;
""",
    """        try {
          await this.repository.defer(
            reminder,
            nextAllowedInstant(now, reminder.timeZone, quietHours, false),
            'quiet_hours',
            claimKey,
            deliveryKey,
          );
          deferred += 1;
        } catch {
          persistenceFailures += 1;
        }
        continue;
""",
)
replace_once_or_present(
    scheduler,
    """        await this.repository.defer(
          reminder,
          nextAllowedInstant(now, reminder.timeZone, quietHours, true),
          'daily_limit',
          claimKey,
          deliveryKey,
        );
        deferred += 1;
        continue;
""",
    """        try {
          await this.repository.defer(
            reminder,
            nextAllowedInstant(now, reminder.timeZone, quietHours, true),
            'daily_limit',
            claimKey,
            deliveryKey,
          );
          deferred += 1;
        } catch {
          persistenceFailures += 1;
        }
        continue;
""",
)
replace_once_or_present(
    scheduler,
    """        await this.repository.fail(
          reminder,
          null,
          'attempt_limit',
          claimKey,
          deliveryKey,
        );
        failed += 1;
        continue;
""",
    """        try {
          await this.repository.fail(
            reminder,
            null,
            'attempt_limit',
            claimKey,
            deliveryKey,
          );
          failed += 1;
        } catch {
          persistenceFailures += 1;
        }
        continue;
""",
)
replace_once_or_present(
    scheduler,
    """      } catch {
        await this.repository.fail(
          reminder,
          retryInstant(now, reminder.deliveryAttempt),
          'delivery_failed',
          claimKey,
          deliveryKey,
        );
        failed += 1;
        continue;
      }
      await this.repository.markDelivered(
        reminder,
        now.toISOString(),
        claimKey,
        deliveryKey,
      );
      delivered += 1;
""",
    """      } catch {
        try {
          await this.repository.fail(
            reminder,
            retryInstant(now, reminder.deliveryAttempt),
            'delivery_failed',
            claimKey,
            deliveryKey,
          );
          failed += 1;
        } catch {
          persistenceFailures += 1;
        }
        continue;
      }
      try {
        await this.repository.markDelivered(
          reminder,
          now.toISOString(),
          claimKey,
          deliveryKey,
        );
        delivered += 1;
      } catch {
        persistenceFailures += 1;
      }
""",
)
replace_once_or_present(
    scheduler,
    """      failed,
      duplicateClaims,
""",
    """      failed,
      persistenceFailures,
      duplicateClaims,
""",
)

scheduler_integration = (
    "apps/notification-service/src/reminder-scheduler.integration.test.ts"
)
replace_once_or_present(
    scheduler_integration,
    "class RecordingGateway implements ReminderDeliveryGateway {\n",
    """type PersistenceOperation = 'defer' | 'fail' | 'markDelivered';

class FailOnceReminderRepository extends InMemoryReminderRepository {
  private failureAvailable = true;

  constructor(
    records: readonly unknown[],
    private readonly operation: PersistenceOperation,
  ) {
    super(records);
  }

  private consumeFailure(operation: PersistenceOperation): boolean {
    if (this.failureAvailable && this.operation === operation) {
      this.failureAvailable = false;
      return true;
    }
    return false;
  }

  override async markDelivered(
    value: ReminderOccurrence,
    deliveredAt: string,
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (this.consumeFailure('markDelivered')) {
      throw new Error('persistence unavailable');
    }
    await super.markDelivered(value, deliveredAt, claimKey, idempotencyKey);
  }

  override async defer(
    value: ReminderOccurrence,
    nextAttemptAt: string,
    reason: 'quiet_hours' | 'daily_limit',
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (this.consumeFailure('defer')) {
      throw new Error('persistence unavailable');
    }
    await super.defer(value, nextAttemptAt, reason, claimKey, idempotencyKey);
  }

  override async fail(
    value: ReminderOccurrence,
    retryAt: string | null,
    reason: 'delivery_failed' | 'attempt_limit',
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (this.consumeFailure('fail')) {
      throw new Error('persistence unavailable');
    }
    await super.fail(value, retryAt, reason, claimKey, idempotencyKey);
  }
}

class RecordingGateway implements ReminderDeliveryGateway {
""",
)
replace_once_or_present(
    scheduler_integration,
    """  it('bounds untrusted repository output and reports invalid future records', async () => {
""",
    """  it('isolates transition persistence failures and continues the batch', async () => {
    const secondReminderId = 'ee09fe10-2602-4d6c-b52a-e58cbf55ea41';
    const deliveredRepository = new FailOnceReminderRepository(
      [
        reminder({ quietHours: null }),
        reminder({ id: secondReminderId, quietHours: null }),
      ],
      'markDelivered',
    );
    const deliveredReport = await new ReminderScheduler(
      deliveredRepository,
      new RecordingGateway(),
    ).run(new Date('2026-08-04T12:00:00.000Z'));
    expect(deliveredReport).toMatchObject({
      scanned: 2,
      delivered: 1,
      persistenceFailures: 1,
    });

    const deferredRepository = new FailOnceReminderRepository(
      [
        reminder({
          quietHours: { startMinute: 20 * 60, endMinute: 22 * 60 },
        }),
      ],
      'defer',
    );
    await expect(
      new ReminderScheduler(deferredRepository, new RecordingGateway()).run(
        new Date('2026-08-04T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ deferred: 0, persistenceFailures: 1 });

    const terminalRepository = new FailOnceReminderRepository(
      [
        reminder({
          quietHours: null,
          deliveryAttempt: MAX_DELIVERY_ATTEMPTS,
        }),
      ],
      'fail',
    );
    await expect(
      new ReminderScheduler(terminalRepository, new RecordingGateway()).run(
        new Date('2026-08-04T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ failed: 0, persistenceFailures: 1 });

    const retryRepository = new FailOnceReminderRepository(
      [reminder({ quietHours: null })],
      'fail',
    );
    const failingGateway = new RecordingGateway();
    failingGateway.shouldFail = true;
    await expect(
      new ReminderScheduler(retryRepository, failingGateway).run(
        new Date('2026-08-04T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ failed: 0, persistenceFailures: 1 });
  });

  it('bounds untrusted repository output and reports invalid future records', async () => {
""",
)

postgres_integration = (
    "apps/notification-service/src/postgres-reminder-repository.integration.test.ts"
)
replace_once_or_present(
    postgres_integration,
    """import {
  NotificationPersistenceError,
""",
    """import { createNotificationRuntime } from './notification-runtime';
import {
  NotificationPersistenceError,
""",
)
replace_once_or_present(
    postgres_integration,
    """      failed: 0,
      duplicateClaims: 0,
""",
    """      failed: 0,
      persistenceFailures: 0,
      duplicateClaims: 0,
""",
)
replace_once_or_present(
    postgres_integration,
    """  it('enforces immutable outcome history for update, delete, and truncate', async () => {
""",
    """  it('composes the production runtime through one owned pool', async () => {
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
""",
)
