import { describe, expect, it } from 'vitest';
import type {
  PlanningSqlClient,
  PlanningSqlQueryResult,
} from './postgres-planning-repository';
import {
  PostgresTodayRepository,
  TodayPersistenceError,
} from './postgres-today-repository';
import {
  TodayIdempotencyConflictError,
  TodayRevisionConflictError,
  type TodayWriteCommand,
} from './today-sync';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const AGGREGATE_ID = '22222222-2222-4222-8222-222222222222';
const REVISION = '33333333-3333-4333-8333-333333333333';
const NEW_REVISION = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';
const DATE = '2026-08-09';
const REQUEST_DIGEST = 'a'.repeat(64);

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

class RecordingClient implements PlanningSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly responses: unknown[][]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: (this.responses.shift() ?? []) as Row[] };
  }
}

function payload(title = 'Durable Today') {
  return {
    version: 'life-os.today.v1',
    date: DATE,
    actions: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        title,
        status: 'open',
        priority: 1,
        startMinute: 540,
        durationMinutes: 60,
        createdAt: '2026-08-09T00:00:00.000Z',
        completedAt: null,
      },
    ],
  };
}

function command(): TodayWriteCommand {
  return {
    workspaceId: WORKSPACE_ID,
    draft: payload() as TodayWriteCommand['draft'],
    precondition: { kind: 'match', revision: REVISION },
    idempotencyKey: IDEMPOTENCY_KEY,
    requestDigest: REQUEST_DIGEST,
    newAggregateId: AGGREGATE_ID,
    newRevision: NEW_REVISION,
  };
}

describe('PostgresTodayRepository', () => {
  it('reads only one workspace/date aggregate and validates durable output', async () => {
    const client = new RecordingClient([
      [
        {
          workspace_id: WORKSPACE_ID,
          local_date: DATE,
          aggregate_id: AGGREGATE_ID,
          revision_token: REVISION,
          payload_json: payload(),
        },
      ],
    ]);
    const repository = new PostgresTodayRepository(client);

    await expect(repository.getToday(WORKSPACE_ID, DATE)).resolves.toEqual({
      ...payload(),
      aggregateId: AGGREGATE_ID,
      revision: REVISION,
    });
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, DATE]);
    expect(client.calls[0]?.text).toContain('WHERE workspace_id = $1');
    expect(client.calls[0]?.text).toContain('local_date = $2');
    expect(client.calls[0]?.text).toContain('LIMIT 2');
  });

  it('executes one parameterized advisory-locked statement for optimistic update and replay evidence', async () => {
    const client = new RecordingClient([
      [
        {
          outcome: 'updated',
          request_digest: REQUEST_DIGEST,
          aggregate_id: AGGREGATE_ID,
          revision_token: NEW_REVISION,
          payload_json: payload(),
          current_revision: REVISION,
        },
      ],
    ]);
    const repository = new PostgresTodayRepository(client);
    const write = command();

    await expect(repository.writeToday(write)).resolves.toEqual({
      kind: 'updated',
      aggregate: {
        ...payload(),
        aggregateId: AGGREGATE_ID,
        revision: NEW_REVISION,
      },
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain('pg_advisory_xact_lock');
    expect(client.calls[0]?.text).toContain('today_idempotency_records');
    expect(client.calls[0]?.text).toContain('revision_number = revision_number + 1');
    expect(client.calls[0]?.text).not.toContain('Durable Today');
    expect(client.calls[0]?.values).toEqual([
      WORKSPACE_ID,
      DATE,
      IDEMPOTENCY_KEY,
      REQUEST_DIGEST,
      AGGREGATE_ID,
      NEW_REVISION,
      JSON.stringify(payload()),
      'match',
      REVISION,
    ]);
  });

  it('returns the original response for an exact idempotent replay', async () => {
    const client = new RecordingClient([
      [
        {
          outcome: 'replayed',
          request_digest: REQUEST_DIGEST,
          aggregate_id: AGGREGATE_ID,
          revision_token: REVISION,
          payload_json: payload('Original response'),
          current_revision: NEW_REVISION,
        },
      ],
    ]);
    const repository = new PostgresTodayRepository(client);

    await expect(repository.writeToday(command())).resolves.toEqual({
      kind: 'replayed',
      aggregate: {
        ...payload('Original response'),
        aggregateId: AGGREGATE_ID,
        revision: REVISION,
      },
    });
  });

  it('fails closed on stale revisions without exposing server content', async () => {
    const client = new RecordingClient([
      [
        {
          outcome: 'revision_conflict',
          request_digest: REQUEST_DIGEST,
          aggregate_id: null,
          revision_token: null,
          payload_json: null,
          current_revision: REVISION,
        },
      ],
    ]);
    const repository = new PostgresTodayRepository(client);

    await expect(repository.writeToday(command())).rejects.toEqual(
      new TodayRevisionConflictError(REVISION),
    );
  });

  it('fails closed when an idempotency key is reused for a different request', async () => {
    const client = new RecordingClient([
      [
        {
          outcome: 'idempotency_conflict',
          request_digest: 'b'.repeat(64),
          aggregate_id: AGGREGATE_ID,
          revision_token: REVISION,
          payload_json: payload(),
          current_revision: REVISION,
        },
      ],
    ]);
    const repository = new PostgresTodayRepository(client);

    await expect(repository.writeToday(command())).rejects.toBeInstanceOf(
      TodayIdempotencyConflictError,
    );
  });

  it('rejects malformed or duplicate persistence rows', async () => {
    const malformed = {
      workspace_id: WORKSPACE_ID,
      local_date: DATE,
      aggregate_id: 'not-a-uuid',
      revision_token: REVISION,
      payload_json: payload(),
    };
    const duplicate = {
      workspace_id: WORKSPACE_ID,
      local_date: DATE,
      aggregate_id: AGGREGATE_ID,
      revision_token: REVISION,
      payload_json: payload(),
    };
    const malformedRepository = new PostgresTodayRepository(
      new RecordingClient([[malformed]]),
    );
    const duplicateRepository = new PostgresTodayRepository(
      new RecordingClient([[duplicate, duplicate]]),
    );

    await expect(
      malformedRepository.getToday(WORKSPACE_ID, DATE),
    ).rejects.toBeInstanceOf(TodayPersistenceError);
    await expect(
      duplicateRepository.getToday(WORKSPACE_ID, DATE),
    ).rejects.toBeInstanceOf(TodayPersistenceError);
  });
});
