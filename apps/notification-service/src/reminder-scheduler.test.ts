import { describe, expect, it } from 'vitest';
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

class NoopRepository implements ReminderRepository {
  async listDue(): Promise<readonly unknown[]> {
    return [];
  }
  async claim(): Promise<string | null> {
    return 'noop-claim-key';
  }
  async countDelivered(): Promise<number> {
    return 0;
  }
  async markDelivered(): Promise<void> {}
  async defer(): Promise<void> {}
  async fail(): Promise<void> {}
}

class NoopGateway implements ReminderDeliveryGateway {
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

  it.each([
    [{ ...reminder(), id: '1' }, 'invalid_identifier'],
    [{ ...reminder(), title: ' trailing ' }, 'invalid_title'],
    [{ ...reminder(), dueAt: 'tomorrow' }, 'invalid_due_at'],
    [{ ...reminder(), timeZone: 'Mars/Olympus' }, 'invalid_time_zone'],
    [
      {
        ...reminder(),
        quietHours: { startMinute: 60, endMinute: 60 },
      },
      'invalid_quiet_hours',
    ],
    [
      { ...reminder(), maxPerLocalDay: MAX_DAILY_REMINDERS + 1 },
      'invalid_daily_limit',
    ],
    [
      { ...reminder(), deliveryAttempt: MAX_DELIVERY_ATTEMPTS + 1 },
      'invalid_delivery_attempt',
    ],
  ])('rejects malformed records with stable code %s', (value, code) => {
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
  });
});

describe('scheduler options', () => {
  it('rejects unbounded batch sizes', () => {
    expect(
      () => new ReminderScheduler(new NoopRepository(), new NoopGateway(), 0),
    ).toThrow(RangeError);
    expect(
      () => new ReminderScheduler(new NoopRepository(), new NoopGateway(), 101),
    ).toThrow(RangeError);
  });
});
