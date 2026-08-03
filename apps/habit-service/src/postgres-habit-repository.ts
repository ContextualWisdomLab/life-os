import type {
  Habit,
  HabitCompletionEvent,
  HabitRecurrence,
  HabitRepository,
  IsoWeekday,
} from './habit-domain';

/** Minimal query result contract used by the Habit PostgreSQL adapter. */
export interface HabitSqlQueryResult<Row> {
  rows: Row[];
}

/** Parameterized SQL client boundary used by the Habit repository. */
export interface HabitSqlClient {
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>>;
}

interface HabitRow {
  id: unknown;
  workspace_id: unknown;
  title: unknown;
  timezone_name: unknown;
  recurrence_kind: unknown;
  recurrence_interval: unknown;
  weekday_mask: unknown;
  starts_on: unknown;
  created_at: unknown;
}

interface CompletionRow {
  id: unknown;
  workspace_id: unknown;
  habit_id: unknown;
  scheduled_local_date: unknown;
  completed_at: unknown;
  idempotency_key: unknown;
  recorded_at: unknown;
}

interface PostgreSqlErrorShape {
  code?: unknown;
  constraint?: unknown;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const IDEMPOTENCY_CONSTRAINT = 'completion_events_idempotency_unique';

/** Safe public failure for malformed rows and database transport errors. */
export class HabitPersistenceError extends Error {
  constructor() {
    super('Habit persistence operation failed');
    this.name = 'HabitPersistenceError';
  }
}

/** Signals that one idempotency key was reused with a different payload. */
export class HabitIdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key reused with a different completion payload');
    this.name = 'HabitIdempotencyConflictError';
  }
}

function invalidRow(): never {
  throw new HabitPersistenceError();
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidRow();
  }
  return value.toLowerCase();
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return invalidRow();
  }
  return value;
}

function requireTimezone(value: unknown): string {
  const timezone = requireText(value);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    return invalidRow();
  }
  return timezone;
}

function requireLocalDate(value: unknown): string {
  const text =
    value instanceof Date
      ? Number.isNaN(value.getTime())
        ? invalidRow()
        : value.toISOString().slice(0, 10)
      : value;
  if (typeof text !== 'string') {
    return invalidRow();
  }
  const match = LOCAL_DATE_PATTERN.exec(text);
  if (!match) {
    return invalidRow();
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return invalidRow();
  }
  return text;
}

function requireTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return invalidRow();
    }
    return value.toISOString();
  }
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    return invalidRow();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return invalidRow();
  }
  return parsed.toISOString();
}

function requireInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidRow();
  }
  return value;
}

function requireExpected(actual: string, expected: string): void {
  if (actual !== expected.toLowerCase()) {
    invalidRow();
  }
}

function encodeWeekdayMask(weekdays: readonly IsoWeekday[]): number {
  if (weekdays.length === 0) {
    return invalidRow();
  }
  let mask = 0;
  for (const weekday of weekdays) {
    const safeWeekday = requireInteger(weekday, 1, 7);
    mask |= 1 << (safeWeekday - 1);
  }
  return mask;
}

function decodeWeekdayMask(value: unknown): readonly IsoWeekday[] {
  const mask = requireInteger(value, 1, 127);
  const weekdays: IsoWeekday[] = [];
  for (let weekday = 1; weekday <= 7; weekday += 1) {
    if ((mask & (1 << (weekday - 1))) !== 0) {
      weekdays.push(weekday as IsoWeekday);
    }
  }
  return weekdays;
}

function decodeRecurrence(
  kind: unknown,
  intervalValue: unknown,
  weekdayMask: unknown,
): HabitRecurrence {
  const interval = requireInteger(intervalValue, 1, 365);
  if (kind === 'daily') {
    if (weekdayMask !== 0) {
      return invalidRow();
    }
    return { kind, interval };
  }
  if (kind === 'weekly') {
    return {
      kind,
      interval,
      weekdays: decodeWeekdayMask(weekdayMask),
    };
  }
  return invalidRow();
}

