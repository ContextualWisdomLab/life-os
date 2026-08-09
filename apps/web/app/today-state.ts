const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const MAXIMUM_ACTIONS = 50;
const MAXIMUM_TITLE_LENGTH = 160;
const MINIMUM_DURATION_MINUTES = 15;
const MAXIMUM_DURATION_MINUTES = 240;
const MINUTES_PER_DAY = 24 * 60;
const DRAFT_VERSION = 'life-os.today-draft.v1' as const;

export type TodayActionStatus = 'open' | 'done';
export type TodayPriority = 1 | 2 | 3;

export interface TodayAction {
  readonly id: string;
  readonly title: string;
  readonly status: TodayActionStatus;
  readonly priority: TodayPriority | null;
  readonly startMinute: number | null;
  readonly durationMinutes: number | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface TodayDraft {
  readonly version: typeof DRAFT_VERSION;
  readonly date: string;
  readonly actions: readonly TodayAction[];
}

export class TodayValidationError extends Error {
  constructor() {
    super('Today draft is invalid');
    this.name = 'TodayValidationError';
  }
}

export class TodayPriorityLimitError extends Error {
  constructor() {
    super('Today supports at most three committed priorities');
    this.name = 'TodayPriorityLimitError';
  }
}

export class TodayScheduleConflictError extends Error {
  constructor() {
    super('Scheduled actions overlap');
    this.name = 'TodayScheduleConflictError';
  }
}

function invalid(): never {
  throw new TodayValidationError();
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  const actual = Object.keys(record);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    invalid();
  }
}

function requireString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)
  ) {
    return invalid();
  }
  return normalized;
}

function requireUuidV4(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireDate(value: unknown): string {
  const normalized = requireString(value, 10);
  if (!DATE_PATTERN.test(normalized)) {
    return invalid();
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    return invalid();
  }
  return normalized;
}

function requireInstant(value: unknown): string {
  const normalized = requireString(value, 32);
  if (!INSTANT_PATTERN.test(normalized)) {
    return invalid();
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return invalid();
  }
  return parsed.toISOString();
}

function requireNullableInstant(value: unknown): string | null {
  return value === null ? null : requireInstant(value);
}

function requirePriority(value: unknown): TodayPriority | null {
  if (value === null || value === 1 || value === 2 || value === 3) {
    return value;
  }
  return invalid();
}

function requireStatus(value: unknown): TodayActionStatus {
  if (value === 'open' || value === 'done') {
    return value;
  }
  return invalid();
}

function requireNullableScheduleMinute(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) >= MINUTES_PER_DAY ||
    (value as number) % 15 !== 0
  ) {
    return invalid();
  }
  return value as number;
}

function requireNullableDuration(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < MINIMUM_DURATION_MINUTES ||
    (value as number) > MAXIMUM_DURATION_MINUTES ||
    (value as number) % 15 !== 0
  ) {
    return invalid();
  }
  return value as number;
}

function normalizeAction(value: unknown): TodayAction {
  const record = requireRecord(value);
  requireExactKeys(record, [
    'id',
    'title',
    'status',
    'priority',
    'startMinute',
    'durationMinutes',
    'createdAt',
    'completedAt',
  ]);
  const status = requireStatus(record.status);
  const priority = requirePriority(record.priority);
  const startMinute = requireNullableScheduleMinute(record.startMinute);
  const durationMinutes = requireNullableDuration(record.durationMinutes);
  const completedAt = requireNullableInstant(record.completedAt);
  if ((startMinute === null) !== (durationMinutes === null)) {
    return invalid();
  }
  if (
    startMinute !== null &&
    startMinute + (durationMinutes ?? 0) > MINUTES_PER_DAY
  ) {
    return invalid();
  }
  if (
    (status === 'done' && completedAt === null) ||
    (status === 'open' && completedAt !== null)
  ) {
    return invalid();
  }
  return Object.freeze({
    id: requireUuidV4(record.id),
    title: requireString(record.title, MAXIMUM_TITLE_LENGTH),
    status,
    priority,
    startMinute,
    durationMinutes,
    createdAt: requireInstant(record.createdAt),
    completedAt,
  });
}

