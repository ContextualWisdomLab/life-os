import { describe, expect, it } from 'vitest';
import {
  DataRightsRequestConflictError,
  DataRightsRequestPersistenceError,
  DataRightsRequestValidationError,
  PostgresDataRightsRequestLedger,
  type DataRightsRequestSqlClient,
  type DataRightsRequestSqlResult,
} from './data-rights-request-ledger';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_USER_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const REQUEST_DIGEST = 'a'.repeat(64);
const RECEIPT_DIGEST = 'b'.repeat(64);
const REQUESTED_AT = '2026-08-09T19:40:00.000Z';
const COMPLETED_AT = '2026-08-09T19:45:00.000Z';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class RecordingSqlClient implements DataRightsRequestSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly responses: unknown[][]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<DataRightsRequestSqlResult<Row>> {
    this.calls.push({ text, values });
    const rows = (this.responses.shift() ?? []) as Row[];
    return { rows, rowCount: rows.length };
  }
}

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    request_id: REQUEST_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: ACTOR_USER_ID,
    request_kind: 'export',
    idempotency_key: IDEMPOTENCY_KEY,
    request_digest: REQUEST_DIGEST,
    request_status: 'pending',
    receipt_digest: null,
    requested_at: REQUESTED_AT,
    completed_at: null,
    ...overrides,
  };
}

function beginInput(overrides: Record<string, unknown> = {}) {
  return {
    requestId: REQUEST_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: ACTOR_USER_ID,
    requestKind: 'export' as const,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestDigest: REQUEST_DIGEST,
    requestedAt: REQUESTED_AT,
    ...overrides,
  };
}

