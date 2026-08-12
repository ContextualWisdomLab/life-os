import { describe, expect, it } from 'vitest';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  ReviewDataRightsContributor,
  ReviewDataRightsError,
  type ReviewDataRightsSqlClient,
  type ReviewDataRightsSqlQueryResult,
  type ReviewDataRightsTransactionalSqlClient,
} from './review-data-rights';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

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

interface ReceiptRow {
  idempotency_key: string;
  workspace_id: string;
  requested_by_user_id: string;
  request_id: string;
  erased_records: number;
  receipt_sha256: string;
}

function completion(
  workspaceId: string,
  id: string,
  recordedAt: string,
  reflection: string | null,
): CompletionRow {
  return {
    id,
    workspace_id: workspaceId,
    ritual_kind: 'daily-planning',
    period_start_date: '2026-08-12',
    idempotency_key: id,
    completed_step_count: 2,
    total_step_count: 2,
    planned_item_count: 3,
    completed_item_count: 2,
    habit_completion_count: 1,
    reflection_text: reflection,
    completed_at: '2026-08-12T00:30:00.000Z',
    payload_digest: 'a'.repeat(64),
    recorded_at: recordedAt,
  };
}

class FakeReviewDataRightsClient implements ReviewDataRightsTransactionalSqlClient {
  readonly queries: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly receipts = new Map<string, ReceiptRow>();
  privilegesReady = true;
  returnCrossTenantRows = false;

  constructor(readonly completions: CompletionRow[]) {}

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
    if (text.includes('has_table_privilege')) {
      return {
        rows: [
          {
            completions_ready: this.privilegesReady,
            receipts_ready: this.privilegesReady,
          } as Row,
        ],
      };
    }
    if (text.includes('pg_advisory_xact_lock')) {
      return { rows: [] };
    }
    if (
      text.includes('FROM guided_review.review_completions') &&
      text.includes('ORDER BY recorded_at ASC, id ASC')
    ) {
      const [workspaceId, limit, offset] = values as [string, number, number];
      const rows = this.completions
        .filter(
          (row) =>
            this.returnCrossTenantRows || row.workspace_id === workspaceId,
        )
        .sort((left, right) =>
          `${left.recorded_at}:${left.id}`.localeCompare(
            `${right.recorded_at}:${right.id}`,
          ),
        )
        .slice(offset, offset + limit);
      return { rows: rows as Row[] };
    }
    if (text.includes('FROM guided_review.data_rights_erasure_receipt')) {
      const idempotencyKey = String(values[0]);
      const receipt = this.receipts.get(idempotencyKey);
      return { rows: receipt ? ([receipt] as Row[]) : [] };
    }
    if (text.startsWith('DELETE FROM guided_review.review_completions')) {
      const workspaceId = String(values[0]);
      const deleted = this.completions.filter(
        (row) => row.workspace_id === workspaceId,
      );
      for (const row of deleted) {
        this.completions.splice(this.completions.indexOf(row), 1);
      }
      return { rows: deleted.map(({ id }) => ({ id }) as Row) };
    }
    if (
      text.startsWith('INSERT INTO guided_review.data_rights_erasure_receipt')
    ) {
      const [
        idempotencyKey,
        workspaceId,
        requestedByUserId,
        requestId,
        erasedRecords,
        receiptSha256,
      ] = values;
      this.receipts.set(String(idempotencyKey), {
        idempotency_key: String(idempotencyKey),
        workspace_id: String(workspaceId),
        requested_by_user_id: String(requestedByUserId),
        request_id: String(requestId),
        erased_records: Number(erasedRecords),
        receipt_sha256: String(receiptSha256),
      });
      return { rows: [] };
    }
    if (text.startsWith('SELECT COUNT(*) AS record_count')) {
      const workspaceId = String(values[0]);
      const count = this.completions.filter(
        (row) => row.workspace_id === workspaceId,
      ).length;
      return { rows: [{ record_count: count } as Row] };
    }
    throw new Error(`Unexpected SQL in test fixture: ${text}`);
  }
}

function contributor(client: FakeReviewDataRightsClient) {
  return new ReviewDataRightsContributor(client);
}

function baseRequest(
  operation: 'export' | 'erase_preflight' | 'verify_erased',
) {
  return {
    contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
    operation,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
  } as const;
}

