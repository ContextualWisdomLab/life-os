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
import {
  ReviewCompletionConflictError,
  ReviewService,
  ReviewValidationError,
  type ReviewRitualKind,
} from './review-domain';
import { createReviewRuntime, type ReviewRuntime } from './review-runtime';

const DATABASE_URL = process.env.REVIEW_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const activeRuntimes: ReviewRuntime[] = [];
let administrativePool: Pool;

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('REVIEW_DATABASE_URL is required for integration tests');
  }
  return DATABASE_URL;
}

async function applyMigrations(pool: Pool): Promise<void> {
  const sql = await readFile(
    resolve(__dirname, '../migrations/0001_guided_review_completions.sql'),
    'utf8',
  );
  await pool.query(sql);
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

function completionBody(
  idempotencyKey: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    periodStartDate: '2026-08-03',
    idempotencyKey,
    completedStepCount: 5,
    totalStepCount: 5,
    plannedItemCount: 4,
    completedItemCount: 3,
    habitCompletionCount: 2,
    reflection: 'Reviewed bounded evidence.',
    completedAt: '2026-08-03T20:00:00.000Z',
    ...overrides,
  };
}

describeWithPostgres('guided Review service integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-review-integration-admin',
      max: 2,
    });
    await administrativePool.query(
      'DROP SCHEMA IF EXISTS guided_review CASCADE',
    );
    await applyMigrations(administrativePool);
  }, 30_000);

  beforeEach(async () => {
    await administrativePool.query(
      'TRUNCATE guided_review.review_completions',
    );
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
  }, 30_000);

  it('preserves immutable completion evidence across exact replay and restart', async () => {
    const workspaceId = randomUUID();
    const idempotencyKey = randomUUID();
    const body = completionBody(idempotencyKey);
    const firstRuntime = createRuntime();

    const first = await firstRuntime.service.complete(
      workspaceId,
      'weekly-review',
      body,
    );
    const replay = await firstRuntime.service.complete(
      workspaceId,
      'weekly-review',
      body,
    );
    expect(replay).toEqual(first);
    await firstRuntime.close();

    const restartedRuntime = createRuntime();
    await expect(restartedRuntime.service.list(workspaceId, 50)).resolves.toEqual(
      [first],
    );
  });

  it('isolates tenants and rejects conflicting immutable evidence', async () => {
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const sharedIdempotencyKey = randomUUID();
    const runtime = createRuntime();
    const first = await runtime.service.complete(
      workspaceA,
      'daily-planning',
      completionBody(sharedIdempotencyKey),
    );
    const second = await runtime.service.complete(
      workspaceB,
      'daily-planning',
      completionBody(sharedIdempotencyKey),
    );

    await expect(runtime.service.list(workspaceA, 50)).resolves.toEqual([first]);
    await expect(runtime.service.list(workspaceB, 50)).resolves.toEqual([
      second,
    ]);
    await expect(
      runtime.service.complete(
        workspaceA,
        'daily-planning',
        completionBody(sharedIdempotencyKey, {
          completedItemCount: 2,
          completedAt: '2026-08-03T20:05:00.000Z',
        }),
      ),
    ).rejects.toBeInstanceOf(ReviewCompletionConflictError);
  });

  it('returns deterministic newest-first history across ritual kinds', async () => {
    const workspaceId = randomUUID();
    const runtime = createRuntime();
    const rituals: Array<[ReviewRitualKind, string]> = [
      ['daily-planning', '2026-08-03T08:00:00.000Z'],
      ['daily-shutdown', '2026-08-03T18:00:00.000Z'],
      ['weekly-review', '2026-08-03T20:00:00.000Z'],
    ];
    for (const [ritualKind, completedAt] of rituals) {
      await runtime.service.complete(
        workspaceId,
        ritualKind,
        completionBody(randomUUID(), { completedAt }),
      );
    }

    const firstRead = await runtime.service.list(workspaceId, 50);
    const secondRead = await runtime.service.list(workspaceId, 50);
    expect(firstRead).toEqual(secondRead);
    expect(firstRead.map((record) => record.ritualKind)).toEqual([
      'weekly-review',
      'daily-shutdown',
      'daily-planning',
    ]);
  });

  it('rejects ownership injection and exposes no mutation capability', async () => {
    const runtime = createRuntime();
    await expect(
      runtime.service.complete(randomUUID(), 'daily-shutdown', {
        ...completionBody(randomUUID()),
        workspaceId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ReviewValidationError);

    expect(Object.getOwnPropertyNames(ReviewService.prototype).sort()).toEqual([
      'complete',
      'constructor',
      'list',
    ]);
  });
});
