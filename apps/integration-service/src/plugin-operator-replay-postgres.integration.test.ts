import { randomUUID } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePluginDeliveryAttemptTestDatabaseTarget } from './plugin-delivery-attempt-test-database';

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const TEST_DATABASE_TARGET = DATABASE_URL
  ? parsePluginDeliveryAttemptTestDatabaseTarget(DATABASE_URL)
  : undefined;
const describeWithPostgres = TEST_DATABASE_TARGET ? describe : describe.skip;

interface ConsumedRow extends QueryResultRow {
  readonly consumed: boolean;
}

let pool: Pool;

beforeAll(() => {
  if (TEST_DATABASE_TARGET && DATABASE_URL) {
    pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
  }
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});

function evidenceLifetime() {
  const consumedAt = new Date();
  const expiresAt = new Date(consumedAt.getTime() + 60_000);
  return [consumedAt.toISOString(), expiresAt.toISOString()] as const;
}

async function consume(evidenceId: string): Promise<boolean> {
  const [consumedAt, expiresAt] = evidenceLifetime();
  const result = await pool.query<ConsumedRow>(
    `SELECT plugin_integration.consume_plugin_operator_context_replay(
       $1::uuid, $2::timestamptz, $3::timestamptz
     ) AS consumed`,
    [evidenceId, consumedAt, expiresAt],
  );
  if (result.rowCount !== 1 || result.rows.length !== 1) {
    throw new Error('Replay consume acceptance returned ambiguous evidence');
  }
  return result.rows[0]?.consumed === true;
}

async function deleteEvidence(evidenceIds: readonly string[]): Promise<void> {
  if (evidenceIds.length === 0) {
    return;
  }
  await pool.query(
    `DELETE FROM plugin_integration.plugin_operator_context_replay_record
     WHERE evidence_id = ANY($1::uuid[])`,
    [[...evidenceIds]],
  );
}

describeWithPostgres('Plugin operator replay PostgreSQL consume authority', () => {
  it('admits exactly one winner when ten replicas race the same evidence identity', async () => {
    const evidenceId = randomUUID();
    try {
      const winners = await Promise.all(
        Array.from({ length: 10 }, () => consume(evidenceId)),
      );

      expect(winners.filter(Boolean)).toHaveLength(1);
      expect(winners.filter((winner) => !winner)).toHaveLength(9);
      await expect(consume(evidenceId)).resolves.toBe(false);
    } finally {
      await deleteEvidence([evidenceId]);
    }
  });

  it('replaces expired evidence once without allowing a second current winner', async () => {
    const evidenceId = randomUUID();
    try {
      await pool.query(
        `INSERT INTO plugin_integration.plugin_operator_context_replay_record (
           evidence_id, consumed_at, expires_at
         ) VALUES ($1::uuid, now() - interval '2 seconds', now() - interval '1 second')`,
        [evidenceId],
      );

      await expect(consume(evidenceId)).resolves.toBe(true);
      await expect(consume(evidenceId)).resolves.toBe(false);
    } finally {
      await deleteEvidence([evidenceId]);
    }
  });

  it('bounds opportunistic expiry cleanup to thirty-two other rows per winner', async () => {
    const winnerId = randomUUID();
    const expiredIds = Array.from({ length: 40 }, () => randomUUID());
    try {
      await pool.query(
        `INSERT INTO plugin_integration.plugin_operator_context_replay_record (
           evidence_id, consumed_at, expires_at
         )
         SELECT evidence_id, now() - interval '2 seconds', now() - interval '1 second'
         FROM unnest($1::uuid[]) AS evidence_id`,
        [expiredIds],
      );

      await expect(consume(winnerId)).resolves.toBe(true);
      const remaining = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM plugin_integration.plugin_operator_context_replay_record
         WHERE evidence_id = ANY($1::uuid[])`,
        [expiredIds],
      );

      expect(remaining.rows[0]?.count).toBe('8');
    } finally {
      await deleteEvidence([winnerId, ...expiredIds]);
    }
  });
});
