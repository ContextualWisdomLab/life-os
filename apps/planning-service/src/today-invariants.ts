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

/** Version identifier for the complete durable Today document. */
export const TODAY_VERSION = 'life-os.today.v1' as const;

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

/** Caller-owned failure factory used without coupling validation to one layer. */
export type TodayInvariantFailure = () => never;

/** Requires one canonical UUIDv4 identifier and lowercases it. */
export function canonicalTodayUuidV4(
  value: unknown,
  fail: TodayInvariantFailure,
): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) return fail();
  return value.toLowerCase();
}

/** Requires one real canonical Gregorian calendar date. */
export function canonicalTodayDate(
  value: unknown,
  fail: TodayInvariantFailure,
  allowDateObject = false,
): string {
  if (allowDateObject && value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fail();
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return fail();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return fail();
  }
  return value;
}

/** Requires one canonical UTC RFC3339 instant. */
export function canonicalTodayInstant(
  value: unknown,
  fail: TodayInvariantFailure,
): string {
  if (typeof value !== 'string' || !RFC_3339_UTC_PATTERN.test(value)) {
    return fail();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fail();
  return parsed.toISOString();
}

/** Requires one bounded user-visible action title. */
function canonicalTodayTitle(
  value: unknown,
  fail: TodayInvariantFailure,
): string {
  if (typeof value !== 'string') return fail();
  const normalized = value.trim();
  if (
    !normalized ||
    [...normalized].length > MAXIMUM_TITLE_CODE_POINTS ||
    Buffer.byteLength(normalized, 'utf8') > MAXIMUM_TITLE_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) {
    return fail();
  }
  return normalized;
}

/** Requires one nullable quarter-hour schedule start. */
function canonicalStartMinute(
  value: unknown,
  fail: TodayInvariantFailure,
): number | null {
  if (value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= MINUTES_PER_DAY ||
    (value as number) % 15 !== 0
  ) {
    return fail();
  }
  return value as number;
}

/** Requires one nullable bounded quarter-hour duration. */
function canonicalDuration(
  value: unknown,
  fail: TodayInvariantFailure,
): number | null {
  if (value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < MINIMUM_DURATION_MINUTES ||
    (value as number) > MAXIMUM_DURATION_MINUTES ||
    (value as number) % 15 !== 0
  ) {
    return fail();
  }
  return value as number;
}

/** Validates one action and returns its canonical immutable representation. */
function canonicalTodayAction(
  value: unknown,
  fail: TodayInvariantFailure,
): DurableTodayAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
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
    return fail();
  }
  const status = action.status;
  if (status !== 'open' && status !== 'done') return fail();
  const priority = action.priority;
  if (priority !== null && priority !== 1 && priority !== 2 && priority !== 3) {
    return fail();
  }
  const startMinute = canonicalStartMinute(action.startMinute, fail);
  const durationMinutes = canonicalDuration(action.durationMinutes, fail);
  if ((startMinute === null) !== (durationMinutes === null)) return fail();
  if (
    startMinute !== null &&
    durationMinutes !== null &&
    startMinute + durationMinutes > MINUTES_PER_DAY
  ) {
    return fail();
  }
  const completedAt =
    action.completedAt === null
      ? null
      : canonicalTodayInstant(action.completedAt, fail);
  if (
    (status === 'done' && completedAt === null) ||
    (status === 'open' && completedAt !== null)
  ) {
    return fail();
  }
  return Object.freeze({
    id: canonicalTodayUuidV4(action.id, fail),
    title: canonicalTodayTitle(action.title, fail),
    status,
    priority,
    startMinute,
    durationMinutes,
    createdAt: canonicalTodayInstant(action.createdAt, fail),
    completedAt,
  });
}

/** Validates duplicate, priority and overlapping-open-schedule invariants. */
function canonicalActionSet(
  value: unknown,
  fail: TodayInvariantFailure,
): readonly DurableTodayAction[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_ACTIONS) return fail();
  const actions = value.map((action) => canonicalTodayAction(action, fail));
  const identifiers = new Set<string>();
  const priorities = new Set<number>();
  for (const action of actions) {
    if (identifiers.has(action.id)) return fail();
    identifiers.add(action.id);
    if (action.priority !== null) {
      if (priorities.has(action.priority)) return fail();
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
      return fail();
    }
  }
  return Object.freeze(actions);
}

/** Validates one complete Today draft for both domain and persistence callers. */
export function canonicalTodayDraft(
  value: unknown,
  fail: TodayInvariantFailure,
  expectedDate?: string,
): DurableTodayDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const draft = value as Record<string, unknown>;
  if (
    Object.keys(draft).length !== 3 ||
    draft.version !== TODAY_VERSION ||
    !Object.hasOwn(draft, 'date') ||
    !Object.hasOwn(draft, 'actions')
  ) {
    return fail();
  }
  const date = canonicalTodayDate(draft.date, fail);
  if (expectedDate !== undefined && date !== expectedDate) return fail();
  return Object.freeze({
    version: TODAY_VERSION,
    date,
    actions: canonicalActionSet(draft.actions, fail),
  });
}
