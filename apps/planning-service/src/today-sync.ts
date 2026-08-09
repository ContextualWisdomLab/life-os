import { createHash, randomUUID } from 'node:crypto';
import {
  TODAY_VERSION,
  canonicalTodayDate,
  canonicalTodayDraft,
  canonicalTodayUuidV4,
  type DurableTodayAction,
  type DurableTodayDraft,
} from './today-invariants';

export type { DurableTodayAction, DurableTodayDraft } from './today-invariants';

/** Server-owned durable Today aggregate returned to authenticated callers. */
export interface DurableTodayAggregate extends DurableTodayDraft {
  readonly aggregateId: string;
  readonly revision: string;
}

/** Write precondition for initial creation or exact-revision replacement. */
export type TodayWritePrecondition =
  | { readonly kind: 'absent' }
  | { readonly kind: 'match'; readonly revision: string };

/** Result of a durable Today write, including exact idempotent replay. */
export interface TodayWriteResult {
  readonly kind: 'created' | 'updated' | 'replayed';
  readonly aggregate: DurableTodayAggregate;
}

/** Stable validation failure for malformed or self-inconsistent Today state. */
export class TodayValidationError extends Error {
  /** Creates a credential-free validation error. */
  constructor() {
    super('Today synchronization request is invalid');
    this.name = 'TodayValidationError';
  }
}

/** Stable failure when durable Today rows violate repository invariants. */
export class TodayPersistenceError extends Error {
  /** Creates a credential-free persistence validation failure. */
  constructor() {
    super('Persisted Today data is invalid');
    this.name = 'TodayPersistenceError';
  }
}

/** Optimistic-concurrency failure exposing only the current opaque revision token. */
export class TodayRevisionConflictError extends Error {
  /** Creates a stale-write conflict without returning server-side content. */
  constructor(readonly currentRevision: string | null) {
    super('Today revision does not match');
    this.name = 'TodayRevisionConflictError';
  }
}

/** Idempotency-key reuse failure when the same key is bound to another request. */
export class TodayIdempotencyConflictError extends Error {
  /** Creates a fixed non-sensitive idempotency conflict. */
  constructor() {
    super('Today idempotency key was already used for a different request');
    this.name = 'TodayIdempotencyConflictError';
  }
}

/** Persistence command containing only fully validated values. */
export interface TodayWriteCommand {
  readonly workspaceId: string;
  readonly draft: DurableTodayDraft;
  readonly precondition: TodayWritePrecondition;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly newAggregateId: string;
  readonly newRevision: string;
}

/** Persistence boundary for one durable Today aggregate per workspace/local date. */
export interface TodayRepository {
  /** Returns the exact workspace/date aggregate or no record. */
  getToday(
    workspaceId: string,
    date: string,
  ): Promise<DurableTodayAggregate | undefined>;
  /** Atomically applies one validated optimistic/idempotent write command. */
  writeToday(command: TodayWriteCommand): Promise<TodayWriteResult>;
}

interface IdempotencyRecord {
  readonly requestDigest: string;
  readonly result: TodayWriteResult;
}

/** Throws the domain validation error expected by shared invariant helpers. */
function invalidTodayInput(): never {
  throw new TodayValidationError();
}

/** In-memory adapter used by deterministic domain tests. */
export class InMemoryTodayRepository implements TodayRepository {
  private readonly aggregates = new Map<string, DurableTodayAggregate>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  /** Reads only the requested workspace/date key. */
  async getToday(
    workspaceId: string,
    date: string,
  ): Promise<DurableTodayAggregate | undefined> {
    return this.aggregates.get(aggregateKey(workspaceId, date));
  }