describe('ReviewDataRightsContributor', () => {
  it('exports only the requested workspace in deterministic order with digest evidence', async () => {
    const firstId = '66666666-6666-4666-8666-666666666666';
    const secondId = '77777777-7777-4777-8777-777777777777';
    const privateId = '88888888-8888-4888-8888-888888888888';
    const client = new FakeReviewDataRightsClient([
      completion(WORKSPACE_ID, secondId, '2026-08-12T02:00:00.000Z', null),
      completion(
        OTHER_WORKSPACE_ID,
        privateId,
        '2026-08-12T00:00:00.000Z',
        'private',
      ),
      completion(WORKSPACE_ID, firstId, '2026-08-12T01:00:00.000Z', 'portable'),
    ]);

    const first = await contributor(client).handle(baseRequest('export'));
    const second = await contributor(client).handle({
      ...baseRequest('export'),
      requestId: '99999999-9999-4999-8999-999999999999',
    });

    expect(first.operation).toBe('export');
    if (first.operation !== 'export' || second.operation !== 'export') {
      throw new Error('Expected Review export responses');
    }
    expect(first).toMatchObject({
      contributor: 'review.service',
      schemaVersion: 'review.data-rights.v1',
      recordCount: 2,
    });
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.data).toEqual(second.data);
    expect(first.sha256).toBe(second.sha256);
    expect(JSON.stringify(first.data)).toContain(firstId);
    expect(JSON.stringify(first.data)).toContain(secondId);
    expect(JSON.stringify(first.data)).toContain('portable');
    expect(JSON.stringify(first.data)).not.toContain(privateId);
    expect(JSON.stringify(first.data)).not.toContain('private');
  });

  it('fails closed if persistence returns a completion from another workspace', async () => {
    const client = new FakeReviewDataRightsClient([
      completion(
        OTHER_WORKSPACE_ID,
        '99999999-9999-4999-8999-999999999999',
        '2026-08-12T00:00:00.000Z',
        'private',
      ),
    ]);
    client.returnCrossTenantRows = true;

    await expect(
      contributor(client).handle(baseRequest('export')),
    ).rejects.toBeInstanceOf(ReviewDataRightsError);
  });

  it('preflights destructive authority without treating missing privileges as success', async () => {
    const client = new FakeReviewDataRightsClient([]);
    const ready = await contributor(client).handle(
      baseRequest('erase_preflight'),
    );
    expect(ready).toMatchObject({
      operation: 'erase_preflight',
      ready: true,
      blockers: [],
    });

    client.privilegesReady = false;
    const blocked = await contributor(client).handle({
      ...baseRequest('erase_preflight'),
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(blocked).toMatchObject({
      operation: 'erase_preflight',
      ready: false,
    });
    if (blocked.operation !== 'erase_preflight') {
      throw new Error('Expected Review erase preflight response');
    }
    expect(blocked.blockers.length).toBeGreaterThan(0);
  });

  it('erases one tenant, replays exact authority, rejects conflicting reuse, and verifies erasure', async () => {
    const ownedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const privateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const client = new FakeReviewDataRightsClient([
      completion(WORKSPACE_ID, ownedId, '2026-08-12T01:00:00.000Z', null),
      completion(
        OTHER_WORKSPACE_ID,
        privateId,
        '2026-08-12T01:00:00.000Z',
        null,
      ),
    ]);
    const subject = contributor(client);
    const eraseRequest = {
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'erase' as const,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const first = await subject.handle(eraseRequest);
    const replay = await subject.handle(eraseRequest);
    expect(first).toMatchObject({ operation: 'erase', erasedRecords: 1 });
    expect(replay).toEqual(first);
    expect(client.completions.map(({ id }) => id)).toEqual([privateId]);

    await expect(
      subject.handle({
        ...eraseRequest,
        requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    ).rejects.toBeInstanceOf(ReviewDataRightsError);

    const verification = await subject.handle({
      ...baseRequest('verify_erased'),
      requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    });
    expect(verification).toMatchObject({
      operation: 'verify_erased',
      erased: true,
    });
    if (verification.operation !== 'verify_erased') {
      throw new Error('Expected Review erasure verification response');
    }
    expect(verification.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed on malformed authority before touching persistence', async () => {
    const client = new FakeReviewDataRightsClient([]);
    await expect(
      contributor(client).handle({
        ...baseRequest('export'),
        workspaceId: 'not-a-workspace',
      }),
    ).rejects.toBeInstanceOf(ReviewDataRightsError);
    expect(client.queries).toEqual([]);
  });

  it('fails closed when persisted export evidence is malformed', async () => {
    const client = new FakeReviewDataRightsClient([
      {
        ...completion(
          WORKSPACE_ID,
          'ffffffff-ffff-4fff-8fff-ffffffffffff',
          '2026-08-12T01:00:00.000Z',
          null,
        ),
        payload_digest: 'not-a-digest',
      },
    ]);
    await expect(
      contributor(client).handle(baseRequest('export')),
    ).rejects.toBeInstanceOf(ReviewDataRightsError);
  });
});
