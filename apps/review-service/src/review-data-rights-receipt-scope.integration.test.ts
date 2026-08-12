import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { createReviewRuntime, type ReviewRuntime } from './review-runtime';

const DATABASE_URL =
  process.env.REVIEW_DATABASE_URL ?? process.env.PLANNING_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const activeRuntimes: ReviewRuntime[] = [];
let administrativePool: Pool;

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('A PostgreSQL test database URL is required');
  }
  return DATABASE_URL;
}

async function applyMigrations(pool: Pool): Promise<void> {
  for (const migration of [
    '0001_guided_review_completions.sql',
    '0002_data_rights_erasure_receipt.sql',
  ]) {
    const sql = await readFile(
      resolve(__dirname, '../migrations', migration),
      'utf8',
    );
    await pool.query(sql);
  }
}

function createRuntime(): ReviewRuntime {
  const runtime = createReviewRuntime({
    REVIEW_DATABASE_URL: requireDatabaseUrl(),
    REVIEW_DATABASE_POOL_MAX: '4',
    REVIEW_DATABASE_CONNECT_TIMEOUT_MS: '5000',
    REVIEW_DATABASE_IDLE_TIMEOUT_MS: '1000',
  });
  activeRuntimes.push(runtime);
  return runtime;
}

function completionBody(idempotencyKey: string, reflection: string) {
  return {
    periodStartDate: '2026-08-12',
    idempotencyKey,
    completedStepCount: 3,
    totalStepCount: 3,
    plannedItemCount: 4,
    completedItemCount: 3,
    habitCompletionCount: 2,
    reflection,
    completedAt: '2026-08-12T02:00:00.000Z',
  };
}

describeWithPostgres(
  'Review data-rights receipt tenant isolation',
  () => {
    beforeAll(async () => {
      administrativePool = new Pool({
        connectionString: requireDatabaseUrl(),
        application_name: 'life-os-review-data-rights-receipt-scope',
        max: 3,
      });
    });

    beforeEach(async () => {
      await administrativePool.query(
        'DROP SCHEMA IF EXISTS guided_review CASCADE',
      );
      await applyMigrations(administrativePool);
    });

    afterEach(async () => {
      await Promise.all(
        activeRuntimes.splice(0).map((runtime) => runtime.close()),
      );
    });

    afterAll(async () => {
      await administrativePool.query(
        'DROP SCHEMA IF EXISTS guided_review CASCADE',
      );
      await administrativePool.end();
    });

    it('allows the same idempotency key to be isolated across workspaces', async () => {
      const firstWorkspaceId = randomUUID();
      const secondWorkspaceId = randomUUID();
      const requestedByUserId = randomUUID();
      const idempotencyKey = randomUUID();
      const runtime = createRuntime();

      await runtime.service.complete(
        firstWorkspaceId,
        'daily-planning',
        completionBody(randomUUID(), 'First tenant evidence.'),
      );
      await runtime.service.complete(
        secondWorkspaceId,
        'daily-planning',
        completionBody(randomUUID(), 'Second tenant evidence.'),
      );

      const first = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'erase',
        workspaceId: firstWorkspaceId,
        requestedByUserId,
        requestId: randomUUID(),
        idempotencyKey,
      });
      const second = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'erase',
        workspaceId: secondWorkspaceId,
        requestedByUserId,
        requestId: randomUUID(),
        idempotencyKey,
      });

      expect(first).toMatchObject({ operation: 'erase', erasedRecords: 1 });
      expect(second).toMatchObject({ operation: 'erase', erasedRecords: 1 });
      if (first.operation !== 'erase' || second.operation !== 'erase') {
        throw new Error('Expected Review erasure responses');
      }
      expect(second.receiptSha256).not.toBe(first.receiptSha256);

      const receipts = await administrativePool.query(
        `SELECT workspace_id
         FROM guided_review.data_rights_erasure_receipt
         WHERE idempotency_key = $1
         ORDER BY workspace_id ASC`,
        [idempotencyKey],
      );
      expect(receipts.rows).toEqual(
        [firstWorkspaceId, secondWorkspaceId]
          .sort()
          .map((workspaceId) => ({ workspace_id: workspaceId })),
      );
    });
  },
);