function byCreationThenId(left: TodayAction, right: TodayAction): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function assertDraftInvariants(actions: readonly TodayAction[]): void {
  const ids = new Set<string>();
  const priorities = new Set<TodayPriority>();
  for (const action of actions) {
    if (ids.has(action.id)) {
      invalid();
    }
    ids.add(action.id);
    if (action.priority !== null) {
      if (priorities.has(action.priority)) {
        invalid();
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
      throw new TodayScheduleConflictError();
    }
  }
}

export function createEmptyTodayDraft(date: string): TodayDraft {
  return Object.freeze({
    version: DRAFT_VERSION,
    date: requireDate(date),
    actions: Object.freeze([]),
  });
}

export function parseTodayDraft(
  value: unknown,
  expectedDate: string,
): TodayDraft {
  const record = requireRecord(value);
  requireExactKeys(record, ['version', 'date', 'actions']);
  if (record.version !== DRAFT_VERSION || !Array.isArray(record.actions)) {
    return invalid();
  }
  if (record.actions.length > MAXIMUM_ACTIONS) {
    return invalid();
  }
  const date = requireDate(record.date);
  if (date !== requireDate(expectedDate)) {
    return createEmptyTodayDraft(expectedDate);
  }
  const actions = record.actions.map(normalizeAction).sort(byCreationThenId);
  assertDraftInvariants(actions);
  return Object.freeze({
    version: DRAFT_VERSION,
    date,
    actions: Object.freeze(actions),
  });
}

function replaceAction(
  draft: TodayDraft,
  id: string,
  update: (action: TodayAction) => TodayAction,
): TodayDraft {
  const safeDraft = parseTodayDraft(draft, draft.date);
  const safeId = requireUuidV4(id);
  let found = false;
  const actions = safeDraft.actions.map((action) => {
    if (action.id !== safeId) {
      return action;
    }
    found = true;
    return update(action);
  });
  if (!found) {
    return invalid();
  }
  assertDraftInvariants(actions);
  return Object.freeze({ ...safeDraft, actions: Object.freeze(actions) });
}

export function addTodayAction(
  draft: TodayDraft,
  input: {
    readonly id: string;
    readonly title: string;
    readonly createdAt: string;
  },
): TodayDraft {
  const safeDraft = parseTodayDraft(draft, draft.date);
  if (safeDraft.actions.length >= MAXIMUM_ACTIONS) {
    return invalid();
  }
  const action = normalizeAction({
    id: input.id,
    title: input.title,
    status: 'open',
    priority: null,
    startMinute: null,
    durationMinutes: null,
    createdAt: input.createdAt,
    completedAt: null,
  });
  const actions = [...safeDraft.actions, action].sort(byCreationThenId);
  assertDraftInvariants(actions);
  return Object.freeze({ ...safeDraft, actions: Object.freeze(actions) });
}

export function toggleTodayPriority(draft: TodayDraft, id: string): TodayDraft {
  const safeDraft = parseTodayDraft(draft, draft.date);
  const safeId = requireUuidV4(id);
  const action = safeDraft.actions.find((candidate) => candidate.id === safeId);
  if (!action || action.status === 'done') {
    return invalid();
  }
  const assigned = new Set(
    safeDraft.actions.flatMap((candidate) =>
      candidate.priority === null ? [] : [candidate.priority],
    ),
  );
  if (action.priority !== null) {
    return replaceAction(safeDraft, safeId, (candidate) =>
      Object.freeze({
        ...candidate,
        priority: null,
        startMinute: null,
        durationMinutes: null,
      }),
    );
  }
  const nextPriority = ([1, 2, 3] as const).find(
    (priority) => !assigned.has(priority),
  );
  if (nextPriority === undefined) {
    throw new TodayPriorityLimitError();
  }
  return replaceAction(safeDraft, safeId, (candidate) =>
    Object.freeze({ ...candidate, priority: nextPriority }),
  );
}

export function scheduleTodayAction(
  draft: TodayDraft,
  id: string,
  startMinute: number,
  durationMinutes: number,
): TodayDraft {
  const safeStart = requireNullableScheduleMinute(startMinute);
  const safeDuration = requireNullableDuration(durationMinutes);
  if (safeStart === null || safeDuration === null) {
    return invalid();
  }
  return replaceAction(draft, id, (action) => {
    if (action.status !== 'open' || action.priority === null) {
      return invalid();
    }
    return Object.freeze({
      ...action,
      startMinute: safeStart,
      durationMinutes: safeDuration,
    });
  });
}

export function clearTodaySchedule(draft: TodayDraft, id: string): TodayDraft {
  return replaceAction(draft, id, (action) => {
    if (action.status !== 'open') {
      return invalid();
    }
    return Object.freeze({
      ...action,
      startMinute: null,
      durationMinutes: null,
    });
  });
}

export function toggleTodayCompletion(
  draft: TodayDraft,
  id: string,
  completedAt: string,
): TodayDraft {
  return replaceAction(draft, id, (action) =>
    action.status === 'open'
      ? Object.freeze({
          ...action,
          status: 'done',
          completedAt: requireInstant(completedAt),
        })
      : Object.freeze({ ...action, status: 'open', completedAt: null }),
  );
}

export function formatMinuteOfDay(value: number): string {
  const safe = requireNullableScheduleMinute(value);
  if (safe === null) {
    return invalid();
  }
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseTimeInput(value: string): number {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return invalid();
  }
  const [hoursText, minutesText] = value.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  return requireNullableScheduleMinute(hours * 60 + minutes) ?? invalid();
}
