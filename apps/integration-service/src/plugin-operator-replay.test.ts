import { describe, expect, it } from 'vitest';
import {
  PluginOperatorReplayValidationError,
  PostgresPluginOperatorReplayGuard,
  type PluginOperatorReplaySqlClient,
  type PluginOperatorReplaySqlResult,
} from './plugin-operator-replay';

const EVIDENCE_ID = '77777777-7777-4777-8777-777777777777';
const LOWERCASE_EVIDENCE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CONSUMED_AT = '2026-08-11T14:35:00.000Z';
const EXPIRES_AT = '2026-08-11T14:36:00.000Z';

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[] | undefined;
}

class ScriptedSqlClient implements PluginOperatorReplaySqlClient {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly results: readonly PluginOperatorReplaySqlResult<unknown>[],
  ) {}

  async query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginOperatorReplaySqlResult<Row>> {
    this.queries.push({ text, values });
    const result = this.results[this.queries.length - 1];
    if (!result) {
      throw new Error('Unexpected replay-store SQL query');
    }
    return result as PluginOperatorReplaySqlResult<Row>;
  }
}

function evidence(
  overrides: Partial<{
    evidenceId: string;
    consumedAt: string;
    expiresAt: string;
  }> = {},
) {
  return {
    evidenceId: EVIDENCE_ID,
    consumedAt: CONSUMED_AT,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

describe('PostgresPluginOperatorReplayGuard', () => {
  it('delegates atomic consume and bounded expiry cleanup through one PostgreSQL round trip', async () => {
    const client = new ScriptedSqlClient([
      { rows: [{ consumed: true }], rowCount: 1 },
    ]);
    const guard = new PostgresPluginOperatorReplayGuard(client);

    await expect(guard.consume(evidence())).resolves.toBe(true);

    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]?.text).toContain(
      'plugin_integration.consume_plugin_operator_context_replay',
    );
    expect(client.queries[0]?.values).toEqual([
      EVIDENCE_ID,
      CONSUMED_AT,
      EXPIRES_AT,
    ]);
  });

  it('normalizes accepted UUID evidence to lowercase before persistence', async () => {
    const client = new ScriptedSqlClient([
      { rows: [{ consumed: true }], rowCount: 1 },
    ]);
    const guard = new PostgresPluginOperatorReplayGuard(client);

    await expect(
      guard.consume(
        evidence({ evidenceId: LOWERCASE_EVIDENCE_ID.toUpperCase() }),
      ),
    ).resolves.toBe(true);

    expect(client.queries[0]?.values).toEqual([
      LOWERCASE_EVIDENCE_ID,
      CONSUMED_AT,
      EXPIRES_AT,
    ]);
  });

  it('returns false when another service instance already consumed still-valid evidence', async () => {
    const client = new ScriptedSqlClient([
      { rows: [{ consumed: false }], rowCount: 1 },
    ]);
    const guard = new PostgresPluginOperatorReplayGuard(client);

    await expect(guard.consume(evidence())).resolves.toBe(false);
    expect(client.queries).toHaveLength(1);
  });

  it('rejects malformed or contradictory evidence before issuing SQL', async () => {
    for (const candidate of [
      evidence({ evidenceId: 'not-a-uuid' }),
      evidence({ consumedAt: '2026-08-11 14:35:00Z' }),
      evidence({ expiresAt: '2026-08-11T14:34:59.999Z' }),
    ]) {
      const client = new ScriptedSqlClient([]);
      const guard = new PostgresPluginOperatorReplayGuard(client);

      await expect(guard.consume(candidate)).rejects.toBeInstanceOf(
        PluginOperatorReplayValidationError,
      );
      expect(client.queries).toHaveLength(0);
    }
  });

  it('fails closed before SQL when replay request evidence access is hostile', async () => {
    const revokedEvidence = Proxy.revocable(evidence(), {});
    revokedEvidence.revoke();
    const throwingEvidence = {
      get evidenceId(): string {
        throw new Error('password=must-not-escape-replay-request-evidence');
      },
      consumedAt: CONSUMED_AT,
      expiresAt: EXPIRES_AT,
    };

    for (const candidate of [revokedEvidence.proxy, throwingEvidence]) {
      const client = new ScriptedSqlClient([]);
      const guard = new PostgresPluginOperatorReplayGuard(client);

      await expect(guard.consume(candidate)).rejects.toMatchObject({
        name: 'PluginOperatorReplayValidationError',
        message: 'Plugin operator replay evidence is invalid',
      });
      expect(client.queries).toHaveLength(0);
    }
  });

  it('rejects ambiguous or corrupted consume evidence instead of granting authority', async () => {
    for (const result of [
      { rows: [{ consumed: true }], rowCount: null },
      { rows: [], rowCount: 0 },
      {
        rows: [{ consumed: true }, { consumed: true }],
        rowCount: 2,
      },
      {
        rows: { consumed: true } as unknown as readonly unknown[],
        rowCount: 1,
      },
      { rows: [{ consumed: 'true' }], rowCount: 1 },
    ] satisfies readonly PluginOperatorReplaySqlResult<unknown>[]) {
      const client = new ScriptedSqlClient([result]);
      const guard = new PostgresPluginOperatorReplayGuard(client);

      await expect(guard.consume(evidence())).rejects.toBeInstanceOf(
        PluginOperatorReplayValidationError,
      );
      expect(client.queries).toHaveLength(1);
    }
  });

  it('observes hostile replay SQL rows once before granting consume authority', async () => {
    let rowsReads = 0;
    const result = {
      rowCount: 1,
      get rows(): readonly unknown[] {
        rowsReads += 1;
        return rowsReads === 1
          ? [{ consumed: 'not-a-boolean' }]
          : [{ consumed: true }];
      },
    } satisfies PluginOperatorReplaySqlResult<unknown>;
    const client = new ScriptedSqlClient([result]);
    const guard = new PostgresPluginOperatorReplayGuard(client);

    await expect(guard.consume(evidence())).rejects.toBeInstanceOf(
      PluginOperatorReplayValidationError,
    );
    expect(rowsReads).toBe(1);
    expect(client.queries).toHaveLength(1);
  });

  it('fails closed when replay SQL collection or row access is revoked', async () => {
    const revokedRows = Proxy.revocable([{ consumed: true }], {});
    revokedRows.revoke();
    const revokedRow = Proxy.revocable({ consumed: true }, {});
    revokedRow.revoke();

    for (const result of [
      {
        rows: revokedRows.proxy as unknown as readonly unknown[],
        rowCount: 1,
      },
      {
        rows: [revokedRow.proxy],
        rowCount: 1,
      },
      {
        rowCount: 1,
        get rows(): readonly unknown[] {
          throw new Error('password=must-not-escape-replay-sql-evidence');
        },
      },
    ] satisfies readonly PluginOperatorReplaySqlResult<unknown>[]) {
      const client = new ScriptedSqlClient([result]);
      const guard = new PostgresPluginOperatorReplayGuard(client);

      await expect(guard.consume(evidence())).rejects.toMatchObject({
        name: 'PluginOperatorReplayValidationError',
        message: 'Plugin operator replay evidence is invalid',
      });
      expect(client.queries).toHaveLength(1);
    }
  });
});
