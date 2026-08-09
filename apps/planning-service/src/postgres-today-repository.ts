import type {
  PlanningSqlClient,
  PlanningSqlQueryResult,
} from './postgres-planning-repository';
import {
  canonicalTodayDate,
  canonicalTodayDraft,
  canonicalTodayUuidV4,
} from './today-invariants';
import {
  TodayIdempotencyConflictError,
  TodayPersistenceError,
  TodayRevisionConflictError,
  type DurableTodayAggregate,
  type TodayRepository,
  type TodayWriteCommand,
  type TodayWriteResult,
} from './today-sync';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

interface TodayAggregateRow {
  workspace_id: unknown;
  local_date: unknown;
  aggregate_id: unknown;
  revision_token: unknown;
  payload_json: unknown;
}

interface TodayReplayRow {
  request_digest: unknown;
  result_kind: unknown;
  aggregate_id: unknown;
  revision_token: unknown;
  payload_json: unknown;
}

/** SQL client that can pin a sequence of statements to one database transaction. */
export interface TodayTransactionalSqlClient extends PlanningSqlClient {
  transaction<Result>(
    operation: (client: PlanningSqlClient) => Promise<Result>,
  ): Promise<Result>;
}

/** Rejects malformed persisted data without returning its contents. */
function invalidPersistence(): never {
  throw new TodayPersistenceError();
}

/** Parses a persistence row into the public aggregate while enforcing ownership. */
function parseAggregateRow(
  row: TodayAggregateRow,
  expectedWorkspaceId: string,
  expectedDate: string,
): DurableTodayAggregate {
  const workspaceId = canonicalTodayUuidV4(
    row.workspace_id,
    invalidPersistence,
  );
  if (workspaceId !== expectedWorkspaceId.toLowerCase()) {
    return invalidPersistence();
  }
  const date = canonicalTodayDate(row.local_date, invalidPersistence, true);
  if (date !== expectedDate) {
    return invalidPersistence();
  }
  const draft = canonicalTodayDraft(
    row.payload_json,
    invalidPersistence,
    expectedDate,
  );
  return Object.freeze({
    ...draft,
    aggregateId: canonicalTodayUuidV4(row.aggregate_id, invalidPersistence),
    revision: canonicalTodayUuidV4(row.revision_token, invalidPersistence),
  });
}

/** Accepts at most one durable row for a unique lookup. */
function oneOrUndefined<Row>(rows: Row[]): Row | undefined {
  if (rows.length > 1) return invalidPersistence();
  return rows[0];
}

/** Requires one stored idempotency result kind. */
function requireStoredResultKind(value: unknown): 'created' | 'updated' {
  if (value !== 'created' && value !== 'updated') return invalidPersistence();
  return value;
}

/** Requires a stored request digest without accepting arbitrary text. */
function requireDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    return invalidPersistence();
  }
  return value;
}

/** Builds a public aggregate from one stored idempotency row. */
function parseReplayAggregate(
  row: TodayReplayRow,
  command: TodayWriteCommand,
): DurableTodayAggregate {
  requireStoredResultKind(row.result_kind);
  return parseAggregateRow(
    {
      workspace_id: command.workspaceId,
      local_date: command.draft.date,
      aggregate_id: row.aggregate_id,
      revision_token: row.revision_token,
      payload_json: row.payload_json,
    },
    command.workspaceId,
    command.draft.date,
  );
}

/** PostgreSQL adapter for atomic, tenant-scoped durable Today synchronization. */
export class PostgresTodayRepository implements TodayRepository {
  /** Creates the adapter over a transaction-capable planning SQL client. */
  constructor(private readonly client: TodayTransactionalSqlClient) {}

  /** Reads at most one aggregate from exactly one workspace and local date. */
  async getToday(
    workspaceId: string,
    date: string,
  ): Promise<DurableTodayAggregate | undefined> {
    const normalizedWorkspaceId = canonicalTodayUuidV4(
      workspaceId,
      invalidPersistence,
    );
    const normalizedDate = canonicalTodayDate(date, invalidPersistence);
    const result = await this.client.query<TodayAggregateRow>(
      `SELECT workspace_id, local_date, aggregate_id, revision_token, payload_json
       FROM planning.today_aggregates
       WHERE workspace_id = $1::uuid AND local_date = $2::date
       LIMIT 2`,
      [normalizedWorkspaceId, normalizedDate],
    );
    const row = oneOrUndefined(result.rows);
    return row
      ? parseAggregateRow(row, normalizedWorkspaceId, normalizedDate)
      : undefined;
  }

