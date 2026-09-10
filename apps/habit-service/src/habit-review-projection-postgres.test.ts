import { describe, expect, it } from 'vitest';
import type {
  HabitSqlClient,
  HabitSqlQueryResult,
} from './postgres-habit-repository';
import { PostgresHabitRepository } from './postgres-habit-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const HABIT_ID = '22222222-2222-4222-8222-222222222222';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

class RecordingSqlClient implements HabitSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: [...this.rows] as Row[] };
  }
}

describe('Habit Weekly Review PostgreSQL read model', () => {
  it('reads a seven-day projection in one bounded tenant-scoped statement', async () => {
    const client = new RecordingSqlClient([
      {
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
      },
    ]);
    const repository = new PostgresHabitRepository(client);

    const evidence = await repository.readReviewWeekEvidence(
      WORKSPACE_ID,
      '2026-09-07',
      '2026-09-13',
      100,
    );

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual([
      WORKSPACE_ID,
      '2026-09-07',
      '2026-09-13',
      101,
    ]);
    expect(client.calls[0]?.text).toContain('LIMIT $4');
    expect(client.calls[0]?.text).toContain(
      'scheduled_local_date BETWEEN $2::date AND $3::date',
    );
    expect(client.calls[0]?.text).toContain(
      'DISTINCT ON (scheduled_local_date)',
    );
    expect(evidence.habits).toHaveLength(1);
    expect(evidence.completions).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        habitId: HABIT_ID,
        scheduledLocalDate: '2026-09-07',
      },
    ]);
  });

  it('fails closed when the repository is asked for anything except one review week', async () => {
    const repository = new PostgresHabitRepository(new RecordingSqlClient([]));

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-07',
        '2026-09-14',
        100,
      ),
    ).rejects.toThrowError('Habit persistence operation failed');
  });
});
