import type {
  Habit,
  HabitCompletionEvent,
  HabitDefinitionRevisionCommand,
  HabitDefinitionRevisionEvidence,
  HabitRecurrence,
  HabitRepository,
  HabitReviewCompletionEvidence,
  HabitReviewDefinitionDayEvidence,
  HabitReviewWeekEvidence,
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

interface ReviewProjectionRow extends HabitRow {
  completion_workspace_id: unknown;
  completion_habit_id: unknown;
  completion_scheduled_local_date: unknown;
}

interface DefinitionDayRow extends HabitRow {
  scheduled_local_date: unknown;
}

interface HabitDefinitionRevisionRow {
  workspace_id: unknown;
  habit_id: unknown;
  revision_number: unknown;
  effective_from_local_date: unknown;
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
const MILLISECONDS_PER_DAY = 86_400_000;
const REVIEW_WEEK_DAYS = 7;

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

/** Bounds hostile Weekly Review persistence evidence to the stable repository error contract. */
function boundedReviewEvidenceRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new HabitPersistenceError();
  }
}

/** Snapshots one bounded Weekly Review SQL result before semantic validation. */
function snapshotReviewProjectionRows(
  result: HabitSqlQueryResult<ReviewProjectionRow>,
  maximumRows: number,
): ReviewProjectionRow[] {
  return boundedReviewEvidenceRead(() => {
    const rows = result.rows;
    if (!Array.isArray(rows)) {
      return invalidRow();
    }
    const rowCount = rows.length;
    if (
      !Number.isSafeInteger(rowCount) ||
      rowCount < 0 ||
      rowCount > maximumRows
    ) {
      return invalidRow();
    }

    const snapshot: ReviewProjectionRow[] = [];
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows[index];
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        return invalidRow();
      }
      snapshot.push({
        id: row.id,
        workspace_id: row.workspace_id,
        title: row.title,
        timezone_name: row.timezone_name,
        recurrence_kind: row.recurrence_kind,
        recurrence_interval: row.recurrence_interval,
        weekday_mask: row.weekday_mask,
        starts_on: row.starts_on,
        created_at: row.created_at,
        completion_workspace_id: row.completion_workspace_id,
        completion_habit_id: row.completion_habit_id,
        completion_scheduled_local_date: row.completion_scheduled_local_date,
      });
    }
    return snapshot;
  });
}

function snapshotDefinitionDayRows(
  result: HabitSqlQueryResult<DefinitionDayRow>,
  maximumRows: number,
): DefinitionDayRow[] {
  return boundedReviewEvidenceRead(() => {
    const rows = result.rows;
    if (!Array.isArray(rows) || rows.length > maximumRows) {
      return invalidRow();
    }
    return rows.map((row) => {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) {
        return invalidRow();
      }
      return {
        id: row.id,
        workspace_id: row.workspace_id,
        title: row.title,
        timezone_name: row.timezone_name,
        recurrence_kind: row.recurrence_kind,
        recurrence_interval: row.recurrence_interval,
        weekday_mask: row.weekday_mask,
        starts_on: row.starts_on,
        created_at: row.created_at,
        scheduled_local_date: row.scheduled_local_date,
      };
    });
  });
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

