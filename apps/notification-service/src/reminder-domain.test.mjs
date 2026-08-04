import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createReminder,
  findNextPolicyInstant,
  isQuietMinute,
  normalizeUuidV4,
  parseQuietHours,
  projectInstant,
  ReminderValidationError,
  retryDelayMilliseconds,
} from './reminder-domain.mjs';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REMINDER_ID = '22222222-2222-4222-8222-222222222222';

function validReminderInput(overrides = {}) {
  return {
    id: REMINDER_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Prepare the release evidence',
    dueAt: '2026-08-04T09:00:00+09:00',
    timezone: 'Asia/Seoul',
    quietHours: { start: '22:00', end: '07:00' },
    maxDeliveriesPerLocalDay: 3,
    maxAttempts: 3,
    createdAt: '2026-08-03T20:00:00Z',
    ...overrides,
  };
}

describe('reminder validation', () => {
  it('creates one immutable canonical reminder', () => {
    const reminder = createReminder(validReminderInput());

    assert.deepEqual(reminder, {
      id: REMINDER_ID,
      workspaceId: WORKSPACE_ID,
      title: 'Prepare the release evidence',
      dueAt: '2026-08-04T00:00:00.000Z',
      timezone: 'Asia/Seoul',
      quietHours: { startMinute: 1320, endMinute: 420 },
      maxDeliveriesPerLocalDay: 3,
      maxAttempts: 3,
      createdAt: '2026-08-03T20:00:00.000Z',
      status: 'pending',
      attemptCount: 0,
      nextEligibleAt: '2026-08-04T00:00:00.000Z',
    });
    assert.equal(Object.isFrozen(reminder), true);
    assert.equal(Object.isFrozen(reminder.quietHours), true);
  });

  it('applies bounded defaults without inventing quiet hours', () => {
    const reminder = createReminder(
      validReminderInput({
        quietHours: undefined,
        maxDeliveriesPerLocalDay: undefined,
        maxAttempts: undefined,
      }),
    );

    assert.equal(reminder.quietHours, null);
    assert.equal(reminder.maxDeliveriesPerLocalDay, 3);
    assert.equal(reminder.maxAttempts, 3);
  });

  it('normalizes only UUIDv4 identifiers', () => {
    assert.equal(
      normalizeUuidV4('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );

    for (const value of [
      '',
      '123456',
      '11111111-1111-1111-8111-111111111111',
      '11111111-1111-4111-7111-111111111111',
      'not-a-uuid',
      null,
    ]) {
      assert.throws(() => normalizeUuidV4(value), ReminderValidationError);
    }
  });

  it('rejects malformed, unbounded, or ambiguous reminder fields', () => {
    const invalidInputs = [
      { id: '123' },
      { workspaceId: '123' },
      { title: '' },
      { title: 'line\nbreak' },
      { title: 'x'.repeat(161) },
      { dueAt: '2026-08-04' },
      { dueAt: 'not-a-time' },
      { timezone: '' },
      { timezone: 'UTC+09:00' },
      { quietHours: { start: '22:00', end: '22:00' } },
      { quietHours: { start: '24:00', end: '07:00' } },
      { quietHours: { start: '22:00', end: '7:00' } },
      { maxDeliveriesPerLocalDay: 0 },
      { maxDeliveriesPerLocalDay: 11 },
      { maxDeliveriesPerLocalDay: 1.5 },
      { maxAttempts: 0 },
      { maxAttempts: 6 },
      { createdAt: '2026-08-03' },
    ];

    for (const overrides of invalidInputs) {
      assert.throws(
        () => createReminder(validReminderInput(overrides)),
        ReminderValidationError,
      );
    }
  });
});

describe('time-zone policy projection', () => {
  it('projects actual instants across a spring-forward gap', () => {
    assert.deepEqual(
      projectInstant('2026-03-08T06:59:00Z', 'America/New_York'),
      { localDate: '2026-03-08', minuteOfDay: 119 },
    );
    assert.deepEqual(
      projectInstant('2026-03-08T07:00:00Z', 'America/New_York'),
      { localDate: '2026-03-08', minuteOfDay: 180 },
    );
  });

  it('projects repeated fall-back wall-clock minutes deterministically', () => {
    assert.deepEqual(
      projectInstant('2026-11-01T05:30:00Z', 'America/New_York'),
      { localDate: '2026-11-01', minuteOfDay: 90 },
    );
    assert.deepEqual(
      projectInstant('2026-11-01T06:30:00Z', 'America/New_York'),
      { localDate: '2026-11-01', minuteOfDay: 90 },
    );
  });

  it('evaluates same-day and overnight quiet-hour intervals', () => {
    const daytime = parseQuietHours({ start: '12:00', end: '13:30' });
    assert.equal(isQuietMinute(719, daytime), false);
    assert.equal(isQuietMinute(720, daytime), true);
    assert.equal(isQuietMinute(809, daytime), true);
    assert.equal(isQuietMinute(810, daytime), false);

    const overnight = parseQuietHours({ start: '22:00', end: '07:00' });
    assert.equal(isQuietMinute(1319, overnight), false);
    assert.equal(isQuietMinute(1320, overnight), true);
    assert.equal(isQuietMinute(0, overnight), true);
    assert.equal(isQuietMinute(419, overnight), true);
    assert.equal(isQuietMinute(420, overnight), false);
    assert.equal(isQuietMinute(900, null), false);
  });

  it('finds the first real instant outside quiet hours through DST changes', () => {
    assert.equal(
      findNextPolicyInstant({
        after: '2026-03-08T06:59:00Z',
        timezone: 'America/New_York',
        quietHours: parseQuietHours({ start: '01:30', end: '03:30' }),
      }),
      '2026-03-08T07:30:00.000Z',
    );
    assert.equal(
      findNextPolicyInstant({
        after: '2026-11-01T05:30:00Z',
        timezone: 'America/New_York',
        quietHours: parseQuietHours({ start: '01:00', end: '02:00' }),
      }),
      '2026-11-01T07:00:00.000Z',
    );
  });

  it('finds the first eligible instant on the next local date', () => {
    assert.equal(
      findNextPolicyInstant({
        after: '2026-08-04T12:00:00Z',
        timezone: 'Asia/Seoul',
        quietHours: parseQuietHours({ start: '22:00', end: '07:00' }),
        minimumLocalDateExclusive: '2026-08-04',
      }),
      '2026-08-04T22:00:00.000Z',
    );
  });

  it('rejects invalid instants, zones, minutes, and policy search input', () => {
    for (const operation of [
      () => projectInstant('not-a-time', 'UTC'),
      () => projectInstant('2026-08-04T00:00:00Z', 'UTC+9'),
      () => isQuietMinute(-1, parseQuietHours({ start: '12:00', end: '13:00' })),
      () => isQuietMinute(1440, parseQuietHours({ start: '12:00', end: '13:00' })),
      () =>
        findNextPolicyInstant({
          after: 'invalid',
          timezone: 'UTC',
          quietHours: null,
        }),
      () =>
        findNextPolicyInstant({
          after: '2026-08-04T00:00:00Z',
          timezone: 'UTC',
          quietHours: null,
          minimumLocalDateExclusive: '08/04/2026',
        }),
    ]) {
      assert.throws(operation, ReminderValidationError);
    }
  });
});

describe('bounded transport retries', () => {
  it('uses fixed bounded delays for every supported attempt', () => {
    assert.equal(retryDelayMilliseconds(1), 60_000);
    assert.equal(retryDelayMilliseconds(2), 300_000);
    assert.equal(retryDelayMilliseconds(3), 900_000);
    assert.equal(retryDelayMilliseconds(4), 3_600_000);
    assert.equal(retryDelayMilliseconds(5), 3_600_000);
  });

  it('rejects attempts outside the supported range', () => {
    for (const attempt of [0, 6, 1.5, Number.NaN]) {
      assert.throws(
        () => retryDelayMilliseconds(attempt),
        ReminderValidationError,
      );
    }
  });
});