  /** Applies replay detection and optimistic concurrency as one in-memory operation. */
  async writeToday(command: TodayWriteCommand): Promise<TodayWriteResult> {
    const replayKey = `${command.workspaceId}\n${command.idempotencyKey}`;
    const replay = this.idempotency.get(replayKey);
    if (replay) {
      if (replay.requestDigest !== command.requestDigest) {
        throw new TodayIdempotencyConflictError();
      }
      return { kind: 'replayed', aggregate: replay.result.aggregate };
    }

    const key = aggregateKey(command.workspaceId, command.draft.date);
    const current = this.aggregates.get(key);
    if (command.precondition.kind === 'absent') {
      if (current) {
        throw new TodayRevisionConflictError(current.revision);
      }
    } else if (!current || current.revision !== command.precondition.revision) {
      throw new TodayRevisionConflictError(current?.revision ?? null);
    }

    const aggregate: DurableTodayAggregate = Object.freeze({
      version: TODAY_VERSION,
      aggregateId: current?.aggregateId ?? command.newAggregateId,
      revision: command.newRevision,
      date: command.draft.date,
      actions: command.draft.actions,
    });
    const result: TodayWriteResult = {
      kind: current ? 'updated' : 'created',
      aggregate,
    };
    this.aggregates.set(key, aggregate);
    this.idempotency.set(replayKey, {
      requestDigest: command.requestDigest,
      result,
    });
    return result;
  }
}

/** Validates the initial-creation or exact-revision write condition. */
function requirePrecondition(
  value: TodayWritePrecondition,
): TodayWritePrecondition {
  if (value.kind === 'absent') {
    return Object.freeze({ kind: 'absent' });
  }
  if (value.kind === 'match') {
    return Object.freeze({
      kind: 'match',
      revision: canonicalTodayUuidV4(value.revision, invalidTodayInput),
    });
  }
  throw new TodayValidationError();
}

/** Builds a stable aggregate key without exposing it outside the adapter. */
function aggregateKey(workspaceId: string, date: string): string {
  return `${workspaceId}\n${date}`;
}

/** Hashes the canonical validated request for idempotency-key binding. */
function requestDigest(
  workspaceId: string,
  draft: DurableTodayDraft,
  precondition: TodayWritePrecondition,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        draft,
        precondition,
      }),
      'utf8',
    )
    .digest('hex');
}

/** Coordinates validated tenant-scoped optimistic Today synchronization. */
export class TodaySyncService {
  /** Creates the service over one persistence adapter. */
  constructor(private readonly repository: TodayRepository) {}

  /** Returns one durable Today aggregate without crossing workspace ownership. */
  async getToday(
    workspaceId: string,
    date: string,
  ): Promise<DurableTodayAggregate | undefined> {
    const safeWorkspaceId = canonicalTodayUuidV4(
      workspaceId,
      invalidTodayInput,
    );
    const safeDate = canonicalTodayDate(date, invalidTodayInput);
    const aggregate = await this.repository.getToday(safeWorkspaceId, safeDate);
    if (!aggregate) return undefined;
    if (aggregate.date !== safeDate) {
      throw new TodayValidationError();
    }
    return aggregate;
  }

  /** Creates or replaces a complete Today aggregate with replay and stale-write safety. */
  async putToday(
    workspaceId: string,
    draft: unknown,
    precondition: TodayWritePrecondition,
    idempotencyKey: string,
  ): Promise<TodayWriteResult> {
    const safeWorkspaceId = canonicalTodayUuidV4(
      workspaceId,
      invalidTodayInput,
    );
    const safeDraft = canonicalTodayDraft(draft, invalidTodayInput);
    const safePrecondition = requirePrecondition(precondition);
    const safeIdempotencyKey = canonicalTodayUuidV4(
      idempotencyKey,
      invalidTodayInput,
    );
    return await this.repository.writeToday({
      workspaceId: safeWorkspaceId,
      draft: safeDraft,
      precondition: safePrecondition,
      idempotencyKey: safeIdempotencyKey,
      requestDigest: requestDigest(
        safeWorkspaceId,
        safeDraft,
        safePrecondition,
      ),
      newAggregateId: randomUUID(),
      newRevision: randomUUID(),
    });
  }
}
