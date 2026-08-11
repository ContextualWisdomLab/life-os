import { describe, expect, it, vi } from 'vitest';
import {
  HabitDataRightsAuthorityReplayError,
  PostgresHabitDataRightsAuthorityReplayGuard,
} from './habit-data-rights-authority-replay';
import type {
  HabitSqlClient,
  HabitSqlQueryResult,
} from './postgres-habit-repository';

const DIGEST = 'a'.repeat(64);
const EXPIRES_AT = '2026-08-12T00:01:00.000Z';

class FakeSqlClient implements HabitSqlClient {
  readonly query = vi.fn();

  async queryTyped<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>> {
    return (await this.query(text, values)) as HabitSqlQueryResult<Row>;
  }
}

function clientWith(rows: readonly unknown[]): HabitSqlClient & {
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows });
  return { query } as unknown as HabitSqlClient & {
    query: ReturnType<typeof vi.fn>;
  };
}

describe('PostgresHabitDataRightsAuthorityReplayGuard', () => {
  it('uses database time and fixed parameterized SQL to atomically consume the first digest', async () => {
    const client = clientWith([{ evidence_digest: DIGEST }]);
    const guard = new PostgresHabitDataRightsAuthorityReplayGuard(client);

    await expect(
      guard.consume({ evidenceDigest: DIGEST, expiresAt: EXPIRES_AT }),
    ).resolves.toBe(true);
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE expires_at < now()'),
      [],
    );
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ON CONFLICT (evidence_digest) DO NOTHING'),
      [DIGEST, EXPIRES_AT],
    );
    expect(client.query.mock.calls[1]?.[0]).toContain(
      'WHERE $2::timestamptz >= now()',
    );
  });

  it('returns false when the digest already exists or database time says it expired', async () => {
    const guard = new PostgresHabitDataRightsAuthorityReplayGuard(clientWith([]));
    await expect(
      guard.consume({ evidenceDigest: DIGEST, expiresAt: EXPIRES_AT }),
    ).resolves.toBe(false);
  });

  it('rejects malformed caller evidence before any SQL authority is invoked', async () => {
    const query = vi.fn();
    const client = { query } as unknown as HabitSqlClient;
    const guard = new PostgresHabitDataRightsAuthorityReplayGuard(client);

    for (const evidence of [
      { evidenceDigest: 'not-a-digest', expiresAt: EXPIRES_AT },
      { evidenceDigest: DIGEST, expiresAt: '2026-08-12' },
    ]) {
      await expect(guard.consume(evidence)).rejects.toBeInstanceOf(
        HabitDataRightsAuthorityReplayError,
      );
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects ambiguous or corrupted INSERT evidence instead of granting authority', async () => {
    for (const rows of [
      [{ evidence_digest: 'b'.repeat(64) }],
      [{ evidence_digest: DIGEST }, { evidence_digest: DIGEST }],
      [{ evidence_digest: null }],
    ]) {
      const guard = new PostgresHabitDataRightsAuthorityReplayGuard(clientWith(rows));
      await expect(
        guard.consume({ evidenceDigest: DIGEST, expiresAt: EXPIRES_AT }),
      ).rejects.toBeInstanceOf(HabitDataRightsAuthorityReplayError);
    }
  });
});
