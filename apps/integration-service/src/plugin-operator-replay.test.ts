import { describe, expect, it } from 'vitest';
import {
  PluginOperatorReplayValidationError,
  PostgresPluginOperatorReplayGuard,
  type PluginOperatorReplaySqlClient,
  type PluginOperatorReplaySqlResult,
} from './plugin-operator-replay';

const EVIDENCE_ID = '77777777-7777-4777-8777-777777777777';
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
  it('atomically consumes one evidence UUID after pruning only expired rows', async () => {
    const client = new ScriptedSqlClient([
      { rows: [], rowCount: 0 },
      { rows: [{ evidence_id: EVIDENCE_ID }], rowCount: 1 },
    ]);
    const guard = new PostgresPluginOperatorReplayGuard(client);

    await expect(guard.consume(evidence())).resolves.toBe(true);

    expect(client.queries).toHaveLength(2);
    expect(client.queries[0]?.text).toContain(
      'DELETE FROM plugin_integration.plugin_operator_context_replay_record',
    );
    expect(client.queries[0]?.text).toContain('expires_at < $1::timestamptz');
    expect(client.queries[0]?.values).toEqual([CONSUMED_AT]);
    expect(client.queries[1]?.text).toContain(
      'INSERT INTO plugin_integration.plugin_operator_context_replay_record',
    );
    expect(client.queries[1]?.text).toContain(
      'ON CONFLICT (evidence_id) DO NOTHING',
    );
    expect(client.queries[1]?.values).toEqual([
      EVIDENCE_ID,
      CONSUMED_AT,
      EXPIRES_AT,
    ]);
  });

  it('returns false when another service instance already consumed the evidence UUID', async () => {
    const client = new ScriptedSqlClient([
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    const guard = new PostgresPluginOperatorReplayGuard(client);

    await expect(guard.consume(evidence())).resolves.toBe(false);
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

  it('rejects ambiguous or corrupted INSERT evidence instead of granting authority', async () => {
    for (const inserted of [
      { rows: [{ evidence_id: EVIDENCE_ID }], rowCount: null },
      {
        rows: [
          { evidence_id: EVIDENCE_ID },
          { evidence_id: EVIDENCE_ID },
        ],
        rowCount: 2,
      },
      {
        rows: [{ evidence_id: '88888888-8888-4888-8888-888888888888' }],
        rowCount: 1,
      },
    ] satisfies readonly PluginOperatorReplaySqlResult<unknown>[]) {
      const client = new ScriptedSqlClient([
        { rows: [], rowCount: 0 },
        inserted,
      ]);
      const guard = new PostgresPluginOperatorReplayGuard(client);

      await expect(guard.consume(evidence())).rejects.toBeInstanceOf(
        PluginOperatorReplayValidationError,
      );
    }
  });
});
