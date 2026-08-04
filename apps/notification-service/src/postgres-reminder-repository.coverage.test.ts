import { describe, expect, it } from 'vitest';
import {
  MAX_DELIVERY_ATTEMPTS,
  ReminderScheduler,
  /** Represents the reminder delivery values used by deterministic test fixtures. */
  type ReminderDelivery,
  /** Represents the reminder delivery gateway values used by deterministic test fixtures. */
  type ReminderDeliveryGateway,
  /** Represents the reminder occurrence values used by deterministic test fixtures. */
  type ReminderOccurrence,
  /** Represents the reminder repository values used by deterministic test fixtures. */
  type ReminderRepository,
} from './reminder-scheduler';
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

const workspaceId = '018f47a4-9976-4c57-8a8a-674630a873d1';
const otherWorkspaceId = '69b8f6fb-c65a-462e-b5e7-1b21808db998';
const reminderId = '91fe0f58-2035-49b7-a793-ac75939a433f';
const otherReminderId = 'ee09fe10-2602-4d6c-b52a-e58cbf55ea41';
const outcomeId = 'fa6d0f3e-337c-4d94-b17d-4afcf6bf79c1';
const messageId = 'ca035df4-0149-4b08-8f21-07bd758cfbaa';
const claimKey = 'ebeb80f5-a077-45ee-9f39-f3e64af94cdb';
const idempotencyKey = `${workspaceId}:${reminderId}:2026-08-04T12:00:00.000Z`;

const baseReminder: ReminderOccurrence = {
  id: reminderId,
  workspaceId,
  title: 'Prepare the weekly review',
  dueAt: '2026-08-04T12:00:00.000Z',
  timeZone: 'Asia/Seoul',
  quietHours: { startMinute: 1320, endMinute: 420 },
  maxPerLocalDay: 4,
  deliveryAttempt: 0,
};

const baseDelivery: ReminderDelivery = {
  workspaceId,
  reminderId,
  title: baseReminder.title,
  dueAt: baseReminder.dueAt,
  timeZone: baseReminder.timeZone,
  idempotencyKey,
};

/** One parameterized SQL call captured by the deterministic test client. */
interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A deterministic SQL client together with its observable calls. */
interface SequencedSqlClient {
  readonly client: NotificationSqlClient;
  readonly calls: RecordedQuery[];
}

/** Builds a SQL client that returns or throws each supplied response in order. */
function sequencedSqlClient(
  responses: readonly (readonly unknown[] | Error)[],
): SequencedSqlClient {
  let index = 0;
  const calls: RecordedQuery[] = [];
  const client: NotificationSqlClient = {
    query: async <Row>(
      text: string,
      values: readonly unknown[],
    ): Promise<NotificationSqlQueryResult<Row>> => {
      calls.push({ text, values });
      const response = responses[index] ?? [];
      index += 1;
      if (response instanceof Error) {
        throw response;
      }
      return { rows: [...response] as Row[] };
    },
  };
  return { client, calls };
}

/** Builds one valid or intentionally malformed PostgreSQL reminder row. */
function reminderRow(overrides: Record<string, unknown> = {}) {
  return {
    reminder_id: reminderId,
    workspace_id: workspaceId,
    reminder_title: baseReminder.title,
    due_instant: new Date(baseReminder.dueAt),
    time_zone: baseReminder.timeZone,
    quiet_start_minute: 1320,
    quiet_end_minute: 420,
    daily_delivery_limit: 4,
    delivery_attempt_count: 0,
    occurrence_status: 'pending',
    claim_expires_at: null,
    created_at: new Date('2026-08-04T10:00:00.000Z'),
    updated_at: new Date('2026-08-04T10:00:00.000Z'),
    ...overrides,
  };
}

/** Builds one valid or intentionally malformed immutable outcome row. */
function outcomeRow(overrides: Record<string, unknown> = {}) {
  return {
    outcome_id: outcomeId,
    workspace_id: workspaceId,
    reminder_id: reminderId,
    outcome_kind: 'delivered',
    occurred_at: new Date('2026-08-04T12:00:01.000Z'),
    next_attempt_at: null,
    outcome_reason: null,
    delivery_local_date: '2026-08-04',
    created_at: new Date('2026-08-04T12:00:01.000Z'),
    ...overrides,
  };
}

