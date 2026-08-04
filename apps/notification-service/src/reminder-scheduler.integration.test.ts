import { describe, expect, it } from 'vitest';
import {
  MAX_DELIVERY_ATTEMPTS,
  ReminderScheduler,
  type ReminderDelivery,
  type ReminderDeliveryGateway,
  type ReminderOccurrence,
  type ReminderRepository,
} from './reminder-scheduler';

const workspaceAlpha = '018f47a4-9976-4c57-8a8a-674630a873d1';
const workspaceBeta = '69b8f6fb-c65a-462e-b5e7-1b21808db998';
const reminderAlpha = '91fe0f58-2035-49b7-a793-ac75939a433f';

function reminder(
  overrides: Partial<ReminderOccurrence> = {},
): ReminderOccurrence {
  return {
    id: reminderAlpha,
    workspaceId: workspaceAlpha,
    title: 'Prepare the weekly review',
    dueAt: '2026-08-04T12:00:00.000Z',
    timeZone: 'Asia/Seoul',
    quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 },
    maxPerLocalDay: 4,
    deliveryAttempt: 0,
    ...overrides,
  };
}

interface Outcome {
  readonly kind: 'delivered' | 'deferred' | 'failed';
  readonly workspaceId: string;
  readonly reminderId: string;
  readonly at: string | null;
  readonly reason: string | null;
  readonly idempotencyKey: string;
}

function localDate(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
}

class InMemoryReminderRepository implements ReminderRepository {
  readonly claims = new Map<string, string>();
  readonly outcomes: Outcome[] = [];
  readonly deliveredByWorkspaceDate = new Map<string, number>();

  constructor(readonly records: readonly unknown[]) {}

  async listDue(_now: string, limit: number): Promise<readonly unknown[]> {
    return this.records.slice(0, limit);
  }

  async claim(workspaceId: string, reminderId: string): Promise<string | null> {
    const occurrenceKey = `${workspaceId}:${reminderId}`;
    if (this.claims.has(occurrenceKey)) return null;
    const claimKey = `${occurrenceKey}:claim`;
    this.claims.set(occurrenceKey, claimKey);
    return claimKey;
  }

  async countDelivered(workspaceId: string, date: string): Promise<number> {
    return this.deliveredByWorkspaceDate.get(`${workspaceId}:${date}`) ?? 0;
  }

  async markDelivered(
    value: ReminderOccurrence,
    deliveredAt: string,
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.requireClaim(value, claimKey);
    const date = localDate(deliveredAt, value.timeZone);
    const key = `${value.workspaceId}:${date}`;
    this.deliveredByWorkspaceDate.set(
      key,
      (this.deliveredByWorkspaceDate.get(key) ?? 0) + 1,
    );
    this.outcomes.push({
      kind: 'delivered',
      workspaceId: value.workspaceId,
      reminderId: value.id,
      at: deliveredAt,
      reason: null,
      idempotencyKey,
    });
  }

  async defer(
    value: ReminderOccurrence,
    nextAttemptAt: string,
    reason: 'quiet_hours' | 'daily_limit',
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.release(value, claimKey);
    this.outcomes.push({
      kind: 'deferred',
      workspaceId: value.workspaceId,
      reminderId: value.id,
      at: nextAttemptAt,
      reason,
      idempotencyKey,
    });
  }

  async fail(
    value: ReminderOccurrence,
    retryAt: string | null,
    reason: 'delivery_failed' | 'attempt_limit',
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    this.requireClaim(value, claimKey);
    if (retryAt !== null) this.release(value, claimKey);
    this.outcomes.push({
      kind: 'failed',
      workspaceId: value.workspaceId,
      reminderId: value.id,
      at: retryAt,
      reason,
      idempotencyKey,
    });
  }

  private occurrenceKey(value: ReminderOccurrence): string {
    return `${value.workspaceId}:${value.id}`;
  }

  private requireClaim(value: ReminderOccurrence, claimKey: string): void {
    if (this.claims.get(this.occurrenceKey(value)) !== claimKey) {
      throw new Error('claim is not owned');
    }
  }

  private release(value: ReminderOccurrence, claimKey: string): void {
    this.requireClaim(value, claimKey);
    this.claims.delete(this.occurrenceKey(value));
  }
}

type PersistenceOperation = 'defer' | 'fail' | 'markDelivered';

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
  readonly messages: ReminderDelivery[] = [];
  shouldFail = false;

  async deliver(message: ReminderDelivery): Promise<void> {
    this.messages.push(message);
    if (this.shouldFail) throw new Error('provider secret must not escape');
  }
}

