import { describe, expect, it } from 'vitest';
import {
  InMemoryTodayRepository,
  TodayIdempotencyConflictError,
  TodayRevisionConflictError,
  TodaySyncService,
  TodayValidationError,
} from './today-sync';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DATE = '2026-08-09';
const ACTION_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_ACTION_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const SECOND_IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

function draft(title = 'Ship durable Today') {
  return {
    version: 'life-os.today.v1' as const,
    date: DATE,
    actions: [
      {
        id: ACTION_ID,
        title,
        status: 'open' as const,
        priority: 1 as const,
        startMinute: 9 * 60,
        durationMinutes: 60,
        createdAt: '2026-08-09T00:00:00.000Z',
        completedAt: null,
      },
    ],
  };
}

describe('TodaySyncService', () => {
  it('creates one durable workspace/date aggregate behind an absent precondition', async () => {
    const service = new TodaySyncService(new InMemoryTodayRepository());

    const result = await service.putToday(
      WORKSPACE_ID,
      draft(),
      { kind: 'absent' },
      IDEMPOTENCY_KEY,
    );

    expect(result.kind).toBe('created');
    expect(result.aggregate.aggregateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.aggregate.revision).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.aggregate.date).toBe(DATE);
    expect(result.aggregate.actions).toEqual(draft().actions);
    await expect(service.getToday(WORKSPACE_ID, DATE)).resolves.toEqual(
      result.aggregate,
    );
    await expect(service.getToday(OTHER_WORKSPACE_ID, DATE)).resolves.toBeUndefined();
  });

  it('updates only when the exact opaque revision matches and rotates the token', async () => {
    const service = new TodaySyncService(new InMemoryTodayRepository());
    const created = await service.putToday(
      WORKSPACE_ID,
      draft(),
      { kind: 'absent' },
      IDEMPOTENCY_KEY,
    );

    const updated = await service.putToday(
      WORKSPACE_ID,
      draft('Ship Today across devices'),
      { kind: 'match', revision: created.aggregate.revision },
      SECOND_IDEMPOTENCY_KEY,
    );

    expect(updated.kind).toBe('updated');
    expect(updated.aggregate.aggregateId).toBe(created.aggregate.aggregateId);
    expect(updated.aggregate.revision).not.toBe(created.aggregate.revision);
    expect(updated.aggregate.actions[0]?.title).toBe('Ship Today across devices');
  });

  it('returns only the current opaque revision on stale-write conflicts', async () => {
    const service = new TodaySyncService(new InMemoryTodayRepository());
    const created = await service.putToday(
      WORKSPACE_ID,
      draft(),
      { kind: 'absent' },
      IDEMPOTENCY_KEY,
    );

    await expect(
      service.putToday(
        WORKSPACE_ID,
        draft('Stale overwrite'),
        { kind: 'match', revision: '66666666-6666-4666-8666-666666666666' },
        SECOND_IDEMPOTENCY_KEY,
      ),
    ).rejects.toEqual(new TodayRevisionConflictError(created.aggregate.revision));
  });

  it('replays an exact idempotency key without rotating revision and rejects conflicting reuse', async () => {
    const service = new TodaySyncService(new InMemoryTodayRepository());
    const first = await service.putToday(
      WORKSPACE_ID,
      draft(),
      { kind: 'absent' },
      IDEMPOTENCY_KEY,
    );
    const replay = await service.putToday(
      WORKSPACE_ID,
      draft(),
      { kind: 'absent' },
      IDEMPOTENCY_KEY,
    );

    expect(replay.kind).toBe('replayed');
    expect(replay.aggregate).toEqual(first.aggregate);
    await expect(
      service.putToday(
        WORKSPACE_ID,
        draft('Conflicting replay'),
        { kind: 'absent' },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(TodayIdempotencyConflictError);
  });

  it('rejects invalid priority and schedule state before persistence', async () => {
    const service = new TodaySyncService(new InMemoryTodayRepository());
    const invalid = {
      ...draft(),
      actions: [
        ...draft().actions,
        {
          id: SECOND_ACTION_ID,
          title: 'Overlapping priority',
          status: 'open' as const,
          priority: 1 as const,
          startMinute: 9 * 60 + 30,
          durationMinutes: 60,
          createdAt: '2026-08-09T00:01:00.000Z',
          completedAt: null,
        },
      ],
    };

    await expect(
      service.putToday(
        WORKSPACE_ID,
        invalid,
        { kind: 'absent' },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(TodayValidationError);
  });

  it('requires completed actions to carry completion evidence and UUIDv4 ownership inputs', async () => {
    const service = new TodaySyncService(new InMemoryTodayRepository());
    const invalid = {
      ...draft(),
      actions: [
        {
          ...draft().actions[0],
          status: 'done' as const,
          completedAt: null,
        },
      ],
    };

    await expect(
      service.putToday(
        WORKSPACE_ID,
        invalid,
        { kind: 'absent' },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(TodayValidationError);
    await expect(
      service.putToday(
        '12345',
        draft(),
        { kind: 'absent' },
        IDEMPOTENCY_KEY,
      ),
    ).rejects.toBeInstanceOf(TodayValidationError);
  });
});
