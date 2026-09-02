import { describe, expect, it } from 'vitest';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  ReviewDataRightsContributor,
  ReviewDataRightsError,
  type ReviewDataRightsRequest,
  type ReviewDataRightsSqlClient,
  type ReviewDataRightsSqlQueryResult,
  type ReviewDataRightsTransactionalSqlClient,
} from './review-data-rights';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

interface CompletionRow {
  id: string;
  workspace_id: string;
  ritual_kind: string;
  period_start_date: string;
  idempotency_key: string;
  completed_step_count: number;
  total_step_count: number;
  planned_item_count: number;
  completed_item_count: number;
  habit_completion_count: number;
  reflection_text: string | null;
  completed_at: string;
  payload_digest: string;
  recorded_at: string;
}

function uuid(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, '0')}`;
}

function completion(index: number): CompletionRow {
  const recordedAt = new Date(
    Date.parse('2026-08-12T00:00:00.000Z') + index * 1_000,
  ).toISOString();
  return {
    id: uuid(index),
    workspace_id: WORKSPACE_ID,
    ritual_kind: 'weekly-review',
    period_start_date: '2026-08-12',
    idempotency_key: uuid(index + 10_000),
    completed_step_count: 2,
    total_step_count: 2,
    planned_item_count: 3,
    completed_item_count: 2,
    habit_completion_count: 1,
    reflection_text: `reflection-${index}`,
    completed_at: recordedAt,
    payload_digest: 'a'.repeat(64),
    recorded_at: recordedAt,
  };
}

class PaginationClient implements ReviewDataRightsTransactionalSqlClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];

  constructor(private readonly rows: readonly CompletionRow[]) {}

  async transaction<T>(
    operation: (client: ReviewDataRightsSqlClient) => Promise<T>,
  ): Promise<T> {
    return await operation(this);
  }

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ReviewDataRightsSqlQueryResult<Row>> {
    this.queries.push({ text, values });
    if (text.includes('SET TRANSACTION ISOLATION LEVEL')) {
      return { rows: [] };
    }
    if (!text.includes('FROM guided_review.review_completions')) {
      throw new Error(`Unexpected SQL in pagination fixture: ${text}`);
    }

    if (values.length === 3) {
      const [workspaceId, limit, offset] = values as [string, number, number];
      const page = this.rows
        .filter((row) => row.workspace_id === workspaceId)
        .slice(offset, offset + limit);
      return { rows: page as Row[] };
    }

    const [workspaceId, recordedAt, id, limit] = values as [
      string,
      string | null,
      string | null,
      number,
    ];
    const page = this.rows
      .filter((row) => row.workspace_id === workspaceId)
      .filter((row) => {
        if (recordedAt === null || id === null) return true;
        return (
          row.recorded_at > recordedAt ||
          (row.recorded_at === recordedAt && row.id > id)
        );
      })
      .slice(0, limit);
    return { rows: page as Row[] };
  }
}

function exportRequest(cursor?: string): ReviewDataRightsRequest {
  return {
    contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
    operation: 'export',
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
    ...(cursor === undefined ? {} : { cursor }),
  } as ReviewDataRightsRequest;
}

function exportedIds(data: unknown): string[] {
  const record = data as {
    readonly reviewCompletions: readonly { readonly id: string }[];
  };
  return record.reviewCompletions.map(({ id }) => id);
}

describe('Review data-rights bounded export pagination', () => {
  it('returns at most 1,000 records and resumes with an opaque keyset cursor', async () => {
    const rows = Array.from({ length: 1_002 }, (_, index) => completion(index));
    const client = new PaginationClient(rows);
    const subject = new ReviewDataRightsContributor(client);

    const first = await subject.handle(exportRequest());
    expect(first.operation).toBe('export');
    if (first.operation !== 'export') throw new Error('Expected export response');
    expect(first.recordCount).toBe(1_000);
    expect(exportedIds(first.data)).toEqual(rows.slice(0, 1_000).map(({ id }) => id));
    expect('nextCursor' in first).toBe(true);
    const nextCursor = (first as typeof first & { readonly nextCursor: string })
      .nextCursor;
    expect(nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);

    const second = await subject.handle(exportRequest(nextCursor));
    expect(second.operation).toBe('export');
    if (second.operation !== 'export') throw new Error('Expected export response');
    expect(second.recordCount).toBe(2);
    expect(exportedIds(second.data)).toEqual(rows.slice(1_000).map(({ id }) => id));
    expect('nextCursor' in second).toBe(false);

    const exported = [...exportedIds(first.data), ...exportedIds(second.data)];
    expect(new Set(exported).size).toBe(1_002);
    expect(client.queries.some(({ text }) => text.includes('OFFSET'))).toBe(false);
  });

  it('rejects a malformed cursor before Review persistence is queried', async () => {
    const client = new PaginationClient([]);
    const subject = new ReviewDataRightsContributor(client);

    await expect(subject.handle(exportRequest('not+a+base64url+cursor'))).rejects.toBeInstanceOf(
      ReviewDataRightsError,
    );
    expect(
      client.queries.filter(({ text }) =>
        text.includes('FROM guided_review.review_completions'),
      ),
    ).toEqual([]);
  });
});
