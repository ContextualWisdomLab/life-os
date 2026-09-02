const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_HISTORY_RECORDS = 100;
const MAXIMUM_REFLECTION_CHARACTERS = 2_000;

export type ReviewWorkspaceRitualKind =
  | 'daily-planning'
  | 'daily-shutdown'
  | 'weekly-review';

/** Browser-safe immutable evidence for one completed Review ritual. */
export interface ReviewWorkspaceRecord {
  readonly id: string;
  readonly ritualKind: ReviewWorkspaceRitualKind;
  readonly periodStartDate: string;
  readonly completedStepCount: number;
  readonly totalStepCount: number;
  readonly plannedItemCount: number;
  readonly completedItemCount: number;
  readonly habitCompletionCount: number;
  readonly reflection?: string;
  readonly completedAt: string;
  readonly recordedAt: string;
}

export type ReviewWorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'authentication-required'
  | 'offline'
  | 'conflict'
  | 'unavailable';

/** Client state contains only validated Review evidence returned by the BFF. */
export interface ReviewWorkspaceState {
  readonly status: ReviewWorkspaceStatus;
  readonly records: readonly ReviewWorkspaceRecord[];
  readonly submitting: boolean;
  readonly message: string | null;
}

export type ReviewWorkspaceAction =
  | { readonly type: 'history-loaded'; readonly records: readonly ReviewWorkspaceRecord[] }
  | { readonly type: 'submit-started' }
  | { readonly type: 'submit-succeeded'; readonly record: ReviewWorkspaceRecord }
  | { readonly type: 'invalid-input' }
  | { readonly type: 'conflict' }
  | { readonly type: 'authentication-required' }
  | { readonly type: 'offline' }
  | { readonly type: 'unavailable' };

function validLocalDate(value: string, requireMonday: boolean): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    (!requireMonday || date.getUTCDay() === 1)
  );
}

function validInstant(value: string): boolean {
  if (!CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validCount(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function validRecord(record: ReviewWorkspaceRecord): boolean {
  if (
    !UUID_V4_PATTERN.test(record.id) ||
    (record.ritualKind !== 'daily-planning' &&
      record.ritualKind !== 'daily-shutdown' &&
      record.ritualKind !== 'weekly-review') ||
    !validLocalDate(record.periodStartDate, record.ritualKind === 'weekly-review') ||
    !validCount(record.completedStepCount, 64) ||
    !validCount(record.totalStepCount, 64) ||
    record.totalStepCount < 1 ||
    record.completedStepCount !== record.totalStepCount ||
    !validCount(record.plannedItemCount, 10_000) ||
    !validCount(record.completedItemCount, 10_000) ||
    record.completedItemCount > record.plannedItemCount ||
    !validCount(record.habitCompletionCount, 10_000) ||
    !validInstant(record.completedAt) ||
    !validInstant(record.recordedAt)
  ) {
    return false;
  }
  if (record.reflection === undefined) return true;
  return (
    record.reflection.length > 0 &&
    record.reflection.trim() === record.reflection &&
    [...record.reflection].length <= MAXIMUM_REFLECTION_CHARACTERS &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(record.reflection)
  );
}

function validCollection(records: readonly ReviewWorkspaceRecord[]): boolean {
  return (
    records.length <= MAXIMUM_HISTORY_RECORDS &&
    records.every(validRecord) &&
    new Set(records.map((record) => record.id.toLowerCase())).size === records.length
  );
}

/** Creates an empty state without fabricating Review history or completion evidence. */
export function createReviewWorkspaceState(): ReviewWorkspaceState {
  return Object.freeze({
    status: 'loading',
    records: Object.freeze([]),
    submitting: false,
    message: null,
  });
}

/**
 * Promotes only validated immutable Review evidence into browser state. A completion
 * response is inert unless an explicit user submission is currently active.
 */
export function reduceReviewWorkspaceState(
  state: ReviewWorkspaceState,
  action: ReviewWorkspaceAction,
): ReviewWorkspaceState {
  switch (action.type) {
    case 'history-loaded':
      if (!validCollection(action.records)) {
        return Object.freeze({
          ...state,
          status: 'unavailable',
          submitting: false,
          message: 'Review history returned invalid durable evidence. Existing history is unchanged.',
        });
      }
      return Object.freeze({
        status: 'ready',
        records: Object.freeze([...action.records]),
        submitting: false,
        message: null,
      });

    case 'submit-started':
      if (state.status !== 'ready' || state.submitting) return state;
      return Object.freeze({ ...state, submitting: true, message: null });

    case 'submit-succeeded':
      if (state.status !== 'ready' || !state.submitting) return state;
      if (
        !validRecord(action.record) ||
        state.records.some(
          (existing) => existing.id.toLowerCase() === action.record.id.toLowerCase(),
        )
      ) {
        return Object.freeze({
          ...state,
          status: 'unavailable',
          submitting: false,
          message: 'Review completion returned invalid durable evidence. Existing history is unchanged.',
        });
      }
      return Object.freeze({
        status: 'ready',
        records: Object.freeze([action.record, ...state.records]),
        submitting: false,
        message: 'Weekly Review completion recorded.',
      });

    case 'invalid-input':
      return Object.freeze({
        ...state,
        submitting: false,
        message: 'Check the Review period and completion counts before recording.',
      });

    case 'conflict':
      return Object.freeze({
        ...state,
        status: 'conflict',
        submitting: false,
        message: 'This Weekly Review already has conflicting durable evidence. Reload before retrying.',
      });

    case 'authentication-required':
      return Object.freeze({
        ...state,
        status: 'authentication-required',
        submitting: false,
        message: 'Sign in to read or record durable Review history.',
      });

    case 'offline':
      return Object.freeze({
        ...state,
        status: 'offline',
        submitting: false,
        message: 'Review is offline. Existing durable history remains visible.',
      });

    case 'unavailable':
      return Object.freeze({
        ...state,
        status: 'unavailable',
        submitting: false,
        message: 'Review is temporarily unavailable. Existing durable history remains visible.',
      });
  }
}
