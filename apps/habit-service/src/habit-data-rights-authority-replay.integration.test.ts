import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresHabitDataRightsAuthorityReplayGuard } from './habit-data-rights-authority-replay';
import type {
  HabitSqlClient,
  HabitSqlQueryResult,
} from './postgres-habit-repository';

const DATABASE_URL = process.env.HABIT_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;

class PoolSqlClient implements HabitSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }
}

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('HABIT_DATABASE_URL is required for integration tests');
  }
  return DATABASE_URL;
}

async function applyMigrations(pool: Pool): Promise<void> {
  for (const migration of [
    '0001_recurring_habit_core.sql',
    '0002_data_rights_erasure.sql',
    '0003_data_rights_authority_replay.sql',
  ]) {
    const sql = await readFile(
      resolve(__dirname, '../migrations', migration),
      'utf8',
    );
    await pool.query(sql);
  }
}

describeWithPostgres('Habit data-rights authority replay PostgreSQL integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-data-rights-replay-test',
      max: 4,
    });
  });

  beforeEach(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await applyMigrations(administrativePool);
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await administrativePool.end();
  });

  it('allows exactly one concurrent winner and never persists raw authorization evidence', async () => {
    const guard = new PostgresHabitDataRightsAuthorityReplayGuard(
      new PoolSqlClient(administrativePool),
    );
    const rawSignature = 'sensitive-short-lived-proof';
    const evidenceDigest = createHash('sha256')
      .update(rawSignature, 'ascii')
      .digest('hex');
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const results = await Promise.all([
      guard.consume({ evidenceDigest, expiresAt }),
      guard.consume({ evidenceDigest, expiresAt }),
    ]);
    expect(results.sort()).toEqual([false, true]);

    const stored = await administrativePool.query(
      `SELECT evidence_digest, consumed_at, expires_at
       FROM habit.data_rights_authority_replay_records`,
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.evidence_digest).toBe(evidenceDigest);
    expect(JSON.stringify(stored.rows)).not.toContain(rawSignature);
  });

  it('rejects already expired evidence using the database clock', async () => {
    const guard = new PostgresHabitDataRightsAuthorityReplayGuard(
      new PoolSqlClient(administrativePool),
    );
    await expect(
      guard.consume({
        evidenceDigest: 'b'.repeat(64),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).resolves.toBe(false);
  });
});
