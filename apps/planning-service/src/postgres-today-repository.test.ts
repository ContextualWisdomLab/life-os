import { describe, expect, it } from 'vitest';
import type { PlanningSqlQueryResult } from './postgres-planning-repository';
import {
  PostgresTodayRepository,
  TodayPersistenceError,
  type TodayTransactionalSqlClient,
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

class RecordingClient implements TodayTransactionalSqlClient {
  readonly calls: QueryCall[] = [];
  transactionCalls = 0;

  constructor(private readonly responses: unknown[][]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: (this.responses.shift() ?? []) as Row[] };
  }

  async transaction<Result>(
    operation: (client: TodayTransactionalSqlClient) => Promise<Result>,
  ): Promise<Result> {
    this.transactionCalls += 1;
    return await operation(this);
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

function aggregateRow(
  revision = REVISION,
  title = 'Durable Today',
  aggregateId = AGGREGATE_ID,
) {
  return {
    workspace_id: WORKSPACE_ID,
    local_date: DATE,
    aggregate_id: aggregateId,
    revision_token: revision,
    payload_json: payload(title),
  };
}

function replayRow(
  digest = REQUEST_DIGEST,
  resultKind = 'created',
  revision = REVISION,
  title = 'Original response',
) {
  return {
    request_digest: digest,
    result_kind: resultKind,
    aggregate_id: AGGREGATE_ID,
    revision_token: revision,
    payload_json: payload(title),
  };
}

function command(
  precondition: TodayWriteCommand['precondition'] = {
    kind: 'match',
    revision: REVISION,
  },
): TodayWriteCommand {
  return {
    workspaceId: WORKSPACE_ID,
    draft: payload() as TodayWriteCommand['draft'],
    precondition,
    idempotencyKey: IDEMPOTENCY_KEY,
    requestDigest: REQUEST_DIGEST,
    newAggregateId: AGGREGATE_ID,
    newRevision: NEW_REVISION,
  };
}

describe('PostgresTodayRepository', () => {
  it('reads only one workspace/date aggregate and validates durable output', async () => {
    const client = new RecordingClient([[aggregateRow()]]);
    const repository = new PostgresTodayRepository(client);

    await expect(repository.getToday(WORKSPACE_ID, DATE)).resolves.toEqual({
      ...payload(),
      aggregateId: AGGREGATE_ID,
      revision: REVISION,
    });
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, DATE]);
    expect(client.calls[0]?.text).toContain('workspace_id = $1::uuid');
    expect(client.calls[0]?.text).toContain('local_date = $2::date');
    expect(client.calls[0]?.text).toContain('LIMIT 2');
  });

  it('locks aggregate then idempotency key before an optimistic update', async () => {
    const client = new RecordingClient([
      [],
      [],
      [],
      [aggregateRow()],
      [aggregateRow(NEW_REVISION)],
      [{ stored: true }],
    ]);
    const repository = new PostgresTodayRepository(client);

    await expect(repository.writeToday(command())).resolves.toEqual({
      kind: 'updated',
      aggregate: {
        ...payload(),
        aggregateId: AGGREGATE_ID,
        revision: NEW_REVISION,
      },
    });
    expect(client.transactionCalls).toBe(1);
    expect(client.calls).toHaveLength(6);
    expect(client.calls[0]?.text).toContain('pg_advisory_xact_lock');
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, DATE]);
    expect(client.calls[1]?.text).toContain('pg_advisory_xact_lock');
    expect(client.calls[1]?.values).toEqual([WORKSPACE_ID, IDEMPOTENCY_KEY]);
    expect(client.calls[2]?.text).toContain('today_idempotency_records');
    expect(client.calls[3]?.text).toContain('today_aggregates');
    expect(client.calls[4]?.text).toContain('UPDATE planning.today_aggregates');
    expect(client.calls[5]?.text).toContain(
      'INSERT INTO planning.today_idempotency_records',
    );
    expect(client.calls.every((call) => !call.text.includes('Durable Today'))).toBe(
      true,
    );
  });

  it('creates an absent aggregate after the same ordered locks', async () => {
    const client = new RecordingClient([
      [],
      [],
      [],
      [],
      [aggregateRow(NEW_REVISION)],
      [{ stored: true }],
    ]);
    const repository = new PostgresTodayRepository(client);

    await expect(
      repository.writeToday(command({ kind: 'absent' })),
    ).resolves.toMatchObject({ kind: 'created' });
    expect(client.calls[4]?.text).toContain('INSERT INTO planning.today_aggregates');
  });

  it('returns the original response for an exact idempotent replay', async () => {
    const client = new RecordingClient([[], [], [replayRow()]]);
    const repository = new PostgresTodayRepository(client);

    await expect(repository.writeToday(command())).resolves.toEqual({
      kind: 'replayed',
      aggregate: {
        ...payload('Original response'),
        aggregateId: AGGREGATE_ID,
        revision: REVISION,
      },
    });
    expect(client.calls).toHaveLength(3);
  });

  it('fails closed when an idempotency key is reused for a different request', async () => {
    const client = new RecordingClient([
      [],
      [],
      [replayRow('b'.repeat(64))],
    ]);
    const repository = new PostgresTodayRepository(client);

    await expect(repository.writeToday(command())).rejects.toBeInstanceOf(
      TodayIdempotencyConflictError,
    );
  });

  it('fails closed on stale or missing optimistic revisions', async () => {
    const stale = new PostgresTodayRepository(
      new RecordingClient([[], [], [], [aggregateRow(NEW_REVISION)]]),
    );
    const missing = new PostgresTodayRepository(
      new RecordingClient([[], [], [], []]),
    );

    await expect(stale.writeToday(command())).rejects.toEqual(
      new TodayRevisionConflictError(NEW_REVISION),
    );
    await expect(missing.writeToday(command())).rejects.toEqual(
      new TodayRevisionConflictError(null),
    );
  });

  it('rejects create-if-absent when an aggregate already exists', async () => {
    const repository = new PostgresTodayRepository(
      new RecordingClient([[], [], [], [aggregateRow()]]),
    );

    await expect(
      repository.writeToday(command({ kind: 'absent' })),
    ).rejects.toEqual(new TodayRevisionConflictError(REVISION));
  });

  it('fails closed when mutation or replay persistence does not produce one row', async () => {
    const missingMutation = new PostgresTodayRepository(
      new RecordingClient([[], [], [], [aggregateRow()], []]),
    );
    const missingReplayReceipt = new PostgresTodayRepository(
      new RecordingClient([
        [],
        [],
        [],
        [aggregateRow()],
        [aggregateRow(NEW_REVISION)],
        [],
      ]),
    );

    await expect(missingMutation.writeToday(command())).rejects.toEqual(
      new TodayRevisionConflictError(REVISION),
    );
    await expect(missingReplayReceipt.writeToday(command())).rejects.toBeInstanceOf(
      TodayPersistenceError,
    );
  });

  it('rejects malformed replay kinds and malformed or duplicate durable rows', async () => {
    const malformedReplay = new PostgresTodayRepository(
      new RecordingClient([[], [], [replayRow(REQUEST_DIGEST, 'invalid')]]),
    );
    const malformed = aggregateRow();
    malformed.aggregate_id = 'not-a-uuid';
    const duplicate = aggregateRow();
    const malformedRepository = new PostgresTodayRepository(
      new RecordingClient([[malformed]]),
    );
    const duplicateRepository = new PostgresTodayRepository(
      new RecordingClient([[duplicate, duplicate]]),
    );

    await expect(malformedReplay.writeToday(command())).rejects.toBeInstanceOf(
      TodayPersistenceError,
    );
    await expect(
      malformedRepository.getToday(WORKSPACE_ID, DATE),
    ).rejects.toBeInstanceOf(TodayPersistenceError);
    await expect(
      duplicateRepository.getToday(WORKSPACE_ID, DATE),
    ).rejects.toBeInstanceOf(TodayPersistenceError);
  });
});
