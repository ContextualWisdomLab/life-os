import { describe, expect, it } from 'vitest';
import type {
  HabitSqlClient,
  HabitSqlQueryResult,
} from './postgres-habit-repository';
import { PostgresHabitRepository } from './postgres-habit-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HABIT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_HABIT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AS_OF = '2026-09-13T23:59:59.000Z';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

class RecordingSqlClient implements HabitSqlClient {
  readonly calls: QueryCall[] = [];
  private readonly responses: readonly Record<string, unknown>[][];

  constructor(...responses: readonly Record<string, unknown>[][]) {
    this.responses = [...responses];
  }

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.responses[this.calls.length - 1] ?? [];
    return { rows: [...response] as Row[] };
  }
}

function reviewRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
    ...overrides,
  };
}

function definitionWeekRows(): Record<string, unknown>[] {
  return Array.from({ length: 7 }, (_, offset) => ({
    id: HABIT_ID,
    workspace_id: WORKSPACE_ID,
    title: 'Read deliberately',
    timezone_name: 'Asia/Seoul',
    recurrence_kind: 'daily',
    recurrence_interval: 1,
    weekday_mask: 0,
    starts_on: '2026-09-07',
    created_at: new Date('2026-09-01T00:00:00.000Z'),
    scheduled_local_date: `2026-09-${String(7 + offset).padStart(2, '0')}`,
  }));
}

async function readEvidence(rows: readonly Record<string, unknown>[]) {
  const repository = new PostgresHabitRepository(
    new RecordingSqlClient([...rows], definitionWeekRows()),
  );
  return await repository.readReviewWeekEvidence(
    WORKSPACE_ID,
    '2026-09-07',
    '2026-09-13',
    100,
    AS_OF,
  );
}

describe('Habit Weekly Review PostgreSQL read model', () => {
  it('reads a seven-day projection in bounded tenant-scoped statements', async () => {
    const client = new RecordingSqlClient([reviewRow()], definitionWeekRows());
    const repository = new PostgresHabitRepository(client);

    const evidence = await repository.readReviewWeekEvidence(
      WORKSPACE_ID,
      '2026-09-07',
      '2026-09-13',
      100,
      AS_OF,
    );

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.values).toEqual([
      WORKSPACE_ID,
      '2026-09-07',
      '2026-09-13',
      AS_OF,
      101,
    ]);
    expect(client.calls[0]?.text).toContain('LIMIT $5');
    expect(client.calls[0]?.text).toContain('created_at <= $4::timestamptz');
    expect(client.calls[0]?.text).toContain('recorded_at <= $4::timestamptz');
    expect(client.calls[0]?.text).toContain(
      'scheduled_local_date BETWEEN $2::date AND $3::date',
    );
    expect(client.calls[0]?.text).toContain(
      'DISTINCT ON (scheduled_local_date)',
    );
    expect(client.calls[1]?.values).toEqual(client.calls[0]?.values);
    expect(client.calls[1]?.text).toContain('CROSS JOIN review_days');
    expect(client.calls[1]?.text).toContain('habit.habit_definition_revisions');
    expect(evidence.habits).toHaveLength(1);
    expect(evidence.completions).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        habitId: HABIT_ID,
        scheduledLocalDate: '2026-09-07',
      },
    ]);
    expect(evidence.definitionDays).toHaveLength(7);
  });

  it('retains habits with no completion evidence without fabricating a numerator', async () => {
    const evidence = await readEvidence([
      reviewRow({
        completion_workspace_id: null,
        completion_habit_id: null,
        completion_scheduled_local_date: null,
      }),
    ]);

    expect(evidence.habits).toHaveLength(1);
    expect(evidence.completions).toEqual([]);
    expect(evidence.definitionDays).toHaveLength(7);
  });

  it('fails closed when the repository is asked for anything except one review week', async () => {
    const repository = new PostgresHabitRepository(new RecordingSqlClient([]));

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-07',
        '2026-09-14',
        100,
        AS_OF,
      ),
    ).rejects.toThrowError('Habit persistence operation failed');
  });

  it('fails closed when a seven-day Review persistence period does not start Monday', async () => {
    const repository = new PostgresHabitRepository(new RecordingSqlClient([]));

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-08',
        '2026-09-14',
        100,
        AS_OF,
      ),
    ).rejects.toThrowError('Habit persistence operation failed');
  });

  it('fails closed when the requested habit ceiling is outside the supported bound', async () => {
    const repository = new PostgresHabitRepository(new RecordingSqlClient([]));

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-07',
        '2026-09-13',
        0,
        AS_OF,
      ),
    ).rejects.toThrowError('Habit persistence operation failed');
  });

  it('fails closed when a completion row is only partially populated', async () => {
    await expect(
      readEvidence([
        reviewRow({
          completion_workspace_id: null,
        }),
      ]),
    ).rejects.toThrowError('Habit persistence operation failed');
  });

  it('fails closed when completion evidence crosses the workspace boundary', async () => {
    await expect(
      readEvidence([
        reviewRow({
          completion_workspace_id: OTHER_WORKSPACE_ID,
        }),
      ]),
    ).rejects.toThrowError('Habit persistence operation failed');
  });

  it('fails closed when completion evidence names a different habit', async () => {
    await expect(
      readEvidence([
        reviewRow({
          completion_habit_id: OTHER_HABIT_ID,
        }),
      ]),
    ).rejects.toThrowError('Habit persistence operation failed');
  });

  it('fails closed when returned completion evidence escapes the requested period', async () => {
    await expect(
      readEvidence([
        reviewRow({
          completion_scheduled_local_date: '2026-09-14',
        }),
      ]),
    ).rejects.toThrowError('Habit persistence operation failed');
  });

  it('fails closed when repeated rows disagree about the same habit definition', async () => {
    await expect(
      readEvidence([
        reviewRow({
          completion_workspace_id: null,
          completion_habit_id: null,
          completion_scheduled_local_date: null,
        }),
        reviewRow({
          title: 'Conflicting title',
          completion_workspace_id: null,
          completion_habit_id: null,
          completion_scheduled_local_date: null,
        }),
      ]),
    ).rejects.toThrowError('Habit persistence operation failed');
  });

  it('fails closed when a sentinel habit proves the requested ceiling was exceeded', async () => {
    const rows = Array.from({ length: 101 }, (_, index) =>
      reviewRow({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        completion_workspace_id: null,
        completion_habit_id: null,
        completion_scheduled_local_date: null,
      }),
    );

    await expect(readEvidence(rows)).rejects.toThrowError(
      'Habit persistence operation failed',
    );
  });

  it('fails closed when the adapter returns more rows than the bounded weekly cardinality permits', async () => {
    const rows = Array.from({ length: 708 }, () => reviewRow());

    await expect(readEvidence(rows)).rejects.toThrowError(
      'Habit persistence operation failed',
    );
  });
});
