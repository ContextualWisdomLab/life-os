import { describe, expect, it } from 'vitest';
import type { Habit, HabitCompletionEvent } from './habit-domain';
import {
  HabitIdempotencyConflictError,
  HabitPersistenceError,
  type HabitSqlClient,
  type HabitSqlQueryResult,
  PostgresHabitRepository,
} from './postgres-habit-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HABIT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HABIT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPLETION_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-08-04T00:00:00.000Z';
const COMPLETED_AT = '2026-08-04T08:00:00.000Z';
const RECORDED_AT = '2026-08-04T08:00:01.000Z';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

interface ErrorResponse {
  error: unknown;
}

type QueryResponse = unknown[] | ErrorResponse;

class RecordingSqlClient implements HabitSqlClient {
  readonly calls: QueryCall[] = [];
  private readonly responses: QueryResponse[];

  constructor(...responses: QueryResponse[]) {
    this.responses = [...responses];
  }

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.responses.shift() ?? [];
    if (!Array.isArray(response)) {
      throw response.error;
    }
    return { rows: response as Row[] };
  }
}

function weeklyHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: HABIT_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Review weekly priorities',
    timezone: 'Asia/Seoul',
    startsOn: '2026-08-04',
    recurrence: { kind: 'weekly', interval: 2, weekdays: [1, 3, 7] },
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function completion(
  overrides: Partial<HabitCompletionEvent> = {},
): HabitCompletionEvent {
  return {
    id: COMPLETION_ID,
    workspaceId: WORKSPACE_ID,
    habitId: HABIT_ID,
    scheduledLocalDate: '2026-08-04',
    completedAt: COMPLETED_AT,
    idempotencyKey: IDEMPOTENCY_KEY,
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

function habitRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: HABIT_ID,
    workspace_id: WORKSPACE_ID,
    title: 'Review weekly priorities',
    timezone_name: 'Asia/Seoul',
    recurrence_kind: 'weekly',
    recurrence_interval: 2,
    weekday_mask: 69,
    starts_on: '2026-08-04',
    created_at: new Date(CREATED_AT),
    ...overrides,
  };
}

function completionRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: COMPLETION_ID,
    workspace_id: WORKSPACE_ID,
    habit_id: HABIT_ID,
    scheduled_local_date: '2026-08-04',
    completed_at: new Date(COMPLETED_AT),
    idempotency_key: IDEMPOTENCY_KEY,
    recorded_at: RECORDED_AT,
    ...overrides,
  };
}

