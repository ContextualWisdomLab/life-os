import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  ReminderDelivery,
  ReminderOccurrence,
} from './reminder-scheduler';
import {
  NotificationPersistenceError,
  NotificationReplayConflictError,
  PostgresInAppDeliveryGateway,
  PostgresReminderRepository,
  hashNotificationIdempotencyKey,
  /** Represents the notification sql client values used by deterministic test fixtures. */
  type NotificationSqlClient,
  /** Represents the notification sql query result values used by deterministic test fixtures. */
  type NotificationSqlQueryResult,
} from './postgres-reminder-repository';

const workspaceId = '018f47a4-9976-4c57-8a8a-674630a873d1';
const otherWorkspaceId = '69b8f6fb-c65a-462e-b5e7-1b21808db998';
const reminderId = '91fe0f58-2035-49b7-a793-ac75939a433f';
const outcomeId = 'fa6d0f3e-337c-4d94-b17d-4afcf6bf79c1';
const messageId = 'ca035df4-0149-4b08-8f21-07bd758cfbaa';
const claimKey = 'ebeb80f5-a077-45ee-9f39-f3e64af94cdb';
const idempotencyKey = `${workspaceId}:${reminderId}:2026-08-04T12:00:00.000Z`;

/** Defines the query call shape used to make the test evidence explicit. */
interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** Implements the recording sql client test double with observable deterministic behavior. */
class RecordingSqlClient implements NotificationSqlClient {
  readonly calls: QueryCall[] = [];

  /** Creates the component with explicit dependencies and deterministic initial state. */
  constructor(private readonly responses: readonly unknown[][]) {}

  /** Executes one parameterized query through the bounded SQL or test-double contract. */
  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.responses[this.calls.length - 1] ?? [];
    return { rows: response as Row[] };
  }
}

/** Supports the reminder test scenario without hiding production behavior. */
function reminder(
  overrides: Partial<ReminderOccurrence> = {},
): ReminderOccurrence {
  return {
    id: reminderId,
    workspaceId,
    title: 'Prepare the weekly review',
    dueAt: '2026-08-04T12:00:00.000Z',
    timeZone: 'Asia/Seoul',
    quietHours: { startMinute: 1320, endMinute: 420 },
    maxPerLocalDay: 4,
    deliveryAttempt: 0,
    ...overrides,
  };
}

