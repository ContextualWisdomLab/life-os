import { describe, expect, it } from 'vitest';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  PlanningDataRightsContributor,
  PlanningDataRightsError,
} from './planning-data-rights';
import type { TodayTransactionalSqlClient } from './postgres-today-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const CANONICAL_RECEIPT_SHA256 = 'a'.repeat(64);

/** Replays one durable erasure receipt through the real idempotency path. */
function receiptReplayClient(receiptSha256: unknown): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.includes('FROM planning.data_rights_erasure_receipts')) {
        return {
          rows: [
            {
              requested_by_user_id: USER_ID,
              request_id: REQUEST_ID,
              erased_records: 0,
              receipt_sha256: receiptSha256,
            } as unknown as Row,
          ],
        };
      }
      return { rows: [] };
    },
    async transaction<Result>(
      operation: (transaction: TodayTransactionalSqlClient) => Promise<Result>,
    ): Promise<Result> {
      return await operation(client);
    },
  };
  return client;
}

function eraseRequest() {
  return {
    contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
    operation: 'erase' as const,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
  };
}

describe('Planning data-rights digest evidence', () => {
  it('rejects noncanonical uppercase durable receipt digest evidence', async () => {
    const contributor = new PlanningDataRightsContributor(
      receiptReplayClient(CANONICAL_RECEIPT_SHA256.toUpperCase()),
    );

    await expect(contributor.handle(eraseRequest())).rejects.toBeInstanceOf(
      PlanningDataRightsError,
    );
  });

  it('accepts the canonical lowercase durable receipt digest contract', async () => {
    const contributor = new PlanningDataRightsContributor(
      receiptReplayClient(CANONICAL_RECEIPT_SHA256),
    );

    await expect(contributor.handle(eraseRequest())).resolves.toMatchObject({
      operation: 'erase',
      erasedRecords: 0,
      receiptSha256: CANONICAL_RECEIPT_SHA256,
    });
  });
});