describe('PostgresHabitRepository', () => {
  it('binds habit values and encodes normalized ISO weekdays', async () => {
    const client = new RecordingSqlClient([]);
    const repository = new PostgresHabitRepository(client);
    const habit = weeklyHabit();

    await repository.saveHabit(habit);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    );
    expect(client.calls[0]?.text).not.toContain(habit.title);
    expect(client.calls[0]?.values).toEqual([
      HABIT_ID,
      WORKSPACE_ID,
      habit.title,
      'Asia/Seoul',
      'weekly',
      2,
      69,
      '2026-08-04',
      CREATED_AT,
    ]);
  });

  it('decodes recurrence rows and uses deterministic tenant-scoped reads', async () => {
    const client = new RecordingSqlClient([habitRow()], [habitRow()]);
    const repository = new PostgresHabitRepository(client);

    await expect(repository.findHabit(WORKSPACE_ID, HABIT_ID)).resolves.toEqual(
      weeklyHabit(),
    );
    await expect(repository.listHabits(WORKSPACE_ID)).resolves.toEqual([
      weeklyHabit(),
    ]);

    expect(client.calls[0]?.text).toContain(
      'WHERE workspace_id = $1 AND id = $2',
    );
    expect(client.calls[0]?.text).toContain('LIMIT 2');
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, HABIT_ID]);
    expect(client.calls[1]?.text).toContain('ORDER BY created_at ASC, id ASC');
    expect(client.calls[1]?.values).toEqual([WORKSPACE_ID]);
  });

  it('fails closed on malformed recurrence and cross-tenant rows', async () => {
    const malformedClient = new RecordingSqlClient([
      habitRow({ recurrence_kind: 'daily', weekday_mask: 1 }),
    ]);
    const crossTenantClient = new RecordingSqlClient([
      habitRow({ workspace_id: OTHER_WORKSPACE_ID }),
    ]);

    await expect(
      new PostgresHabitRepository(malformedClient).listHabits(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(HabitPersistenceError);
    await expect(
      new PostgresHabitRepository(crossTenantClient).findHabit(
        WORKSPACE_ID,
        HABIT_ID,
      ),
    ).rejects.toBeInstanceOf(HabitPersistenceError);
  });

  it('rejects malformed identifiers before querying PostgreSQL', async () => {
    const client = new RecordingSqlClient();
    const repository = new PostgresHabitRepository(client);

    await expect(
      repository.findHabit('workspace-a', HABIT_ID),
    ).rejects.toBeInstanceOf(HabitPersistenceError);
    await expect(
      repository.saveHabit(weeklyHabit({ id: 'not-a-uuid' })),
    ).rejects.toBeInstanceOf(HabitPersistenceError);
    expect(client.calls).toEqual([]);
  });

  it('returns undefined only for an empty tenant-scoped lookup', async () => {
    const client = new RecordingSqlClient([]);
    const repository = new PostgresHabitRepository(client);

    await expect(
      repository.findHabit(WORKSPACE_ID, HABIT_ID),
    ).resolves.toBeUndefined();
  });

  it('fails closed on unexpected or duplicate lookup rows', async () => {
    const unexpectedClient = new RecordingSqlClient([
      habitRow({ id: OTHER_HABIT_ID }),
    ]);
    const duplicateClient = new RecordingSqlClient([habitRow(), habitRow()]);

    await expect(
      new PostgresHabitRepository(unexpectedClient).findHabit(
        WORKSPACE_ID,
        HABIT_ID,
      ),
    ).rejects.toBeInstanceOf(HabitPersistenceError);
    await expect(
      new PostgresHabitRepository(duplicateClient).findHabit(
        WORKSPACE_ID,
        HABIT_ID,
      ),
    ).rejects.toBeInstanceOf(HabitPersistenceError);
  });

  it('inserts and parses a new append-only completion event', async () => {
    const client = new RecordingSqlClient([completionRow()]);
    const repository = new PostgresHabitRepository(client);
    const event = completion();

    await expect(repository.appendCompletion(event)).resolves.toEqual(event);
    expect(client.calls[0]?.text).toContain(
      'INSERT INTO habit.completion_events',
    );
    expect(client.calls[0]?.text).toContain('RETURNING id, workspace_id');
    expect(client.calls[0]?.values).toEqual([
      COMPLETION_ID,
      WORKSPACE_ID,
      HABIT_ID,
      '2026-08-04',
      COMPLETED_AT,
      IDEMPOTENCY_KEY,
      RECORDED_AT,
    ]);
  });

  it('returns the original event after an exact idempotency replay', async () => {
    const uniqueViolation = {
      code: '23505',
      constraint: 'completion_events_idempotency_unique',
    };
    const client = new RecordingSqlClient({ error: uniqueViolation }, [
      completionRow(),
    ]);
    const repository = new PostgresHabitRepository(client);

    await expect(repository.appendCompletion(completion())).resolves.toEqual(
      completion(),
    );
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.text).toContain('idempotency_key = $3');
    expect(client.calls[1]?.text).toContain('LIMIT 2');
    expect(client.calls[1]?.values).toEqual([
      WORKSPACE_ID,
      HABIT_ID,
      IDEMPOTENCY_KEY,
    ]);
  });

  it('rejects an idempotency replay whose persisted payload differs', async () => {
    const client = new RecordingSqlClient(
      {
        error: {
          code: '23505',
          constraint: 'completion_events_idempotency_unique',
        },
      },
      [completionRow({ completed_at: '2026-08-04T09:00:00.000Z' })],
    );
    const repository = new PostgresHabitRepository(client);

    await expect(
      repository.appendCompletion(completion()),
    ).rejects.toBeInstanceOf(HabitIdempotencyConflictError);
  });

  it('converts unrelated database failures into a safe persistence error', async () => {
    const unrelatedViolation = {
      code: '23505',
      constraint: 'completion_events_pkey',
    };
    const client = new RecordingSqlClient({ error: unrelatedViolation });
    const repository = new PostgresHabitRepository(client);

    await expect(
      repository.appendCompletion(completion()),
    ).rejects.toBeInstanceOf(HabitPersistenceError);
    expect(client.calls).toHaveLength(1);
  });

  it('lists completion history with tenant predicates and indexed ordering', async () => {
    const client = new RecordingSqlClient([completionRow()]);
    const repository = new PostgresHabitRepository(client);

    await expect(
      repository.listCompletions(WORKSPACE_ID, HABIT_ID),
    ).resolves.toEqual([completion()]);
    expect(client.calls[0]?.text).toContain(
      'WHERE workspace_id = $1 AND habit_id = $2',
    );
    expect(client.calls[0]?.text).toContain('ORDER BY recorded_at ASC, id ASC');
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, HABIT_ID]);
  });
});