/** Supports the reminder row test scenario without hiding production behavior. */
function reminderRow(overrides: Record<string, unknown> = {}) {
  return {
    reminder_id: reminderId,
    workspace_id: workspaceId,
    reminder_title: 'Prepare the weekly review',
    due_instant: new Date('2026-08-04T12:00:00.000Z'),
    time_zone: 'Asia/Seoul',
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

/** Supports the inbox row test scenario without hiding production behavior. */
function inboxRow(overrides: Record<string, unknown> = {}) {
  return {
    message_id: messageId,
    workspace_id: workspaceId,
    reminder_id: reminderId,
    message_title: 'Prepare the weekly review',
    due_instant: new Date('2026-08-04T12:00:00.000Z'),
    time_zone: 'Asia/Seoul',
    delivered_at: new Date('2026-08-04T12:00:01.000Z'),
    read_at: null,
    created_at: new Date('2026-08-04T12:00:01.000Z'),
    ...overrides,
  };
}

/** Supports the outcome row test scenario without hiding production behavior. */
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

describe('notification idempotency digest', () => {
  it('returns the exact SHA-256 bytes without retaining the raw key', () => {
    const digest = hashNotificationIdempotencyKey(idempotencyKey);

    expect(Buffer.isBuffer(digest)).toBe(true);
    expect(digest).toHaveLength(32);
    expect(digest).toEqual(
      /** Supports the create hash test scenario without hiding production behavior. */
      createHash('sha256').update(idempotencyKey, 'utf8').digest(),
    );
    expect(digest.toString('utf8')).not.toContain(idempotencyKey);
  });

  it('rejects empty, control-bearing, non-string, and oversized keys', () => {
    for (const value of [
      '',
      'key\nvalue',
      42,
      'x'.repeat(1025),
      'é'.repeat(600),
    ]) {
      expect(() => hashNotificationIdempotencyKey(value)).toThrowError(
        NotificationPersistenceError,
      );
    }
  });
});

describe('PostgresReminderRepository', () => {
  it('inserts and returns one validated reminder with static parameters', async () => {
    const client = new RecordingSqlClient([[reminderRow()]]);
    const repository = new PostgresReminderRepository(client, 300);

    await expect(repository.schedule(reminder())).resolves.toEqual({
      ...reminder(),
      status: 'pending',
      claimExpiresAt: null,
      createdAt: '2026-08-04T10:00:00.000Z',
      updatedAt: '2026-08-04T10:00:00.000Z',
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'INSERT INTO notification_service.reminder_occurrences',
    );
    expect(client.calls[0]?.text).toContain('ON CONFLICT DO NOTHING');
    expect(client.calls[0]?.text).not.toContain(reminder().title);
    expect(client.calls[0]?.values).toEqual([
      reminderId,
      workspaceId,
      /** Supports the reminder test scenario without hiding production behavior. */
      reminder().title,
      /** Supports the reminder test scenario without hiding production behavior. */
      reminder().dueAt,
      /** Supports the reminder test scenario without hiding production behavior. */
      reminder().timeZone,
      1320,
      420,
      4,
      0,
    ]);
  });

  it('returns an exact schedule replay and rejects conflicting identifier reuse', async () => {
    const exactClient = new RecordingSqlClient([[], [reminderRow()]]);
    const exactRepository = new PostgresReminderRepository(exactClient);
    await expect(exactRepository.schedule(reminder())).resolves.toMatchObject({
      id: reminderId,
      workspaceId,
      title: reminder().title,
    });
    expect(exactClient.calls[1]?.text).toContain(
      'WHERE workspace_id = $1 AND reminder_id = $2',
    );

    const conflictClient = new RecordingSqlClient([
      [],
      [reminderRow({ reminder_title: 'Different reminder' })],
    ]);
    await expect(
      new PostgresReminderRepository(conflictClient).schedule(reminder()),
    ).rejects.toBeInstanceOf(NotificationReplayConflictError);
  });

  it('lists due rows in bounded deterministic order and validates every row', async () => {
    const client = new RecordingSqlClient([[reminderRow()]]);
    const repository = new PostgresReminderRepository(client);

    await expect(
      repository.listDue('2026-08-04T12:00:00.000Z', 20),
    ).resolves.toEqual([reminder()]);
    expect(client.calls[0]?.text).toContain("occurrence_status = 'pending'");
    expect(client.calls[0]?.text).toContain(
      'claim_expires_at IS NULL OR claim_expires_at <= $1',
    );
    expect(client.calls[0]?.text).toContain(
      'ORDER BY due_instant ASC, reminder_id ASC',
    );
    expect(client.calls[0]?.text).toContain('LIMIT $2');
    expect(client.calls[0]?.values).toEqual(['2026-08-04T12:00:00.000Z', 20]);

    const invalidClient = new RecordingSqlClient([
      [reminderRow({ workspace_id: 'numeric-1' })],
    ]);
    await expect(
      new PostgresReminderRepository(invalidClient).listDue(
        '2026-08-04T12:00:00.000Z',
        20,
      ),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);
  });

  it('returns one opaque claim key and null when the lease is unavailable', async () => {
    const claimedClient = new RecordingSqlClient([
      [{ reminder_id: reminderId }],
    ]);
    const repository = new PostgresReminderRepository(
      claimedClient,
      600,
      () => outcomeId,
      () => claimKey,
    );

    await expect(
      repository.claim(
        workspaceId,
        reminderId,
        /** Supports the reminder test scenario without hiding production behavior. */
        reminder().dueAt,
        /** Supports the reminder test scenario without hiding production behavior. */
        reminder().deliveryAttempt,
      ),
    ).resolves.toBe(claimKey);
    const call = claimedClient.calls[0];
    expect(call?.text).toContain(
      'UPDATE notification_service.reminder_occurrences',
    );
    expect(call?.text).toContain('claim_expires_at <= clock_timestamp()');
    expect(call?.text).toContain('make_interval(secs => $4)');
    expect(call?.text).toContain('due_instant = $5');
    expect(call?.text).toContain('delivery_attempt_count = $6');
    expect(call?.values?.[0]).toBe(workspaceId);
    expect(call?.values?.[1]).toBe(reminderId);
    expect(call?.values?.[2]).toEqual(hashNotificationIdempotencyKey(claimKey));
    expect(call?.values?.[3]).toBe(600);
    expect(call?.values?.[4]).toBe(reminder().dueAt);
    expect(call?.values?.[5]).toBe(reminder().deliveryAttempt);

    const missedClient = new RecordingSqlClient([[]]);
    await expect(
      new PostgresReminderRepository(
        missedClient,
        300,
        () => outcomeId,
        () => claimKey,
      ).claim(
        workspaceId,
        reminderId,
        /** Supports the reminder test scenario without hiding production behavior. */
        reminder().dueAt,
        /** Supports the reminder test scenario without hiding production behavior. */
        reminder().deliveryAttempt,
      ),
    ).resolves.toBeNull();
    await expect(
      new PostgresReminderRepository(
        new RecordingSqlClient([]),
        300,
        () => outcomeId,
        () => 'numeric-claim-key',
      ).claim(
        workspaceId,
        reminderId,
        /** Supports the reminder test scenario without hiding production behavior. */
        reminder().dueAt,
        /** Supports the reminder test scenario without hiding production behavior. */
        reminder().deliveryAttempt,
      ),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);
  });

  it('counts delivered outcomes by tenant and validated local date', async () => {
    const client = new RecordingSqlClient([[{ delivery_count: '7' }]]);
    const repository = new PostgresReminderRepository(client);

    await expect(
      repository.countDelivered(workspaceId, '2026-08-04'),
    ).resolves.toBe(7);
    expect(client.calls[0]?.text).toContain('WHERE workspace_id = $1');
    expect(client.calls[0]?.text).toContain("outcome_kind = 'delivered'");
    expect(client.calls[0]?.values).toEqual([workspaceId, '2026-08-04']);
  });

  it('persists delivered, deferred, retryable, and terminal transitions atomically', async () => {
    const response = [{ transitioned: true, outcome_inserted: true }];
    const client = new RecordingSqlClient([
      response,
      response,
      response,
      response,
    ]);
    const repository = new PostgresReminderRepository(client);

    await repository.markDelivered(
      /** Supports the reminder test scenario without hiding production behavior. */
      reminder(),
      '2026-08-04T12:00:01.000Z',
      claimKey,
      idempotencyKey,
    );
    await repository.defer(
      /** Supports the reminder test scenario without hiding production behavior. */
      reminder(),
      '2026-08-04T22:00:00.000Z',
      'quiet_hours',
      claimKey,
      idempotencyKey,
    );
    await repository.fail(
      /** Supports the reminder test scenario without hiding production behavior. */
      reminder(),
      '2026-08-04T12:05:00.000Z',
      'delivery_failed',
      claimKey,
      idempotencyKey,
    );
    await repository.fail(
      /** Supports the reminder test scenario without hiding production behavior. */
      reminder({ deliveryAttempt: 3 }),
      null,
      'attempt_limit',
      claimKey,
      idempotencyKey,
    );

    for (const call of client.calls) {
      expect(call.text).toContain('WITH transitioned_occurrence AS');
      expect(call.text).toContain('claim_expires_at > clock_timestamp()');
      expect(call.text).toContain(
        'INSERT INTO notification_service.reminder_outcomes',
      );
      const claimDigest = hashNotificationIdempotencyKey(claimKey);
      const deliveryDigest = hashNotificationIdempotencyKey(idempotencyKey);
      expect(call.values).toContainEqual(deliveryDigest);
      expect(call.values).toContainEqual(claimDigest);
      expect(claimDigest).not.toEqual(deliveryDigest);
    }
    expect(client.calls[0]?.text).toContain("occurrence_status = 'delivered'");
    expect(client.calls[1]?.text).toContain("'deferred'");
    expect(client.calls[2]?.text).toContain('delivery_attempt_count + 1');
    expect(client.calls[3]?.text).toContain("occurrence_status = 'failed'");
  });

  it('fails closed when a transition does not own the exact claim', async () => {
    const repository = new PostgresReminderRepository(
      new RecordingSqlClient([
        [{ transitioned: false, outcome_inserted: false }],
      ]),
    );

    await expect(
      repository.markDelivered(
        /** Supports the reminder test scenario without hiding production behavior. */
        reminder(),
        '2026-08-04T12:00:01.000Z',
        claimKey,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);
  });

  it('lists bounded tenant reminders, outcomes, and inbox rows', async () => {
    const client = new RecordingSqlClient([
      [reminderRow()],
      [outcomeRow()],
      [inboxRow()],
    ]);
    const repository = new PostgresReminderRepository(client);

    await expect(
      repository.listReminders(workspaceId, 10),
    ).resolves.toHaveLength(1);
    await expect(repository.listOutcomes(workspaceId, 10)).resolves.toEqual([
      {
        id: outcomeId,
        workspaceId,
        reminderId,
        kind: 'delivered',
        occurredAt: '2026-08-04T12:00:01.000Z',
        nextAttemptAt: null,
        reason: null,
        deliveryLocalDate: '2026-08-04',
        createdAt: '2026-08-04T12:00:01.000Z',
      },
    ]);
    await expect(repository.listInbox(workspaceId, 10)).resolves.toEqual([
      {
        id: messageId,
        workspaceId,
        reminderId,
        title: reminder().title,
        dueAt: reminder().dueAt,
        timeZone: reminder().timeZone,
        deliveredAt: '2026-08-04T12:00:01.000Z',
        readAt: null,
        createdAt: '2026-08-04T12:00:01.000Z',
      },
    ]);
    for (const call of client.calls) {
      expect(call.text).toContain('WHERE workspace_id = $1');
      expect(call.text).toContain('LIMIT $2');
      expect(call.values).toEqual([workspaceId, 10]);
    }
  });

  it('preserves PostgreSQL date values at a positive-offset boundary', async () => {
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
    expect(
      () => new PostgresReminderRepository(new RecordingSqlClient([]), 29),
    ).toThrowError(NotificationPersistenceError);
    expect(
      () => new PostgresReminderRepository(new RecordingSqlClient([]), 3601),
    ).toThrowError(NotificationPersistenceError);

    const repository = new PostgresReminderRepository(
      new RecordingSqlClient([]),
    );
    for (const operation of [
      () => repository.listDue('invalid', 10),
      () => repository.listDue('2026-08-04', 10),
      () => repository.listDue('2026-08-04T12:00:00.000Z', 0),
      () => repository.countDelivered('123', '2026-08-04'),
      () => repository.countDelivered(workspaceId, '08/04/2026'),
      () => repository.listReminders(workspaceId, 101),
      () => repository.listOutcomes('123', 10),
      () => repository.listInbox(workspaceId, 1.5),
    ]) {
      await expect(operation()).rejects.toBeInstanceOf(
        NotificationPersistenceError,
      );
    }

    const failingClient: NotificationSqlClient = {
      /** Executes one parameterized query through the bounded SQL or test-double contract. */
      async query() {
        throw new Error('database secret must not escape');
      },
    };
    await expect(
      new PostgresReminderRepository(failingClient).listReminders(
        workspaceId,
        10,
      ),
    ).rejects.toEqual(new NotificationPersistenceError());
  });
});

describe('PostgresInAppDeliveryGateway', () => {
  const delivery: ReminderDelivery = {
    workspaceId,
    reminderId,
    title: reminder().title,
    dueAt: reminder().dueAt,
    timeZone: reminder().timeZone,
    idempotencyKey,
  };

  it('inserts one credential-free message with an opaque ID and digest', async () => {
    const client = new RecordingSqlClient([[inboxRow()]]);
    const gateway = new PostgresInAppDeliveryGateway(client, () => messageId);

    await expect(gateway.deliver(delivery)).resolves.toBeUndefined();
    const call = client.calls[0];
    expect(call?.text).toContain(
      'INSERT INTO notification_service.inbox_messages',
    );
    expect(call?.text).toContain('ON CONFLICT DO NOTHING');
    expect(call?.text).not.toContain(delivery.title);
    expect(call?.values).toEqual([
      messageId,
      workspaceId,
      reminderId,
      delivery.title,
      delivery.dueAt,
      delivery.timeZone,
      /** Supports the hash notification idempotency key test scenario without hiding production behavior. */
      hashNotificationIdempotencyKey(idempotencyKey),
    ]);
  });

  it('accepts exact replay and rejects an idempotency collision', async () => {
    const exactClient = new RecordingSqlClient([[], [inboxRow()]]);
    await expect(
      new PostgresInAppDeliveryGateway(exactClient, () => messageId).deliver(
        delivery,
      ),
    ).resolves.toBeUndefined();

    const conflictClient = new RecordingSqlClient([
      [],
      [inboxRow({ reminder_id: 'ee09fe10-2602-4d6c-b52a-e58cbf55ea41' })],
    ]);
    await expect(
      new PostgresInAppDeliveryGateway(conflictClient, () => messageId).deliver(
        delivery,
      ),
    ).rejects.toBeInstanceOf(NotificationReplayConflictError);
  });

  it('rejects malformed delivery envelopes and UUID factories', async () => {
    await expect(
      new PostgresInAppDeliveryGateway(new RecordingSqlClient([])).deliver({
        ...delivery,
        workspaceId: otherWorkspaceId,
        reminderId: 'numeric-2',
      }),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);

    await expect(
      new PostgresInAppDeliveryGateway(
        new RecordingSqlClient([]),
        () => 'numeric-3',
      ).deliver(delivery),
    ).rejects.toBeInstanceOf(NotificationPersistenceError);
  });
});