function recurrenceValues(recurrence: HabitRecurrence): {
  kind: HabitRecurrence['kind'];
  interval: number;
  weekdayMask: number;
} {
  const interval = requireInteger(recurrence.interval, 1, 365);
  if (recurrence.kind === 'daily') {
    return { kind: recurrence.kind, interval, weekdayMask: 0 };
  }
  if (recurrence.kind === 'weekly') {
    return {
      kind: recurrence.kind,
      interval,
      weekdayMask: encodeWeekdayMask(recurrence.weekdays),
    };
  }
  return invalidRow();
}

function parseHabit(
  row: HabitRow,
  expectedWorkspaceId?: string,
  expectedId?: string,
): Habit {
  const habit: Habit = {
    id: requireUuidV4(row.id),
    workspaceId: requireUuidV4(row.workspace_id),
    title: requireText(row.title),
    timezone: requireTimezone(row.timezone_name),
    startsOn: requireLocalDate(row.starts_on),
    recurrence: decodeRecurrence(
      row.recurrence_kind,
      row.recurrence_interval,
      row.weekday_mask,
    ),
    createdAt: requireTimestamp(row.created_at),
  };
  if (expectedWorkspaceId) {
    requireExpected(habit.workspaceId, expectedWorkspaceId);
  }
  if (expectedId) {
    requireExpected(habit.id, expectedId);
  }
  return habit;
}

function parseCompletion(
  row: CompletionRow,
  expectedWorkspaceId?: string,
  expectedHabitId?: string,
  expectedIdempotencyKey?: string,
): HabitCompletionEvent {
  const completion: HabitCompletionEvent = {
    id: requireUuidV4(row.id),
    workspaceId: requireUuidV4(row.workspace_id),
    habitId: requireUuidV4(row.habit_id),
    scheduledLocalDate: requireLocalDate(row.scheduled_local_date),
    completedAt: requireTimestamp(row.completed_at),
    idempotencyKey: requireUuidV4(row.idempotency_key),
    recordedAt: requireTimestamp(row.recorded_at),
  };
  if (expectedWorkspaceId) {
    requireExpected(completion.workspaceId, expectedWorkspaceId);
  }
  if (expectedHabitId) {
    requireExpected(completion.habitId, expectedHabitId);
  }
  if (expectedIdempotencyKey) {
    requireExpected(completion.idempotencyKey, expectedIdempotencyKey);
  }
  return completion;
}

function validateHabit(habit: Habit): Habit {
  const recurrence = recurrenceValues(habit.recurrence);
  return parseHabit({
    id: habit.id,
    workspace_id: habit.workspaceId,
    title: habit.title,
    timezone_name: habit.timezone,
    recurrence_kind: recurrence.kind,
    recurrence_interval: recurrence.interval,
    weekday_mask: recurrence.weekdayMask,
    starts_on: habit.startsOn,
    created_at: habit.createdAt,
  });
}

function validateCompletion(
  completion: HabitCompletionEvent,
): HabitCompletionEvent {
  return parseCompletion({
    id: completion.id,
    workspace_id: completion.workspaceId,
    habit_id: completion.habitId,
    scheduled_local_date: completion.scheduledLocalDate,
    completed_at: completion.completedAt,
    idempotency_key: completion.idempotencyKey,
    recorded_at: completion.recordedAt,
  });
}

function oneOrUndefined<Row>(rows: Row[]): Row | undefined {
  if (rows.length > 1) {
    invalidRow();
  }
  return rows[0];
}

function exactlyOne<Row>(rows: Row[]): Row {
  const row = oneOrUndefined(rows);
  return row ?? invalidRow();
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as PostgreSqlErrorShape;
  return (
    candidate.code === '23505' &&
    candidate.constraint === IDEMPOTENCY_CONSTRAINT
  );
}

function ensureReplayMatches(
  persisted: HabitCompletionEvent,
  attempted: HabitCompletionEvent,
): void {
  if (
    persisted.scheduledLocalDate !== attempted.scheduledLocalDate ||
    persisted.completedAt !== attempted.completedAt
  ) {
    throw new HabitIdempotencyConflictError();
  }
}

/** Parameterized, tenant-scoped PostgreSQL Habit repository. */
export class PostgresHabitRepository implements HabitRepository {
  constructor(private readonly client: HabitSqlClient) {}