/** Builds one valid or intentionally malformed in-app inbox row. */
function inboxRow(overrides: Record<string, unknown> = {}) {
  return {
    message_id: messageId,
    workspace_id: workspaceId,
    reminder_id: reminderId,
    message_title: baseReminder.title,
    due_instant: new Date(baseReminder.dueAt),
    time_zone: baseReminder.timeZone,
    delivered_at: new Date('2026-08-04T12:00:01.000Z'),
    read_at: null,
    created_at: new Date('2026-08-04T12:00:01.000Z'),
    ...overrides,
  };
}

describe('PostgreSQL notification defensive coverage', () => {
  it('covers aliases, nullable policies, status variants, and bounded result guards', async () => {
    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([[reminderRow()]]).client,
      ).createOccurrence(baseReminder),
    ).resolves.toMatchObject({ id: reminderId, status: 'pending' });

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([[reminderRow()]]).client,
      ).listOccurrences(workspaceId, 1),
    ).resolves.toHaveLength(1);

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([[inboxRow()]]).client,
      ).listInboxMessages(workspaceId, 1),
    ).resolves.toHaveLength(1);

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([
          [
            /** Supports the reminder row test scenario without hiding production behavior. */
            reminderRow({
              quiet_start_minute: null,
              quiet_end_minute: null,
            }),
          ],
        ]).client,
      ).listDue(baseReminder.dueAt, 1),
    ).resolves.toEqual([{ ...baseReminder, quietHours: null }]);

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([
          [
            /** Supports the reminder row test scenario without hiding production behavior. */
            reminderRow({
              occurrence_status: 'delivered',
              claim_expires_at: new Date('2026-08-04T12:05:00.000Z'),
            }),
            /** Supports the reminder row test scenario without hiding production behavior. */
            reminderRow({ occurrence_status: 'failed' }),
          ],
        ]).client,
      ).listReminders(workspaceId, 2),
    ).resolves.toMatchObject([
      { status: 'delivered', claimExpiresAt: '2026-08-04T12:05:00.000Z' },
      { status: 'failed' },
    ]);

    for (const operation of [
      () =>
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[reminderRow(), reminderRow()]]).client,
        ).listDue(baseReminder.dueAt, 1),
      () =>
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[reminderRow(), reminderRow()]]).client,
        ).listReminders(workspaceId, 1),
      () =>
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[outcomeRow(), outcomeRow()]]).client,
        ).listOutcomes(workspaceId, 1),
      () =>
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[inboxRow(), inboxRow()]]).client,
        ).listInbox(workspaceId, 1),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(
        NotificationPersistenceError,
      );
    }
  });

  it('rejects malformed temporal, cardinality, ownership, and row-state values', async () => {
    const malformedDueRows = [
      /** Supports the reminder row test scenario without hiding production behavior. */
      reminderRow({ due_instant: new Date(Number.NaN) }),
      /** Supports the reminder row test scenario without hiding production behavior. */
      reminderRow({ due_instant: '2026-13-01T00:00:00Z' }),
      /** Supports the reminder row test scenario without hiding production behavior. */
      reminderRow({ due_instant: 42 }),
      /** Supports the reminder row test scenario without hiding production behavior. */
      reminderRow({ quiet_start_minute: null, quiet_end_minute: 420 }),
      /** Supports the reminder row test scenario without hiding production behavior. */
      reminderRow({ daily_delivery_limit: {} }),
    ];
    for (const row of malformedDueRows) {
      await expect(
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[row]]).client,
        ).listDue(baseReminder.dueAt, 1),
      ).rejects.toBeInstanceOf(NotificationPersistenceError);
    }

    for (const localDate of ['2026-13-01', '2026-02-30']) {
      await expect(
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([]).client,
        ).countDelivered(workspaceId, localDate),
      ).rejects.toBeInstanceOf(NotificationPersistenceError);
    }

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([[]]).client,
      ).countDelivered(workspaceId, '2026-08-04'),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([[{ delivery_count: {} }]]).client,
      ).countDelivered(workspaceId, '2026-08-04'),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([[reminderRow(), reminderRow()]]).client,
      ).schedule(baseReminder),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);

    for (const row of [
      /** Supports the reminder row test scenario without hiding production behavior. */
      reminderRow({ workspace_id: otherWorkspaceId }),
      /** Supports the reminder row test scenario without hiding production behavior. */
      reminderRow({ occurrence_status: 'archived' }),
      /** Supports the reminder row test scenario without hiding production behavior. */
      reminderRow({
        created_at: new Date('2026-08-04T11:00:00.000Z'),
        updated_at: new Date('2026-08-04T10:00:00.000Z'),
      }),
    ]) {
      await expect(
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[row]]).client,
        ).listReminders(workspaceId, 1),
      ).rejects.toBeInstanceOf(NotificationPersistenceError);
    }

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([[reminderRow({ reminder_id: otherReminderId })]])
          .client,
      ).schedule(baseReminder),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);
  });

  it('covers every reachable schedule replay comparison', async () => {
    const replayMismatches = [
      { occurrence_status: 'delivered' },
      { reminder_title: 'Different reminder' },
      { due_instant: new Date('2026-08-04T13:00:00.000Z') },
      { time_zone: 'UTC' },
      { daily_delivery_limit: 5 },
      { delivery_attempt_count: 1 },
      { quiet_start_minute: 1200 },
      { quiet_end_minute: 300 },
      { quiet_start_minute: null, quiet_end_minute: null },
    ];
    for (const overrides of replayMismatches) {
      await expect(
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[], [reminderRow(overrides)]]).client,
        ).schedule(baseReminder),
      ).rejects.toBeInstanceOf(NotificationReplayConflictError);
    }

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([
          [],
          [
            /** Supports the reminder row test scenario without hiding production behavior. */
            reminderRow({
              quiet_start_minute: null,
              quiet_end_minute: null,
            }),
          ],
        ]).client,
      ).schedule({ ...baseReminder, quietHours: null }),
    ).resolves.toMatchObject({ quietHours: null });
  });

  it('accepts valid outcome variants and rejects every kind-specific invariant violation', async () => {
    const validRows = [
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow(),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'deferred',
        next_attempt_at: new Date('2026-08-04T13:00:00.000Z'),
        outcome_reason: 'quiet_hours',
        delivery_local_date: null,
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'deferred',
        next_attempt_at: new Date('2026-08-05T00:00:00.000Z'),
        outcome_reason: 'daily_limit',
        delivery_local_date: null,
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'failed',
        next_attempt_at: new Date('2026-08-04T12:05:00.000Z'),
        outcome_reason: 'delivery_failed',
        delivery_local_date: null,
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'failed',
        next_attempt_at: null,
        outcome_reason: 'attempt_limit',
        delivery_local_date: null,
      }),
    ];
    for (const row of validRows) {
      await expect(
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[row]]).client,
        ).listOutcomes(workspaceId, 1),
      ).resolves.toHaveLength(1);
    }

    const invalidRows = [
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({ outcome_kind: 'unknown' }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({ outcome_reason: 'unknown' }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({ workspace_id: otherWorkspaceId }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({ outcome_reason: 'quiet_hours' }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        next_attempt_at: new Date('2026-08-04T13:00:00.000Z'),
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({ delivery_local_date: null }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'deferred',
        next_attempt_at: null,
        outcome_reason: 'quiet_hours',
        delivery_local_date: null,
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'deferred',
        next_attempt_at: new Date('2026-08-04T13:00:00.000Z'),
        outcome_reason: 'delivery_failed',
        delivery_local_date: null,
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'deferred',
        next_attempt_at: new Date('2026-08-04T13:00:00.000Z'),
        outcome_reason: 'daily_limit',
        delivery_local_date: '2026-08-04',
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'failed',
        next_attempt_at: null,
        outcome_reason: 'attempt_limit',
        delivery_local_date: '2026-08-04',
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'failed',
        next_attempt_at: null,
        outcome_reason: 'delivery_failed',
        delivery_local_date: null,
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'failed',
        next_attempt_at: new Date('2026-08-04T13:00:00.000Z'),
        outcome_reason: 'attempt_limit',
        delivery_local_date: null,
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({
        outcome_kind: 'failed',
        next_attempt_at: null,
        outcome_reason: 'quiet_hours',
        delivery_local_date: null,
      }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({ delivery_local_date: '2026-13-01' }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({ delivery_local_date: '2026-02-30' }),
      /** Supports the outcome row test scenario without hiding production behavior. */
      outcomeRow({ delivery_local_date: new Date(Number.NaN) }),
    ];
    for (const row of invalidRows) {
      await expect(
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[row]]).client,
        ).listOutcomes(workspaceId, 1),
      ).rejects.toBeInstanceOf(NotificationPersistenceError);
    }
  });

  it('covers inbox chronology, delivery comparisons, and gateway transport failures', async () => {
    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([
          [inboxRow({ read_at: new Date('2026-08-04T12:00:02.000Z') })],
        ]).client,
      ).listInbox(workspaceId, 1),
    ).resolves.toMatchObject([{ readAt: '2026-08-04T12:00:02.000Z' }]);

    for (const row of [
      /** Supports the inbox row test scenario without hiding production behavior. */
      inboxRow({ read_at: new Date('2026-08-04T12:00:00.000Z') }),
      /** Supports the inbox row test scenario without hiding production behavior. */
      inboxRow({ workspace_id: otherWorkspaceId }),
    ]) {
      await expect(
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[row]]).client,
        ).listInbox(workspaceId, 1),
      ).rejects.toBeInstanceOf(NotificationPersistenceError);
    }

    const insertedMismatches = [
      { reminder_id: otherReminderId },
      { message_title: 'Different reminder' },
      { due_instant: new Date('2026-08-04T13:00:00.000Z') },
      { time_zone: 'UTC' },
    ];
    for (const overrides of insertedMismatches) {
      await expect(
        new PostgresInAppDeliveryGateway(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([[inboxRow(overrides)]]).client,
          () => messageId,
        ).deliver(baseDelivery),
      ).rejects.toBeInstanceOf(NotificationReplayConflictError);
    }

    await expect(
      new PostgresInAppDeliveryGateway(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([new Error('database unavailable')]).client,
        () => messageId,
      ).deliver(baseDelivery),
    ).rejects.toEqual(new NotificationPersistenceError());
  });

  it('covers transition outcome failures and every invalid terminal-state combination', async () => {
    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([[{ transitioned: true, outcome_inserted: false }]])
          .client,
        300,
        () => outcomeId,
        () => claimKey,
      ).markDelivered(
        baseReminder,
        '2026-08-04T12:00:01.000Z',
        claimKey,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);

    const invalidFailures = [
      () =>
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([]).client,
          300,
          () => outcomeId,
          () => claimKey,
        ).fail(baseReminder, null, 'delivery_failed', claimKey, idempotencyKey),
      () =>
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([]).client,
          300,
          () => outcomeId,
          () => claimKey,
        ).fail(
          { ...baseReminder, deliveryAttempt: MAX_DELIVERY_ATTEMPTS },
          '2026-08-04T12:05:00.000Z',
          'delivery_failed',
          claimKey,
          idempotencyKey,
        ),
      () =>
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([]).client,
          300,
          () => outcomeId,
          () => claimKey,
        ).fail(
          { ...baseReminder, deliveryAttempt: MAX_DELIVERY_ATTEMPTS },
          '2026-08-04T12:05:00.000Z',
          'attempt_limit',
          claimKey,
          idempotencyKey,
        ),
      () =>
        new PostgresReminderRepository(
          /** Supports the sequenced sql client test scenario without hiding production behavior. */
          sequencedSqlClient([]).client,
          300,
          () => outcomeId,
          () => claimKey,
        ).fail(baseReminder, null, 'attempt_limit', claimKey, idempotencyKey),
    ];
    for (const operation of invalidFailures) {
      await expect(operation()).rejects.toBeInstanceOf(
        NotificationPersistenceError,
      );
    }

    await expect(
      new PostgresReminderRepository(
        /** Supports the sequenced sql client test scenario without hiding production behavior. */
        sequencedSqlClient([]).client,
        300,
        () => 'invalid-outcome-id',
        () => claimKey,
      ).markDelivered(
        baseReminder,
        '2026-08-04T12:00:01.000Z',
        claimKey,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);
  });

  it('isolates a daily-limit deferral persistence failure', async () => {
    const dailyLimitedReminder: ReminderOccurrence = {
      ...baseReminder,
      quietHours: null,
      maxPerLocalDay: 1,
    };
    const repository: ReminderRepository = {
      listDue: async () => [dailyLimitedReminder],
      claim: async (..._arguments: unknown[]) => claimKey,
      countDelivered: async () => 1,
      markDelivered: async () => undefined,
      defer: async () => {
        throw new Error('persistence unavailable');
      },
      fail: async () => undefined,
    };
    const gateway: ReminderDeliveryGateway = {
      deliver: async () => {
        throw new Error('delivery must not run after the daily limit');
      },
    };

    await expect(
      new ReminderScheduler(repository, gateway).run(
        new Date('2026-08-04T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({
      scanned: 1,
      deferred: 0,
      delivered: 0,
      persistenceFailures: 1,
    });
  });
});
