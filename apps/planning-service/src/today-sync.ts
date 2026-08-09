import { createHash, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const RFC_3339_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const MAXIMUM_ACTIONS = 50;
const MAXIMUM_TITLE_CODE_POINTS = 160;
const MAXIMUM_TITLE_BYTES = 1024;
const MINIMUM_DURATION_MINUTES = 15;
const MAXIMUM_DURATION_MINUTES = 240;
const MINUTES_PER_DAY = 24 * 60;
const TODAY_VERSION = 'life-os.today.v1' as const;

/** Durable action state stored inside one workspace/date Today aggregate. */
export interface DurableTodayAction {
  readonly id: string;
  readonly title: string;
  readonly status: 'open' | 'done';
  readonly priority: 1 | 2 | 3 | null;
  readonly startMinute: number | null;
  readonly durationMinutes: number | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

/** Client-supplied complete Today state before server-owned identity/revision fields. */
export interface DurableTodayDraft {
  readonly version: typeof TODAY_VERSION;
  readonly date: string;
  readonly actions: readonly DurableTodayAction[];
}

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

/** Requires a canonical UUIDv4 identifier and lowercases it. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new TodayValidationError();
  }
  return value.toLowerCase();
}

/** Requires a real Gregorian calendar date in canonical YYYY-MM-DD form. */
function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new TodayValidationError();
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TodayValidationError();
  }
  return value;
}

/** Requires one bounded user-visible action title. */
function requireTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TodayValidationError();
  }
  const normalized = value.trim();
  if (
    !normalized ||
    [...normalized].length > MAXIMUM_TITLE_CODE_POINTS ||
    Buffer.byteLength(normalized, 'utf8') > MAXIMUM_TITLE_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) {
    throw new TodayValidationError();
  }
  return normalized;
}

/** Requires a canonical UTC RFC3339 instant. */
function requireInstant(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_UTC_PATTERN.test(value)) {
    throw new TodayValidationError();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TodayValidationError();
  }
  return parsed.toISOString();
}

/** Requires a nullable quarter-hour schedule start. */
function requireStartMinute(value: unknown): number | null {
  if (value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= MINUTES_PER_DAY ||
    (value as number) % 15 !== 0
  ) {
    throw new TodayValidationError();
  }
  return value as number;
}

/** Requires a nullable bounded quarter-hour duration. */
function requireDuration(value: unknown): number | null {
  if (value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < MINIMUM_DURATION_MINUTES ||
    (value as number) > MAXIMUM_DURATION_MINUTES ||
    (value as number) % 15 !== 0
  ) {
    throw new TodayValidationError();
  }
  return value as number;
}

/** Validates one action and returns a canonical immutable representation. */
function requireAction(value: unknown): DurableTodayAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TodayValidationError();
  }
  const action = value as Record<string, unknown>;
  const exactKeys = [
    'id',
    'title',
    'status',
    'priority',
    'startMinute',
    'durationMinutes',
    'createdAt',
    'completedAt',
  ];
  if (
    Object.keys(action).length !== exactKeys.length ||
    exactKeys.some((key) => !Object.hasOwn(action, key))
  ) {
    throw new TodayValidationError();
  }
  const status = action.status;
  if (status !== 'open' && status !== 'done') {
    throw new TodayValidationError();
  }
  const priority = action.priority;
  if (priority !== null && priority !== 1 && priority !== 2 && priority !== 3) {
    throw new TodayValidationError();
  }
  const startMinute = requireStartMinute(action.startMinute);
  const durationMinutes = requireDuration(action.durationMinutes);
  if ((startMinute === null) !== (durationMinutes === null)) {
    throw new TodayValidationError();
  }
  if (
    startMinute !== null &&
    durationMinutes !== null &&
    startMinute + durationMinutes > MINUTES_PER_DAY
  ) {
    throw new TodayValidationError();
  }
  const completedAt =
    action.completedAt === null ? null : requireInstant(action.completedAt);
  if (
    (status === 'done' && completedAt === null) ||
    (status === 'open' && completedAt !== null)
  ) {
    throw new TodayValidationError();
  }
  return Object.freeze({
    id: requireUuidV4(action.id),
    title: requireTitle(action.title),
    status,
    priority,
    startMinute,
    durationMinutes,
    createdAt: requireInstant(action.createdAt),
    completedAt,
  });
}

/** Enforces duplicate, priority and overlapping-open-schedule invariants. */
function requireActionSet(values: unknown): readonly DurableTodayAction[] {
  if (!Array.isArray(values) || values.length > MAXIMUM_ACTIONS) {
    throw new TodayValidationError();
  }
  const actions = values.map(requireAction);
  const identifiers = new Set<string>();
  const priorities = new Set<number>();
  for (const action of actions) {
    if (identifiers.has(action.id)) {
      throw new TodayValidationError();
    }
    identifiers.add(action.id);
    if (action.priority !== null) {
      if (priorities.has(action.priority)) {
        throw new TodayValidationError();
      }
      priorities.add(action.priority);
    }
  }
  const scheduled = actions
    .filter(
      (action) =>
        action.status === 'open' &&
        action.startMinute !== null &&
        action.durationMinutes !== null,
    )
    .sort(
      (left, right) =>
        (left.startMinute ?? 0) - (right.startMinute ?? 0) ||
        left.id.localeCompare(right.id),
    );
  for (let index = 1; index < scheduled.length; index += 1) {
    const previous = scheduled[index - 1];
    const current = scheduled[index];
    if (
      previous &&
      current &&
      (previous.startMinute ?? 0) + (previous.durationMinutes ?? 0) >
        (current.startMinute ?? 0)
    ) {
      throw new TodayValidationError();
    }
  }
  return Object.freeze(actions);
}

/** Validates one complete client Today document. */
function requireDraft(value: unknown): DurableTodayDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TodayValidationError();
  }
  const draft = value as Record<string, unknown>;
  if (
    Object.keys(draft).length !== 3 ||
    draft.version !== TODAY_VERSION ||
    !Object.hasOwn(draft, 'date') ||
    !Object.hasOwn(draft, 'actions')
  ) {
    throw new TodayValidationError();
  }
  return Object.freeze({
    version: TODAY_VERSION,
    date: requireDate(draft.date),
    actions: requireActionSet(draft.actions),
  });
}

/** Validates the initial-creation or exact-revision write condition. */
function requirePrecondition(value: TodayWritePrecondition): TodayWritePrecondition {
  if (value.kind === 'absent') {
    return Object.freeze({ kind: 'absent' });
  }
  if (value.kind === 'match') {
    return Object.freeze({ kind: 'match', revision: requireUuidV4(value.revision) });
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
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeDate = requireDate(date);
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
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeDraft = requireDraft(draft);
    const safePrecondition = requirePrecondition(precondition);
    const safeIdempotencyKey = requireUuidV4(idempotencyKey);
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
