import { describe, expect, it } from 'vitest';
import {
  PostgresReviewRepository,
  ReviewPersistenceError,
  type ReviewSqlClient,
  type ReviewSqlQueryResult,
} from './postgres-review-repository';
import {
  parseReviewCompletionInput,
  ReviewCompletionConflictError,
  type ReviewCompletionRecord,
} from './review-domain';

const WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const IDEMPOTENCY_KEY = 'd1191b96-b7f4-4d8f-b1f7-9e2838686d5f';
const SECOND_IDEMPOTENCY_KEY = '87c815d4-64fa-46ec-8994-52e8aa9e66e9';
const COMPLETION_ID = '3f044b68-c515-4a52-8862-38af0047b88d';
const RECORDED_AT = '2026-08-03T20:00:01.000Z';

function record(
  overrides: Record<string, unknown> = {},
): ReviewCompletionRecord {
  const input = parseReviewCompletionInput(WORKSPACE_ID, 'weekly-review', {
    periodStartDate: '2026-08-03',
    idempotencyKey: IDEMPOTENCY_KEY,
    completedStepCount: 5,
    totalStepCount: 5,
    plannedItemCount: 4,
    completedItemCount: 3,
    habitCompletionCount: 2,
    reflection: 'Evidence is bounded.',
    completedAt: '2026-08-03T20:00:00.000Z',
    ...overrides,
  });
  return { ...input, id: COMPLETION_ID, recordedAt: RECORDED_AT };
}

function row(value: ReviewCompletionRecord) {
  return {
    id: value.id,
    workspace_id: value.workspaceId,
    ritual_kind: value.ritualKind,
    period_start_date: value.periodStartDate,
    idempotency_key: value.idempotencyKey,
    completed_step_count: value.completedStepCount,
    total_step_count: value.totalStepCount,
    planned_item_count: value.plannedItemCount,
    completed_item_count: value.completedItemCount,
    habit_completion_count: value.habitCompletionCount,
    reflection_text: value.reflection ?? null,
    completed_at: new Date(value.completedAt),
    payload_digest: value.payloadDigest,
    recorded_at: new Date(value.recordedAt),
  };
}

interface RecordedQuery {
  text: string;
  values: readonly unknown[];
}

class SequentialClient implements ReviewSqlClient {
  readonly calls: RecordedQuery[] = [];
  private readonly queued: Array<ReviewSqlQueryResult<unknown> | Error> = [];

  enqueueRows(rows: unknown[]): void {
    this.queued.push({ rows });
  }

  enqueueError(error: Error): void {
    this.queued.push(error);
  }

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ReviewSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const next = this.queued.shift();
    if (next === undefined) {
      throw new Error('No queued SQL result');
    }
    if (next instanceof Error) throw next;
    return { rows: next.rows as Row[] };
  }
}

function firstCall(client: SequentialClient): RecordedQuery {
  const call = client.calls[0];
  if (call === undefined) throw new Error('Expected one SQL call');
  return call;
}

describe('PostgreSQL guided review repository', () => {
  it('uses parameterized SQL and returns validated inserted evidence', async () => {
    const completion = record();
    const client = new SequentialClient();
    client.enqueueRows([row(completion)]);
    const repository = new PostgresReviewRepository(client);

    await expect(repository.record(completion)).resolves.toEqual(completion);
    expect(client.calls).toHaveLength(1);
    const { text, values } = firstCall(client);
    expect(text).toContain('VALUES\n        ($1, $2, $3');
    expect(text).not.toContain(WORKSPACE_ID);
    expect(values).toContain(WORKSPACE_ID);
  });

  it('returns exact immutable replays after a uniqueness conflict', async () => {
    const attempted = record();
    const persisted = {
      ...attempted,
      id: '8073d09a-c36b-42f5-a8c8-2b42ea82d61c',
    };
    const client = new SequentialClient();
    client.enqueueRows([]);
    client.enqueueRows([row(persisted)]);
    const repository = new PostgresReviewRepository(client);

    await expect(repository.record(attempted)).resolves.toEqual(persisted);
    expect(client.calls).toHaveLength(2);
  });

  it('rejects conflicting idempotency or period reuse', async () => {
    const attempted = record();
    const conflict = record({
      completedItemCount: 2,
      completedAt: '2026-08-03T20:05:00.000Z',
    });
    const client = new SequentialClient();
    client.enqueueRows([]);
    client.enqueueRows([row(conflict)]);
    const repository = new PostgresReviewRepository(client);

    await expect(repository.record(attempted)).rejects.toBeInstanceOf(
      ReviewCompletionConflictError,
    );
  });

  it('classifies simultaneous key and period collisions as a conflict', async () => {
    const attempted = record();
    const keyConflict = {
      ...record({ periodStartDate: '2026-08-10' }),
      id: '8073d09a-c36b-42f5-a8c8-2b42ea82d61c',
    };
    const periodConflict = {
      ...record({ idempotencyKey: SECOND_IDEMPOTENCY_KEY }),
      id: '5a15ccb3-4084-4f1a-a98a-b651e3294944',
    };
    const client = new SequentialClient();
    client.enqueueRows([]);
    client.enqueueRows([row(keyConflict), row(periodConflict)]);
    const repository = new PostgresReviewRepository(client);

    await expect(repository.record(attempted)).rejects.toBeInstanceOf(
      ReviewCompletionConflictError,
    );
  });

  it('lists only parameterized tenant history with a bounded limit', async () => {
    const completion = record();
    const client = new SequentialClient();
    client.enqueueRows([row(completion)]);
    const repository = new PostgresReviewRepository(client);

    await expect(repository.list(WORKSPACE_ID, 25)).resolves.toEqual([
      completion,
    ]);
    expect(firstCall(client)).toEqual({
      text: expect.stringContaining('WHERE workspace_id = $1'),
      values: [WORKSPACE_ID, 25],
    });
  });

  it('fails closed for malformed rows, impossible limits, and SQL failures', async () => {
    const completion = record();
    const malformedClient = new SequentialClient();
    malformedClient.enqueueRows([
      { ...row(completion), payload_digest: 'tampered' },
    ]);
    await expect(
      new PostgresReviewRepository(malformedClient).list(WORKSPACE_ID, 25),
    ).rejects.toBeInstanceOf(ReviewPersistenceError);

    const unusedClient = new SequentialClient();
    await expect(
      new PostgresReviewRepository(unusedClient).list(WORKSPACE_ID, 0),
    ).rejects.toBeInstanceOf(ReviewPersistenceError);
    expect(unusedClient.calls).toHaveLength(0);

    const failingClient = new SequentialClient();
    failingClient.enqueueError(new Error('secret database host'));
    await expect(
      new PostgresReviewRepository(failingClient).record(completion),
    ).rejects.toEqual(new ReviewPersistenceError());
  });
});