describe('PostgresDataRightsRequestLedger', () => {
  it('creates a tenant-bound request through fixed parameterized SQL', async () => {
    const client = new RecordingSqlClient([[storedRow()]]);
    const ledger = new PostgresDataRightsRequestLedger(client);

    await expect(ledger.beginRequest(beginInput())).resolves.toEqual({
      kind: 'created',
      request: {
        requestId: REQUEST_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: ACTOR_USER_ID,
        requestKind: 'export',
        idempotencyKey: IDEMPOTENCY_KEY,
        requestDigest: REQUEST_DIGEST,
        status: 'pending',
        receiptDigest: null,
        requestedAt: REQUESTED_AT,
        completedAt: null,
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain('identity.data_rights_requests');
    expect(client.calls[0]?.text).toContain('ON CONFLICT DO NOTHING');
    expect(client.calls[0]?.text).not.toContain(REQUEST_DIGEST);
    expect(client.calls[0]?.values).toEqual([
      REQUEST_ID,
      WORKSPACE_ID,
      ACTOR_USER_ID,
      'export',
      IDEMPOTENCY_KEY,
      REQUEST_DIGEST,
      REQUESTED_AT,
    ]);
  });

  it('returns an exact durable replay from pg-style Date timestamp values', async () => {
    const client = new RecordingSqlClient([
      [],
      [storedRow({ requested_at: new Date(REQUESTED_AT) })],
    ]);
    const ledger = new PostgresDataRightsRequestLedger(client);

    await expect(ledger.beginRequest(beginInput())).resolves.toMatchObject({
      kind: 'replayed',
      request: {
        requestId: REQUEST_ID,
        requestDigest: REQUEST_DIGEST,
        requestedAt: REQUESTED_AT,
      },
    });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.text).toContain('idempotency_key = $2::uuid');
    expect(client.calls[1]?.text).toContain('request_id = $3::uuid');
    expect(client.calls[1]?.values).toEqual([
      WORKSPACE_ID,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
    ]);
  });

  it('fails closed when an idempotency key is reused for another request', async () => {
    const client = new RecordingSqlClient([
      [],
      [storedRow({ request_digest: 'c'.repeat(64) })],
    ]);
    const ledger = new PostgresDataRightsRequestLedger(client);

    await expect(ledger.beginRequest(beginInput())).rejects.toBeInstanceOf(
      DataRightsRequestConflictError,
    );
  });

  it('maps two distinct collision rows to a stable domain conflict', async () => {
    const otherRequestId = '55555555-5555-4555-8555-555555555555';
    const otherIdempotencyKey = '66666666-6666-4666-8666-666666666666';
    const client = new RecordingSqlClient([
      [],
      [
        storedRow({ request_id: otherRequestId }),
        storedRow({ idempotency_key: otherIdempotencyKey }),
      ],
    ]);
    const ledger = new PostgresDataRightsRequestLedger(client);

    await expect(ledger.beginRequest(beginInput())).rejects.toBeInstanceOf(
      DataRightsRequestConflictError,
    );
  });

  it('stores one immutable terminal receipt and replays pg-style Date timestamps', async () => {
    const completed = storedRow({
      request_status: 'completed',
      receipt_digest: RECEIPT_DIGEST,
      requested_at: new Date(REQUESTED_AT),
      completed_at: new Date(COMPLETED_AT),
    });
    const client = new RecordingSqlClient([[completed], [], [completed]]);
    const ledger = new PostgresDataRightsRequestLedger(client);

    await expect(
      ledger.completeRequest({
        requestId: REQUEST_ID,
        workspaceId: WORKSPACE_ID,
        receiptDigest: RECEIPT_DIGEST,
        completedAt: COMPLETED_AT,
      }),
    ).resolves.toMatchObject({
      kind: 'completed',
      request: { requestedAt: REQUESTED_AT, completedAt: COMPLETED_AT },
    });
    await expect(
      ledger.completeRequest({
        requestId: REQUEST_ID,
        workspaceId: WORKSPACE_ID,
        receiptDigest: RECEIPT_DIGEST,
        completedAt: COMPLETED_AT,
      }),
    ).resolves.toMatchObject({ kind: 'replayed' });
  });

  it('rejects a conflicting terminal receipt instead of rewriting audit evidence', async () => {
    const client = new RecordingSqlClient([
      [],
      [
        storedRow({
          request_status: 'completed',
          receipt_digest: 'c'.repeat(64),
          completed_at: COMPLETED_AT,
        }),
      ],
    ]);
    const ledger = new PostgresDataRightsRequestLedger(client);

    await expect(
      ledger.completeRequest({
        requestId: REQUEST_ID,
        workspaceId: WORKSPACE_ID,
        receiptDigest: RECEIPT_DIGEST,
        completedAt: COMPLETED_AT,
      }),
    ).rejects.toBeInstanceOf(DataRightsRequestConflictError);
  });

  it('returns one request only through tenant-and-actor scoped status lookup', async () => {
    const client = new RecordingSqlClient([[storedRow()]]);
    const ledger = new PostgresDataRightsRequestLedger(client);

    await expect(
      ledger.getRequest({
        requestId: REQUEST_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: ACTOR_USER_ID,
      }),
    ).resolves.toMatchObject({
      requestId: REQUEST_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: ACTOR_USER_ID,
      status: 'pending',
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain('request_id = $1::uuid');
    expect(client.calls[0]?.text).toContain('workspace_id = $2::uuid');
    expect(client.calls[0]?.text).toContain('requested_by_user_id = $3::uuid');
    expect(client.calls[0]?.values).toEqual([
      REQUEST_ID,
      WORKSPACE_ID,
      ACTOR_USER_ID,
    ]);
  });

  it('returns undefined for an inaccessible request without widening the lookup', async () => {
    const client = new RecordingSqlClient([[]]);
    const ledger = new PostgresDataRightsRequestLedger(client);

    await expect(
      ledger.getRequest({
        requestId: REQUEST_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: ACTOR_USER_ID,
      }),
    ).resolves.toBeUndefined();
    expect(client.calls).toHaveLength(1);
  });

  it('fails closed on malformed or duplicate persisted status lookup evidence', async () => {
    const invalidClient = new RecordingSqlClient([]);
    const invalidLedger = new PostgresDataRightsRequestLedger(invalidClient);
    await expect(
      invalidLedger.getRequest({
        requestId: 'not-a-uuid',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: ACTOR_USER_ID,
      }),
    ).rejects.toBeInstanceOf(DataRightsRequestValidationError);
    expect(invalidClient.calls).toHaveLength(0);

    const duplicateClient = new RecordingSqlClient([[storedRow(), storedRow()]]);
    const duplicateLedger = new PostgresDataRightsRequestLedger(duplicateClient);
    await expect(
      duplicateLedger.getRequest({
        requestId: REQUEST_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: ACTOR_USER_ID,
      }),
    ).rejects.toBeInstanceOf(DataRightsRequestPersistenceError);
  });

  it('rejects malformed ownership, digest, kind, and time before querying PostgreSQL', async () => {
    for (const invalidInput of [
      beginInput({ workspaceId: 'not-a-uuid' }),
      beginInput({ requestKind: 'delete' }),
      beginInput({ requestDigest: 'not-a-digest' }),
      beginInput({ requestedAt: 'not-an-instant' }),
    ]) {
      const client = new RecordingSqlClient([]);
      const ledger = new PostgresDataRightsRequestLedger(client);
      await expect(ledger.beginRequest(invalidInput as never)).rejects.toBeInstanceOf(
        DataRightsRequestValidationError,
      );
      expect(client.calls).toHaveLength(0);
    }
  });
});
