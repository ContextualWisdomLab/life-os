import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReviewDataRightsError } from './review-data-rights';
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
    const sql = await readFile(resolve(__dirname, '../migrations', migration), 'utf8');
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

describeWithPostgres('Review data-rights PostgreSQL integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-review-data-rights-admin',
      max: 3,
    });
  });

  beforeEach(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS guided_review CASCADE');
    await applyMigrations(administrativePool);
  });

  afterEach(async () => {
    await Promise.all(
      activeRuntimes.splice(0).map((runtime) => runtime.close()),
    );
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS guided_review CASCADE');
    await administrativePool.end();
  });

  it('exports, erases, replays, verifies, and preserves another tenant', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const requestedByUserId = randomUUID();
    const requestId = randomUUID();
    const idempotencyKey = randomUUID();
    const runtime = createRuntime();

    const owned = await runtime.service.complete(
      workspaceId,
      'daily-planning',
      completionBody(randomUUID(), 'Portable tenant evidence.'),
    );
    const privateCompletion = await runtime.service.complete(
      otherWorkspaceId,
      'daily-planning',
      completionBody(randomUUID(), 'Private other-tenant evidence.'),
    );

    const firstExport = await runtime.dataRightsContributor.handle({
      contractVersion: 'life-os.data-rights-contributor.v1',
      operation: 'export',
      workspaceId,
      requestedByUserId,
      requestId,
    });
    expect(firstExport.operation).toBe('export');
    if (firstExport.operation !== 'export') {
      throw new Error('Expected Review export response');
    }
    expect(firstExport).toMatchObject({
      contributor: 'review.service',
      schemaVersion: 'review.data-rights.v1',
      recordCount: 1,
    });
    expect(firstExport.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(firstExport.data)).toContain(owned.id);
    expect(JSON.stringify(firstExport.data)).not.toContain(privateCompletion.id);

    const replayedExport = await runtime.dataRightsContributor.handle({
      contractVersion: 'life-os.data-rights-contributor.v1',
      operation: 'export',
      workspaceId,
      requestedByUserId,
      requestId: randomUUID(),
    });
    expect(replayedExport.operation).toBe('export');
    if (replayedExport.operation !== 'export') {
      throw new Error('Expected repeated Review export response');
    }
    expect(replayedExport.data).toEqual(firstExport.data);
    expect(replayedExport.sha256).toBe(firstExport.sha256);

    await expect(
      runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'erase_preflight',
        workspaceId,
        requestedByUserId,
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({
      operation: 'erase_preflight',
      ready: true,
      blockers: [],
    });

    const erasure = await runtime.dataRightsContributor.handle({
      contractVersion: 'life-os.data-rights-contributor.v1',
      operation: 'erase',
      workspaceId,
      requestedByUserId,
      requestId,
      idempotencyKey,
    });
    expect(erasure.operation).toBe('erase');
    if (erasure.operation !== 'erase') {
      throw new Error('Expected Review erasure response');
    }
    expect(erasure.erasedRecords).toBe(1);
    expect(erasure.receiptSha256).toMatch(/^[0-9a-f]{64}$/);

    const replay = await runtime.dataRightsContributor.handle({
      contractVersion: 'life-os.data-rights-contributor.v1',
      operation: 'erase',
      workspaceId,
      requestedByUserId,
      requestId,
      idempotencyKey,
    });
    expect(replay).toEqual(erasure);

    await expect(
      runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'erase',
        workspaceId,
        requestedByUserId,
        requestId: randomUUID(),
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(ReviewDataRightsError);

    await expect(
      runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'verify_erased',
        workspaceId,
        requestedByUserId,
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({
      operation: 'verify_erased',
      erased: true,
    });

    const privateExport = await runtime.dataRightsContributor.handle({
      contractVersion: 'life-os.data-rights-contributor.v1',
      operation: 'export',
      workspaceId: otherWorkspaceId,
      requestedByUserId,
      requestId: randomUUID(),
    });
    expect(privateExport.operation).toBe('export');
    if (privateExport.operation !== 'export') {
      throw new Error('Expected preserved tenant Review export response');
    }
    expect(privateExport.recordCount).toBe(1);
    expect(JSON.stringify(privateExport.data)).toContain(privateCompletion.id);

    const receipt = await administrativePool.query(
      `SELECT workspace_id, requested_by_user_id, request_id, erased_records,
              receipt_sha256
       FROM guided_review.data_rights_erasure_receipt
       WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0]).toMatchObject({
      workspace_id: workspaceId,
      requested_by_user_id: requestedByUserId,
      request_id: requestId,
      erased_records: 1,
      receipt_sha256: erasure.receiptSha256,
    });
  });
});
