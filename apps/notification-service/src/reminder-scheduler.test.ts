import { describe, expect, it, vi } from 'vitest';
import {
  MAX_DAILY_REMINDERS,
  MAX_DELIVERY_ATTEMPTS,
  ReminderScheduler,
  ReminderValidationError,
  isWithinQuietHours,
  validateReminderOccurrence,
  type ReminderDelivery,
  type ReminderDeliveryGateway,
  type ReminderOccurrence,
  type ReminderRepository,
} from './reminder-scheduler';

const workspaceId = '018f47a4-9976-4c57-8a8a-674630a873d1';
const reminderId = '91fe0f58-2035-49b7-a793-ac75939a433f';

function reminder(
  overrides: Partial<ReminderOccurrence> = {},
): ReminderOccurrence {
  return {
    id: reminderId,
    workspaceId,
    title: 'Prepare the weekly review',
    dueAt: '2026-08-04T12:00:00.000Z',
    timeZone: 'Asia/Seoul',
    quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 },
    maxPerLocalDay: 4,
    deliveryAttempt: 0,
    ...overrides,
  };
}

/** Implements the noop repository test double with observable deterministic behavior. */
class NoopRepository implements ReminderRepository {
  /** Returns a bounded deterministic set of currently due reminder occurrences. */
  async listDue(): Promise<readonly unknown[]> {
    return [];
  }
  /** Attempts to acquire the exact observed reminder occurrence using a fenced expiring claim. */
  async claim(
    _workspaceId: string,
    _reminderId: string,
    _dueAt: string,
    _deliveryAttempt: number,
  ): Promise<string | null> {
    return 'noop-claim-key';
  }
  /** Counts delivered outcomes for one workspace and one local calendar date. */
  async countDelivered(): Promise<number> {
    return 0;
  }
  /** Atomically completes a fenced claim and records an immutable delivered outcome. */
  async markDelivered(): Promise<void> {}
  /** Atomically reschedules a fenced occurrence and records its immutable deferral outcome. */
  async defer(): Promise<void> {}
  /** Atomically records a bounded retry or terminal reminder failure. */
  async fail(): Promise<void> {}
}

/** Implements the static repository test double with observable deterministic behavior. */
class StaticRepository extends NoopRepository {
  /** Creates the component with explicit dependencies and deterministic initial state. */
  constructor(private readonly records: readonly unknown[]) {
    super();
  }

  /** Returns a bounded deterministic set of currently due reminder occurrences. */
  override async listDue(): Promise<readonly unknown[]> {
    return this.records;
  }
}

/** Implements the noop gateway test double with observable deterministic behavior. */
class NoopGateway implements ReminderDeliveryGateway {
  /** Persists or verifies one idempotent in-app reminder delivery. */
  async deliver(_message: ReminderDelivery): Promise<void> {}
}

describe('reminder boundary validation', () => {
  it('normalizes a bounded offset instant while preserving authored text', () => {
    const value = validateReminderOccurrence(
      reminder({ dueAt: '2026-08-04T21:00:00+09:00' }),
    );

    expect(value.dueAt).toBe('2026-08-04T12:00:00.000Z');
    expect(value.title).toBe('Prepare the weekly review');
  });

  it('treats an omitted quiet-hours policy as disabled', () => {
    const value = { ...reminder() } as Record<string, unknown>;
    delete value.quietHours;

    expect(validateReminderOccurrence(value).quietHours).toBeNull();
  });

  it.each([
    [null, 'invalid_record'],
    [[], 'invalid_record'],
    [{ ...reminder(), id: '1' }, 'invalid_identifier'],
    [{ ...reminder(), id: null }, 'invalid_identifier'],
    [{ ...reminder(), title: '' }, 'invalid_title'],
    [{ ...reminder(), title: ' trailing ' }, 'invalid_title'],
    [{ ...reminder(), title: 'x'.repeat(161) }, 'invalid_title'],
    [{ ...reminder(), title: 'unsafe\u0000title' }, 'invalid_title'],
    [{ ...reminder(), title: 7 }, 'invalid_title'],
    [{ ...reminder(), dueAt: 'tomorrow' }, 'invalid_due_at'],
    [{ ...reminder(), dueAt: 7 }, 'invalid_due_at'],
    [{ ...reminder(), dueAt: 'x'.repeat(41) }, 'invalid_due_at'],
    [{ ...reminder(), dueAt: '2026-13-01T00:00:00Z' }, 'invalid_due_at'],
    [{ ...reminder(), timeZone: 'Mars/Olympus' }, 'invalid_time_zone'],
    [{ ...reminder(), timeZone: '' }, 'invalid_time_zone'],
    [{ ...reminder(), timeZone: 7 }, 'invalid_time_zone'],
    [{ ...reminder(), timeZone: 'x'.repeat(65) }, 'invalid_time_zone'],
    [{ ...reminder(), quietHours: 'night' }, 'invalid_quiet_hours'],
    [
      {
        ...reminder(),
        quietHours: { startMinute: 1.5, endMinute: 60 },
      },
      'invalid_quiet_hours',
    ],
    [
      {
        ...reminder(),
        quietHours: { startMinute: -1, endMinute: 60 },
      },
      'invalid_quiet_hours',
    ],
    [
      {
        ...reminder(),
        quietHours: { startMinute: 60, endMinute: 1_440 },
      },
      'invalid_quiet_hours',
    ],
    [
      {
        ...reminder(),
        quietHours: { startMinute: 60, endMinute: 60 },
      },
      'invalid_quiet_hours',
    ],
    [{ ...reminder(), maxPerLocalDay: 0 }, 'invalid_daily_limit'],
    [{ ...reminder(), maxPerLocalDay: 1.5 }, 'invalid_daily_limit'],
    [
      { ...reminder(), maxPerLocalDay: MAX_DAILY_REMINDERS + 1 },
      'invalid_daily_limit',
    ],
    [{ ...reminder(), deliveryAttempt: -1 }, 'invalid_delivery_attempt'],
    [{ ...reminder(), deliveryAttempt: 1.5 }, 'invalid_delivery_attempt'],
    [
      { ...reminder(), deliveryAttempt: MAX_DELIVERY_ATTEMPTS + 1 },
      'invalid_delivery_attempt',
    ],
  ])('rejects malformed records with stable code %#', (value, code) => {
    expect(() => validateReminderOccurrence(value)).toThrowError(
      new ReminderValidationError(code as never),
    );
  });
});

