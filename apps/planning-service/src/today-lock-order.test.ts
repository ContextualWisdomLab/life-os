import { describe, expect, it } from 'vitest';
import type {
  PlanningSqlClient,
  PlanningSqlQueryResult,
} from './postgres-planning-repository';
import { PostgresTodayRepository } from './postgres-today-repository';
import {
  TodayRevisionConflictError,
  type TodayWriteCommand,
} from './today-sync';

class RecordingClient implements PlanningSqlClient {
  text = '';

  async query<Row>(
    text: string,
    _values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    this.text = text;
    return {
      rows: [
        {
          outcome: 'revision_conflict',
          request_digest: 'a'.repeat(64),
          aggregate_id: null,
          revision_token: null,
          payload_json: null,
          current_revision: null,
        } as Row,
      ],
      rowCount: 1,
    };
  }
}

function command(): TodayWriteCommand {
  return {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    draft: {
      version: 'life-os.today.v1',
      date: '2026-08-09',
      actions: [],
    },
    precondition: { kind: 'absent' },
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    requestDigest: 'a'.repeat(64),
    newAggregateId: '33333333-3333-4333-8333-333333333333',
    newRevision: '44444444-4444-4444-8444-444444444444',
  };
}

describe('Today advisory-lock ordering', () => {
  it('makes the idempotency lock depend on the aggregate lock', async () => {
    const client = new RecordingClient();
    const repository = new PostgresTodayRepository(client);

    await expect(repository.writeToday(command())).rejects.toBeInstanceOf(
      TodayRevisionConflictError,
    );

    expect(client.text).toMatch(/WITH aggregate_lock AS MATERIALIZED/u);
    expect(client.text).toMatch(/idempotency_lock AS MATERIALIZED/u);
    expect(client.text).toMatch(
      /idempotency_lock AS MATERIALIZED \([\s\S]*FROM aggregate_lock\n\s*\),/u,
    );
    expect(client.text.indexOf('aggregate_lock AS MATERIALIZED')).toBeLessThan(
      client.text.indexOf('idempotency_lock AS MATERIALIZED'),
    );
  });
});