describe('bounded reminder scheduling integration', () => {
  it('uses an atomic tenant-scoped claim to prevent concurrent duplicates', async () => {
    const repository = new InMemoryReminderRepository([
      reminder({ quietHours: null }),
    ]);
    const gateway = new RecordingGateway();
    const first = new ReminderScheduler(repository, gateway);
    const second = new ReminderScheduler(repository, gateway);

    const reports = await Promise.all([
      first.run(new Date('2026-08-04T12:00:00.000Z')),
      second.run(new Date('2026-08-04T12:00:00.000Z')),
    ]);

    expect(gateway.messages).toHaveLength(1);
    expect(reports.reduce((sum, report) => sum + report.delivered, 0)).toBe(1);
    expect(
      reports.reduce((sum, report) => sum + report.duplicateClaims, 0),
    ).toBe(1);
    expect(gateway.messages[0]?.workspaceId).toBe(workspaceAlpha);
    expect(gateway.messages[0]?.idempotencyKey).toContain(workspaceAlpha);
  });

  it('defers through a daylight-saving fallback until local quiet hours end', async () => {
    const repository = new InMemoryReminderRepository([
      reminder({
        dueAt: '2026-11-01T05:30:00.000Z',
        timeZone: 'America/New_York',
      }),
    ]);
    const gateway = new RecordingGateway();

    const report = await new ReminderScheduler(repository, gateway).run(
      new Date('2026-11-01T05:30:00.000Z'),
    );

    expect(report.deferred).toBe(1);
    expect(gateway.messages).toHaveLength(0);
    expect(repository.outcomes[0]).toMatchObject({
      kind: 'deferred',
      at: '2026-11-01T12:00:00.000Z',
      reason: 'quiet_hours',
    });
  });

  it('moves a fatigued workspace to its next local calendar day', async () => {
    const value = reminder({
      dueAt: '2026-08-04T15:30:00.000Z',
      quietHours: null,
      maxPerLocalDay: 1,
    });
    const repository = new InMemoryReminderRepository([value]);
    repository.deliveredByWorkspaceDate.set(`${workspaceAlpha}:2026-08-05`, 1);

    const report = await new ReminderScheduler(
      repository,
      new RecordingGateway(),
    ).run(new Date('2026-08-04T15:30:00.000Z'));

    expect(report.deferred).toBe(1);
    expect(repository.outcomes[0]).toMatchObject({
      kind: 'deferred',
      at: '2026-08-05T15:00:00.000Z',
      reason: 'daily_limit',
    });
  });

  it('covers a 27-hour local day before leaving next-day quiet hours', async () => {
    const value = reminder({
      dueAt: '2020-03-06T17:00:00.000Z',
      timeZone: 'Antarctica/Casey',
      quietHours: { startMinute: 0, endMinute: 3 * 60 + 30 },
      maxPerLocalDay: 1,
    });
    const repository = new InMemoryReminderRepository([value]);
    repository.deliveredByWorkspaceDate.set(`${workspaceAlpha}:2020-03-07`, 1);

    const report = await new ReminderScheduler(
      repository,
      new RecordingGateway(),
    ).run(new Date('2020-03-06T17:00:00.000Z'));

    expect(report.deferred).toBe(1);
    expect(repository.outcomes[0]).toMatchObject({
      kind: 'deferred',
      at: '2020-03-07T19:30:00.000Z',
      reason: 'daily_limit',
    });
    expect(repository.claims.size).toBe(0);
  });

  it('counts deliveries independently for each workspace', async () => {
    const betaReminder = reminder({
      id: 'ee09fe10-2602-4d6c-b52a-e58cbf55ea41',
      workspaceId: workspaceBeta,
      quietHours: null,
      maxPerLocalDay: 1,
    });
    const repository = new InMemoryReminderRepository([betaReminder]);
    repository.deliveredByWorkspaceDate.set(`${workspaceAlpha}:2026-08-04`, 20);
    const gateway = new RecordingGateway();

    const report = await new ReminderScheduler(repository, gateway).run(
      new Date('2026-08-04T12:00:00.000Z'),
    );

    expect(report.delivered).toBe(1);
    expect(gateway.messages[0]?.workspaceId).toBe(workspaceBeta);
  });

  it('records a credential-free bounded retry after provider failure', async () => {
    const repository = new InMemoryReminderRepository([
      reminder({ quietHours: null, deliveryAttempt: 0 }),
    ]);
    const gateway = new RecordingGateway();
    gateway.shouldFail = true;

    const report = await new ReminderScheduler(repository, gateway).run(
      new Date('2026-08-04T12:00:00.000Z'),
    );

    expect(report.failed).toBe(1);
    expect(repository.outcomes[0]).toEqual({
      kind: 'failed',
      workspaceId: workspaceAlpha,
      reminderId: reminderAlpha,
      at: '2026-08-04T12:05:00.000Z',
      reason: 'delivery_failed',
      idempotencyKey: `${workspaceAlpha}:${reminderAlpha}:2026-08-04T12:00:00.000Z`,
    });
    expect(JSON.stringify(repository.outcomes)).not.toContain(
      'provider secret',
    );
  });

  it('stops permanently at the bounded attempt limit without provider delivery', async () => {
    const repository = new InMemoryReminderRepository([
      reminder({
        quietHours: null,
        deliveryAttempt: MAX_DELIVERY_ATTEMPTS,
      }),
    ]);
    const gateway = new RecordingGateway();

    const report = await new ReminderScheduler(repository, gateway).run(
      new Date('2026-08-04T12:00:00.000Z'),
    );

    expect(report.failed).toBe(1);
    expect(gateway.messages).toHaveLength(0);
    expect(repository.outcomes[0]).toMatchObject({
      kind: 'failed',
      at: null,
      reason: 'attempt_limit',
    });
  });

  it('isolates transition persistence failures and continues the batch', async () => {
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
    const valid = reminder({ quietHours: null });
    const repository = new InMemoryReminderRepository([
      { ...valid, id: 'not-a-uuid' },
      { ...valid, dueAt: '2026-08-04T13:00:00.000Z' },
      valid,
      valid,
    ]);
    const gateway = new RecordingGateway();

    const report = await new ReminderScheduler(repository, gateway, 3).run(
      new Date('2026-08-04T12:00:00.000Z'),
    );

    expect(report).toMatchObject({ scanned: 3, invalid: 2, delivered: 1 });
    expect(gateway.messages).toHaveLength(1);
  });
});