function parseDefinitionRevisionEvidence(
  row: HabitDefinitionRevisionRow,
  expectedWorkspaceId: string,
  expectedHabitId: string,
): HabitDefinitionRevisionEvidence {
  const workspaceId = requireUuidV4(row.workspace_id);
  const habitId = requireUuidV4(row.habit_id);
  requireExpected(workspaceId, expectedWorkspaceId);
  requireExpected(habitId, expectedHabitId);
  return {
    schemaVersion: 'life-os.habit-definition-revision.v1',
    workspaceId,
    habitId,
    revisionNumber: requireInteger(
      row.revision_number,
      2,
      Number.MAX_SAFE_INTEGER,
    ),
    effectiveFromLocalDate: requireLocalDate(row.effective_from_local_date),
    recordedAt: requireTimestamp(row.recorded_at),
  };
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
      `SELECT current.id, current.workspace_id,
              COALESCE(revision.title, current.title) AS title,
              COALESCE(revision.timezone_name, current.timezone_name) AS timezone_name,
              COALESCE(revision.recurrence_kind, current.recurrence_kind) AS recurrence_kind,
              COALESCE(revision.recurrence_interval, current.recurrence_interval)
                AS recurrence_interval,
              COALESCE(revision.weekday_mask, current.weekday_mask) AS weekday_mask,
              current.starts_on, current.created_at
       FROM habit.habit_definitions AS current
       LEFT JOIN LATERAL (
         SELECT title, timezone_name, recurrence_kind,
                recurrence_interval, weekday_mask
         FROM habit.habit_definition_revisions
         WHERE workspace_id = current.workspace_id
           AND habit_id = current.id
           AND effective_from <= clock_timestamp()
         ORDER BY effective_from DESC, revision_number DESC
         LIMIT 1
       ) AS revision ON TRUE
       WHERE current.workspace_id = $1 AND current.id = $2
       LIMIT 2`,
      [safeWorkspaceId, safeHabitId],
    );
    const row = oneOrUndefined(result.rows);
    return row ? parseHabit(row, safeWorkspaceId, safeHabitId) : undefined;
  }

  async listHabits(workspaceId: string): Promise<Habit[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const result = await this.query<HabitRow>(
      `SELECT current.id, current.workspace_id,
              COALESCE(revision.title, current.title) AS title,
              COALESCE(revision.timezone_name, current.timezone_name) AS timezone_name,
              COALESCE(revision.recurrence_kind, current.recurrence_kind) AS recurrence_kind,
              COALESCE(revision.recurrence_interval, current.recurrence_interval)
                AS recurrence_interval,
              COALESCE(revision.weekday_mask, current.weekday_mask) AS weekday_mask,
              current.starts_on, current.created_at
       FROM habit.habit_definitions AS current
       LEFT JOIN LATERAL (
         SELECT title, timezone_name, recurrence_kind,
                recurrence_interval, weekday_mask
         FROM habit.habit_definition_revisions
         WHERE workspace_id = current.workspace_id
           AND habit_id = current.id
           AND effective_from <= clock_timestamp()
         ORDER BY effective_from DESC, revision_number DESC
         LIMIT 1
       ) AS revision ON TRUE
       WHERE current.workspace_id = $1
       ORDER BY current.created_at ASC, current.id ASC`,
      [safeWorkspaceId],
    );
    return result.rows.map((row) => parseHabit(row, safeWorkspaceId));
  }

  /** Persists one semantic definition change as a single short PostgreSQL authority call. */
  async reviseHabitDefinition(
    workspaceId: string,
    habitId: string,
    command: HabitDefinitionRevisionCommand,
    recordedAt: string,
  ): Promise<HabitDefinitionRevisionEvidence> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeHabitId = requireUuidV4(habitId);
    const safeEffectiveFromLocalDate = requireLocalDate(
      command.effectiveFromLocalDate,
    );
    const safeTitle = requireText(command.title).trim();
    const safeTimezone = requireTimezone(command.timezone);
    const recurrence = recurrenceValues(command.recurrence);
    const safeIdempotencyKey = requireUuidV4(command.idempotencyKey);
    const safeRecordedAt = requireTimestamp(recordedAt);
    const result = await this.query<HabitDefinitionRevisionRow>(
      `SELECT workspace_id, habit_id, revision_number,
              effective_from_local_date, recorded_at
       FROM habit.revise_habit_definition(
         $1::uuid, $2::uuid, $3::date, $4::text, $5::text,
         $6::text, $7::smallint, $8::smallint, $9::uuid, $10::timestamptz
       )`,
      [
        safeWorkspaceId,
        safeHabitId,
        safeEffectiveFromLocalDate,
        safeTitle,
        safeTimezone,
        recurrence.kind,
        recurrence.interval,
        recurrence.weekdayMask,
        safeIdempotencyKey,
        safeRecordedAt,
      ],
    );
    return parseDefinitionRevisionEvidence(
      exactlyOne(result.rows),
      safeWorkspaceId,
      safeHabitId,
    );
  }

  /** Reads one tenant week in bounded statements without per-Habit history scans. */
  async readReviewWeekEvidence(
    workspaceId: string,
    periodStartDate: string,
    periodEndDate: string,
    maximumHabits: number,
    asOf: string,
  ): Promise<HabitReviewWeekEvidence> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safePeriodStartDate = requireLocalDate(periodStartDate);
    const safePeriodEndDate = requireLocalDate(periodEndDate);
    const safeAsOf = requireTimestamp(asOf);
    const periodStartWeekday = new Date(
      `${safePeriodStartDate}T00:00:00.000Z`,
    ).getUTCDay();
    const daySpan =
      (Date.parse(`${safePeriodEndDate}T00:00:00.000Z`) -
        Date.parse(`${safePeriodStartDate}T00:00:00.000Z`)) /
      MILLISECONDS_PER_DAY;
    const safeMaximumHabits = requireInteger(maximumHabits, 1, 100);
    if (periodStartWeekday !== 1 || daySpan !== REVIEW_WEEK_DAYS - 1) {
      return invalidRow();
    }
    const queryLimit = safeMaximumHabits + 1;
    const result = await this.query<ReviewProjectionRow>(
      `WITH bounded_current_habits AS (
         SELECT id, workspace_id, title, timezone_name, recurrence_kind,
                recurrence_interval, weekday_mask, starts_on, created_at
         FROM habit.habit_definitions
         WHERE workspace_id = $1
           AND created_at <= $4::timestamptz
         ORDER BY created_at ASC, id ASC
         LIMIT $5
       ),
       bounded_habits AS (
         SELECT COALESCE(history.id, current.id) AS id,
                COALESCE(history.workspace_id, current.workspace_id) AS workspace_id,
                COALESCE(history.title, current.title) AS title,
                COALESCE(history.timezone_name, current.timezone_name) AS timezone_name,
                COALESCE(history.recurrence_kind, current.recurrence_kind) AS recurrence_kind,
                COALESCE(history.recurrence_interval, current.recurrence_interval)
                  AS recurrence_interval,
                COALESCE(history.weekday_mask, current.weekday_mask) AS weekday_mask,
                COALESCE(history.starts_on, current.starts_on) AS starts_on,
                COALESCE(history.created_at, current.created_at) AS created_at
         FROM bounded_current_habits AS current
         LEFT JOIN LATERAL (
           SELECT id, workspace_id, title, timezone_name, recurrence_kind,
                  recurrence_interval, weekday_mask, starts_on, created_at
           FROM habit.habit_definition_history
           WHERE workspace_id = current.workspace_id
             AND id = current.id
             AND superseded_at > $4::timestamptz
           ORDER BY superseded_at ASC, history_sequence ASC
           LIMIT 1
         ) AS history ON TRUE
       )
       SELECT h.id, h.workspace_id, h.title, h.timezone_name,
              h.recurrence_kind, h.recurrence_interval, h.weekday_mask,
              h.starts_on, h.created_at,
              completion.workspace_id AS completion_workspace_id,
              completion.habit_id AS completion_habit_id,
              completion.scheduled_local_date AS completion_scheduled_local_date
       FROM bounded_habits AS h
       LEFT JOIN LATERAL (
         SELECT DISTINCT ON (scheduled_local_date)
                workspace_id, habit_id, scheduled_local_date
         FROM habit.completion_events
         WHERE workspace_id = h.workspace_id
           AND habit_id = h.id
           AND scheduled_local_date BETWEEN $2::date AND $3::date
           AND recorded_at <= $4::timestamptz
         ORDER BY scheduled_local_date ASC, recorded_at ASC, id ASC
       ) AS completion ON TRUE
       ORDER BY h.created_at ASC, h.id ASC,
                completion.scheduled_local_date ASC`,
      [
        safeWorkspaceId,
        safePeriodStartDate,
        safePeriodEndDate,
        safeAsOf,
        queryLimit,
      ],
    );
    const rows = snapshotReviewProjectionRows(
      result,
      queryLimit * REVIEW_WEEK_DAYS,
    );

    const baseEvidence = boundedReviewEvidenceRead(() => {
      const habitsById = new Map<string, Habit>();
      const completions: HabitReviewCompletionEvidence[] = [];
      for (const row of rows) {
        const habit = parseHabit(row, safeWorkspaceId);
        const existing = habitsById.get(habit.id);
        if (existing && JSON.stringify(existing) !== JSON.stringify(habit)) {
          return invalidRow();
        }
        habitsById.set(habit.id, habit);
        if (habitsById.size > safeMaximumHabits) {
          return invalidRow();
        }

        const completionFields = [
          row.completion_workspace_id,
          row.completion_habit_id,
          row.completion_scheduled_local_date,
        ];
        if (completionFields.every((value) => value === null)) {
          continue;
        }
        if (completionFields.some((value) => value === null)) {
          return invalidRow();
        }
        const completionWorkspaceId = requireUuidV4(
          row.completion_workspace_id,
        );
        const completionHabitId = requireUuidV4(row.completion_habit_id);
        const scheduledLocalDate = requireLocalDate(
          row.completion_scheduled_local_date,
        );
        requireExpected(completionWorkspaceId, safeWorkspaceId);
        requireExpected(completionHabitId, habit.id);
        if (
          scheduledLocalDate < safePeriodStartDate ||
          scheduledLocalDate > safePeriodEndDate
        ) {
          return invalidRow();
        }
        completions.push({
          workspaceId: completionWorkspaceId,
          habitId: completionHabitId,
          scheduledLocalDate,
        });
      }
      return { habits: [...habitsById.values()], completions };
    });

    const definitionResult = await this.query<DefinitionDayRow>(
      `WITH bounded_current_habits AS (
         SELECT id, workspace_id, title, timezone_name, recurrence_kind,
                recurrence_interval, weekday_mask, starts_on, created_at
         FROM habit.habit_definitions
         WHERE workspace_id = $1
           AND created_at <= $4::timestamptz
         ORDER BY created_at ASC, id ASC
         LIMIT $5
       ),
       bounded_habits AS (
         SELECT COALESCE(history.id, current.id) AS id,
                COALESCE(history.workspace_id, current.workspace_id) AS workspace_id,
                COALESCE(history.title, current.title) AS title,
                COALESCE(history.timezone_name, current.timezone_name) AS timezone_name,
                COALESCE(history.recurrence_kind, current.recurrence_kind) AS recurrence_kind,
                COALESCE(history.recurrence_interval, current.recurrence_interval)
                  AS recurrence_interval,
                COALESCE(history.weekday_mask, current.weekday_mask) AS weekday_mask,
                COALESCE(history.starts_on, current.starts_on) AS starts_on,
                COALESCE(history.created_at, current.created_at) AS created_at
         FROM bounded_current_habits AS current
         LEFT JOIN LATERAL (
           SELECT id, workspace_id, title, timezone_name, recurrence_kind,
                  recurrence_interval, weekday_mask, starts_on, created_at
           FROM habit.habit_definition_history
           WHERE workspace_id = current.workspace_id
             AND id = current.id
             AND superseded_at > $4::timestamptz
           ORDER BY superseded_at ASC, history_sequence ASC
           LIMIT 1
         ) AS history ON TRUE
       ),
       review_days AS (
         SELECT generate_series(
           $2::date,
           $3::date,
           interval '1 day'
         )::date AS local_date
       )
       SELECT h.id, h.workspace_id,
              COALESCE(revision.title, h.title) AS title,
              COALESCE(revision.timezone_name, h.timezone_name) AS timezone_name,
              COALESCE(revision.recurrence_kind, h.recurrence_kind) AS recurrence_kind,
              COALESCE(revision.recurrence_interval, h.recurrence_interval)
                AS recurrence_interval,
              COALESCE(revision.weekday_mask, h.weekday_mask) AS weekday_mask,
              h.starts_on, h.created_at,
              day.local_date AS scheduled_local_date
       FROM bounded_habits AS h
       CROSS JOIN review_days AS day
       LEFT JOIN LATERAL (
         SELECT title, timezone_name, recurrence_kind,
                recurrence_interval, weekday_mask
         FROM habit.habit_definition_revisions
         WHERE workspace_id = h.workspace_id
           AND habit_id = h.id
           AND effective_from_local_date <= day.local_date
           AND recorded_at <= $4::timestamptz
         ORDER BY effective_from_local_date DESC, revision_number DESC
         LIMIT 1
       ) AS revision ON TRUE
       ORDER BY h.created_at ASC, h.id ASC, day.local_date ASC`,
      [
        safeWorkspaceId,
        safePeriodStartDate,
        safePeriodEndDate,
        safeAsOf,
        queryLimit,
      ],
    );
    const definitionRows = snapshotDefinitionDayRows(
      definitionResult,
      queryLimit * REVIEW_WEEK_DAYS,
    );
    const definitionDays = boundedReviewEvidenceRead(() => {
      const expectedHabitIds = new Set(
        baseEvidence.habits.map((habit) => habit.id),
      );
      const days: HabitReviewDefinitionDayEvidence[] = definitionRows.map(
        (row) => {
          const localDate = requireLocalDate(row.scheduled_local_date);
          if (
            localDate < safePeriodStartDate ||
            localDate > safePeriodEndDate
          ) {
            return invalidRow();
          }
          const habit = parseHabit(row, safeWorkspaceId);
          if (!expectedHabitIds.has(habit.id)) {
            return invalidRow();
          }
          return { localDate, habit };
        },
      );
      if (days.length !== baseEvidence.habits.length * REVIEW_WEEK_DAYS) {
        return invalidRow();
      }
      return days;
    });
    return { ...baseEvidence, definitionDays };
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