describe('quiet-hours evaluation', () => {
  it('supports same-day and overnight intervals with an exclusive end', () => {
    expect(
      isWithinQuietHours(9 * 60, { startMinute: 8 * 60, endMinute: 10 * 60 }),
    ).toBe(true);
    expect(
      isWithinQuietHours(10 * 60, {
        startMinute: 8 * 60,
        endMinute: 10 * 60,
      }),
    ).toBe(false);
    expect(
      isWithinQuietHours(23 * 60, {
        startMinute: 22 * 60,
        endMinute: 7 * 60,
      }),
    ).toBe(true);
    expect(
      isWithinQuietHours(6 * 60 + 59, {
        startMinute: 22 * 60,
        endMinute: 7 * 60,
      }),
    ).toBe(true);
    expect(
      isWithinQuietHours(12 * 60, {
        startMinute: 22 * 60,
        endMinute: 7 * 60,
      }),
    ).toBe(false);
  });
});

describe('scheduler options and defensive failures', () => {
  it('rejects non-integer and out-of-range batch sizes', () => {
    expect(
      () => new ReminderScheduler(new NoopRepository(), new NoopGateway(), 0),
    ).toThrow(RangeError);
    expect(
      () => new ReminderScheduler(new NoopRepository(), new NoopGateway(), 1.5),
    ).toThrow(RangeError);
    expect(
      () => new ReminderScheduler(new NoopRepository(), new NoopGateway(), 101),
    ).toThrow(RangeError);
  });

  it('rejects an invalid scheduler instant before repository access', async () => {
    await expect(
      new ReminderScheduler(new NoopRepository(), new NoopGateway()).run(
        new Date(Number.NaN),
      ),
    ).rejects.toThrow('now must be a valid instant');
  });

  it('rethrows an unexpected repository-record accessor failure', async () => {
    const malformed = Object.defineProperty({}, 'id', {
      get(): never {
        throw new Error('unexpected accessor failure');
      },
    });

    await expect(
      new ReminderScheduler(
        new StaticRepository([malformed]),
        new NoopGateway(),
      ).run(new Date('2026-08-04T12:00:00.000Z')),
    ).rejects.toThrow('unexpected accessor failure');
  });

  it('fails closed when the platform omits required zoned-clock parts', async () => {
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({
          format: () => 'valid',
          formatToParts: () => [
            { type: 'year', value: '2026' },
            { type: 'month', value: '08' },
            { type: 'day', value: '04' },
          ],
        }) as Intl.DateTimeFormat,
    );
    try {
      await expect(
        new ReminderScheduler(
          new StaticRepository([reminder({ quietHours: null })]),
          new NoopGateway(),
        ).run(new Date('2026-08-04T12:00:00.000Z')),
      ).rejects.toThrowError(new ReminderValidationError('invalid_time_zone'));
    } finally {
      formatter.mockRestore();
    }
  });

  it('keeps policy search bounded when local time never exits quiet hours', async () => {
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({
          format: () => 'valid',
          formatToParts: () => [
            { type: 'year', value: '2026' },
            { type: 'month', value: '08' },
            { type: 'day', value: '04' },
            { type: 'hour', value: '23' },
            { type: 'minute', value: '00' },
          ],
        }) as Intl.DateTimeFormat,
    );
    try {
      await expect(
        new ReminderScheduler(
          new StaticRepository([reminder()]),
          new NoopGateway(),
        ).run(new Date('2026-08-04T12:00:00.000Z')),
      ).rejects.toThrowError(new ReminderValidationError('invalid_time_zone'));
    } finally {
      formatter.mockRestore();
    }
  });

  it('isolates delivered-count persistence failures and continues the batch', async () => {
    const secondReminderId = '2f3d9a62-7169-4d5e-9b0e-8d2a4b62ccef';
    const repository = new StaticRepository([
      reminder({ quietHours: null }),
      reminder({ id: secondReminderId, quietHours: null }),
    ]);
    const countDelivered = vi
      .spyOn(repository, 'countDelivered')
      .mockRejectedValueOnce(new Error('count unavailable'))
      .mockResolvedValue(0);
    const markDelivered = vi.spyOn(repository, 'markDelivered');
    const gateway = new NoopGateway();
    const deliver = vi.spyOn(gateway, 'deliver');

    const report = await new ReminderScheduler(repository, gateway).run(
      new Date('2026-08-04T12:00:00.000Z'),
    );

    expect(report).toEqual({
      scanned: 2,
      delivered: 1,
      deferred: 0,
      failed: 0,
      persistenceFailures: 1,
      duplicateClaims: 0,
      invalid: 0,
    });
    expect(countDelivered).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ id: secondReminderId }),
      '2026-08-04T12:00:00.000Z',
      'noop-claim-key',
      `${workspaceId}:${secondReminderId}:2026-08-04T12:00:00.000Z`,
    );
  });
});