  private async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      throw new HabitPersistenceError();
    }
  }

  async saveHabit(habit: Habit): Promise<void> {
    const safe = validateHabit(habit);
    const recurrence = recurrenceValues(safe.recurrence);
    await this.query(
      `INSERT INTO habit.habit_definitions
        (id, workspace_id, title, timezone_name, recurrence_kind,
         recurrence_interval, weekday_mask, starts_on, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        safe.id,
        safe.workspaceId,
        safe.title,
        safe.timezone,
        recurrence.kind,
        recurrence.interval,
        recurrence.weekdayMask,
        safe.startsOn,
        safe.createdAt,
      ],
    );
  }

  async findHabit(
    workspaceId: string,
    habitId: string,
  ): Promise<Habit | undefined> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeHabitId = requireUuidV4(habitId);
    const result = await this.query<HabitRow>(
      `SELECT id, workspace_id, title, timezone_name, recurrence_kind,
              recurrence_interval, weekday_mask, starts_on, created_at
       FROM habit.habit_definitions
       WHERE workspace_id = $1 AND id = $2
       LIMIT 2`,
      [safeWorkspaceId, safeHabitId],
    );
    const row = oneOrUndefined(result.rows);
    return row ? parseHabit(row, safeWorkspaceId, safeHabitId) : undefined;
  }

  async listHabits(workspaceId: string): Promise<Habit[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const result = await this.query<HabitRow>(
      `SELECT id, workspace_id, title, timezone_name, recurrence_kind,
              recurrence_interval, weekday_mask, starts_on, created_at
       FROM habit.habit_definitions
       WHERE workspace_id = $1
       ORDER BY created_at ASC, id ASC`,
      [safeWorkspaceId],
    );
    return result.rows.map((row) => parseHabit(row, safeWorkspaceId));
  }

  async appendCompletion(
    completion: HabitCompletionEvent,
  ): Promise<HabitCompletionEvent> {
    const safe = validateCompletion(completion);
    let inserted: HabitSqlQueryResult<CompletionRow> | undefined;
    try {
      inserted = await this.client.query<CompletionRow>(
        `INSERT INTO habit.completion_events
          (id, workspace_id, habit_id, scheduled_local_date, completed_at,
           idempotency_key, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, workspace_id, habit_id, scheduled_local_date,
                   completed_at, idempotency_key, recorded_at`,
        [
          safe.id,
          safe.workspaceId,
          safe.habitId,
          safe.scheduledLocalDate,
          safe.completedAt,
          safe.idempotencyKey,
          safe.recordedAt,
        ],
      );
    } catch (error) {
      if (!isIdempotencyUniqueViolation(error)) {
        throw new HabitPersistenceError();
      }
    }

    if (inserted) {
      return parseCompletion(
        exactlyOne(inserted.rows),
        safe.workspaceId,
        safe.habitId,
        safe.idempotencyKey,
      );
    }

    const replay = await this.query<CompletionRow>(
      `SELECT id, workspace_id, habit_id, scheduled_local_date,
              completed_at, idempotency_key, recorded_at
       FROM habit.completion_events
       WHERE workspace_id = $1
         AND habit_id = $2
         AND idempotency_key = $3
       LIMIT 2`,
      [safe.workspaceId, safe.habitId, safe.idempotencyKey],
    );
    const persisted = parseCompletion(
      exactlyOne(replay.rows),
      safe.workspaceId,
      safe.habitId,
      safe.idempotencyKey,
    );
    ensureReplayMatches(persisted, safe);
    return persisted;
  }

  async listCompletions(
    workspaceId: string,
    habitId: string,
  ): Promise<HabitCompletionEvent[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeHabitId = requireUuidV4(habitId);
    const result = await this.query<CompletionRow>(
      `SELECT id, workspace_id, habit_id, scheduled_local_date,
              completed_at, idempotency_key, recorded_at
       FROM habit.completion_events
       WHERE workspace_id = $1 AND habit_id = $2
       ORDER BY recorded_at ASC, id ASC`,
      [safeWorkspaceId, safeHabitId],
    );
    return result.rows.map((row) =>
      parseCompletion(row, safeWorkspaceId, safeHabitId),
    );
  }
}