  /**
   * Acquires aggregate and idempotency locks as separate statements on one
   * dedicated transaction. Any statement that waits for a lock therefore takes
   * its READ COMMITTED snapshot only after the wait completes.
   */
  async writeToday(command: TodayWriteCommand): Promise<TodayWriteResult> {
    return await this.client.transaction(async (transaction) => {
      await transaction.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1::text || ':' || $2::text, 0)
         )`,
        [command.workspaceId, command.draft.date],
      );
      await transaction.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1::text || ':' || $2::text, 1)
         )`,
        [command.workspaceId, command.idempotencyKey],
      );

      const replayResult = await transaction.query<TodayReplayRow>(
        `SELECT request_digest, result_kind, aggregate_id, revision_token, payload_json
         FROM planning.today_idempotency_records
         WHERE workspace_id = $1::uuid AND idempotency_key = $2::uuid
         LIMIT 2`,
        [command.workspaceId, command.idempotencyKey],
      );
      const replay = oneOrUndefined(replayResult.rows);
      if (replay) {
        if (requireDigest(replay.request_digest) !== command.requestDigest) {
          throw new TodayIdempotencyConflictError();
        }
        return {
          kind: 'replayed',
          aggregate: parseReplayAggregate(replay, command),
        };
      }

      const currentResult = await transaction.query<TodayAggregateRow>(
        `SELECT workspace_id, local_date, aggregate_id, revision_token, payload_json
         FROM planning.today_aggregates
         WHERE workspace_id = $1::uuid AND local_date = $2::date
         LIMIT 2`,
        [command.workspaceId, command.draft.date],
      );
      const currentRow = oneOrUndefined(currentResult.rows);
      const current = currentRow
        ? parseAggregateRow(
            currentRow,
            command.workspaceId,
            command.draft.date,
          )
        : undefined;

      if (command.precondition.kind === 'absent') {
        if (current) {
          throw new TodayRevisionConflictError(current.revision);
        }
      } else if (!current || current.revision !== command.precondition.revision) {
        throw new TodayRevisionConflictError(current?.revision ?? null);
      }

      let resultKind: 'created' | 'updated';
      let mutationResult: PlanningSqlQueryResult<TodayAggregateRow>;
      if (command.precondition.kind === 'absent') {
        resultKind = 'created';
        mutationResult = await transaction.query<TodayAggregateRow>(
          `INSERT INTO planning.today_aggregates
             (workspace_id, local_date, aggregate_id, revision_number,
              revision_token, payload_json, created_at, updated_at)
           VALUES ($1::uuid, $2::date, $3::uuid, 1, $4::uuid, $5::jsonb,
                   clock_timestamp(), clock_timestamp())
           RETURNING workspace_id, local_date, aggregate_id, revision_token, payload_json`,
          [
            command.workspaceId,
            command.draft.date,
            command.newAggregateId,
            command.newRevision,
            JSON.stringify(command.draft),
          ],
        );
      } else {
        resultKind = 'updated';
        mutationResult = await transaction.query<TodayAggregateRow>(
          `UPDATE planning.today_aggregates
           SET revision_number = revision_number + 1,
               revision_token = $4::uuid,
               payload_json = $5::jsonb,
               updated_at = clock_timestamp()
           WHERE workspace_id = $1::uuid
             AND local_date = $2::date
             AND revision_token = $3::uuid
           RETURNING workspace_id, local_date, aggregate_id, revision_token, payload_json`,
          [
            command.workspaceId,
            command.draft.date,
            command.precondition.revision,
            command.newRevision,
            JSON.stringify(command.draft),
          ],
        );
      }

      const mutationRow = oneOrUndefined(mutationResult.rows);
      if (!mutationRow) {
        throw new TodayRevisionConflictError(current?.revision ?? null);
      }
      const aggregate = parseAggregateRow(
        mutationRow,
        command.workspaceId,
        command.draft.date,
      );

      const replayInsert = await transaction.query<{ stored: unknown }>(
        `INSERT INTO planning.today_idempotency_records
           (workspace_id, idempotency_key, request_digest, result_kind,
            aggregate_id, revision_token, payload_json, created_at)
         VALUES ($1::uuid, $2::uuid, $3, $4,
                 $5::uuid, $6::uuid, $7::jsonb, clock_timestamp())
         RETURNING TRUE AS stored`,
        [
          command.workspaceId,
          command.idempotencyKey,
          command.requestDigest,
          resultKind,
          aggregate.aggregateId,
          aggregate.revision,
          JSON.stringify(command.draft),
        ],
      );
      if (replayInsert.rows.length !== 1 || replayInsert.rows[0]?.stored !== true) {
        return invalidPersistence();
      }

      return { kind: resultKind, aggregate };
    });
  }
}
