import { describe, expect, it } from 'vitest';
import {
  HabitPersistenceError,
  PostgresHabitRepository,
  type HabitSqlClient,
  type HabitSqlQueryResult,
} from './postgres-habit-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const HABIT_ID = '22222222-2222-4222-8222-222222222222';
const AS_OF = '2026-09-13T23:59:59.000Z';

function revokedProxy<T extends object>(value: T): T {
  const { proxy, revoke } = Proxy.revocable(value, {});
  revoke();
  return proxy;
}

function reviewRow(): Record<string, unknown> {
  return {
    id: HABIT_ID,
    workspace_id: WORKSPACE_ID,
    title: 'Read deliberately',
    timezone_name: 'Asia/Seoul',
    recurrence_kind: 'daily',
    recurrence_interval: 1,
    weekday_mask: 0,
    starts_on: '2026-09-07',
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    completion_workspace_id: WORKSPACE_ID,
    completion_habit_id: HABIT_ID,
    completion_scheduled_local_date: '2026-09-07',
  };
}

async function expectCredentialFreePersistenceFailure(
  client: HabitSqlClient,
): Promise<void> {
  const repository = new PostgresHabitRepository(client);
  const error = await repository
    .readReviewWeekEvidence(
      WORKSPACE_ID,
      '2026-09-07',
      '2026-09-13',
      100,
      AS_OF,
    )
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(HabitPersistenceError);
  expect(error).toMatchObject({ message: 'Habit persistence operation failed' });
}

describe('Habit Weekly Review hostile PostgreSQL evidence', () => {
  it('collapses a revoked query-result envelope before reading rows', async () => {
    const result = revokedProxy({ rows: [reviewRow()] });
    const client: HabitSqlClient = {
      async query<Row>(): Promise<HabitSqlQueryResult<Row>> {
        return result as HabitSqlQueryResult<Row>;
      },
    };

    await expectCredentialFreePersistenceFailure(client);
  });

  it('collapses a revoked row collection before reading cardinality', async () => {
    const rows = revokedProxy([reviewRow()]);
    const client: HabitSqlClient = {
      async query<Row>(): Promise<HabitSqlQueryResult<Row>> {
        return { rows: rows as Row[] };
      },
    };

    await expectCredentialFreePersistenceFailure(client);
  });

  it('collapses a revoked durable row before reading Habit authority fields', async () => {
    const row = revokedProxy(reviewRow());
    const client: HabitSqlClient = {
      async query<Row>(): Promise<HabitSqlQueryResult<Row>> {
        return { rows: [row as Row] };
      },
    };

    await expectCredentialFreePersistenceFailure(client);
  });
});
