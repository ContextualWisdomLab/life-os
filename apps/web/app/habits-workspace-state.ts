export type HabitsWorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'offline'
  | 'authentication-required'
  | 'unavailable';

export type HabitsWorkspaceRecurrence =
  | Readonly<{ readonly kind: 'daily'; readonly interval: number }>
  | Readonly<{
      readonly kind: 'weekly';
      readonly interval: number;
      readonly weekdays: readonly number[];
    }>;

export interface HabitsWorkspaceHabit {
  readonly id: string;
  readonly title: string;
  readonly timezone: string;
  readonly startsOn: string;
  readonly recurrence: HabitsWorkspaceRecurrence;
  readonly createdAt: string;
}

export interface HabitsWorkspaceState {
  readonly status: HabitsWorkspaceStatus;
  readonly habits: readonly HabitsWorkspaceHabit[];
  readonly submitting: boolean;
  readonly message: string | null;
}

export type HabitsWorkspaceAction =
  | { readonly type: 'habits-loaded'; readonly habits: readonly HabitsWorkspaceHabit[] }
  | { readonly type: 'submit-started' }
  | { readonly type: 'submit-succeeded'; readonly habit: HabitsWorkspaceHabit }
  | { readonly type: 'invalid-input' }
  | { readonly type: 'offline' }
  | { readonly type: 'authentication-required' }
  | { readonly type: 'unavailable' }
  | { readonly type: 'clear-message' };

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_TIMEZONE_CHARACTERS = 128;

function hasUniqueIdentities(values: readonly HabitsWorkspaceHabit[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length;
}

function validTitle(value: string): boolean {
  return (
    value === value.trim() &&
    [...value].length > 0 &&
    [...value].length <= MAXIMUM_TITLE_CHARACTERS &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validTimezone(value: string): boolean {
  if (
    value !== value.trim() ||
    [...value].length === 0 ||
    [...value].length > MAXIMUM_TIMEZONE_CHARACTERS ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function validLocalDate(value: string): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function validCanonicalUtcTimestamp(value: string): boolean {
  if (!CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validInterval(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 365;
}

function validRecurrence(value: HabitsWorkspaceRecurrence): boolean {
  if (value.kind === 'daily') return validInterval(value.interval);
  if (
    !validInterval(value.interval) ||
    value.weekdays.length === 0 ||
    value.weekdays.length > 7
  ) {
    return false;
  }
  const sorted = [...value.weekdays].sort((left, right) => left - right);
  return (
    sorted.every(
      (weekday, index) =>
        Number.isSafeInteger(weekday) &&
        weekday >= 1 &&
        weekday <= 7 &&
        weekday === value.weekdays[index],
    ) &&
    new Set(value.weekdays).size === value.weekdays.length
  );
}

function validHabit(value: HabitsWorkspaceHabit): boolean {
  return (
    UUID_V4_PATTERN.test(value.id) &&
    validTitle(value.title) &&
    validTimezone(value.timezone) &&
    validLocalDate(value.startsOn) &&
    validRecurrence(value.recurrence) &&
    validCanonicalUtcTimestamp(value.createdAt)
  );
}

function validHabits(values: readonly HabitsWorkspaceHabit[]): boolean {
  return hasUniqueIdentities(values) && values.every(validHabit);
}

/** Creates browser state without manufacturing any durable Habit evidence. */
export function createHabitsWorkspaceState(): HabitsWorkspaceState {
  return {
    status: 'loading',
    habits: [],
    submitting: false,
    message: null,
  };
}

/**
 * Accepts only bounded durable Habit evidence and preserves already accepted records
 * across recoverable browser, authentication, and dependency failures.
 */
export function reduceHabitsWorkspaceState(
  state: HabitsWorkspaceState,
  action: HabitsWorkspaceAction,
): HabitsWorkspaceState {
  switch (action.type) {
    case 'habits-loaded':
      if (!validHabits(action.habits)) return state;
      return {
        status: 'ready',
        habits: [...action.habits],
        submitting: false,
        message: null,
      };

    case 'submit-started':
      if (state.status !== 'ready' || state.submitting) return state;
      return { ...state, submitting: true, message: null };

    case 'submit-succeeded':
      if (state.status !== 'ready' || !state.submitting) return state;
      if (
        !validHabit(action.habit) ||
        state.habits.some((existing) => existing.id === action.habit.id)
      ) {
        return {
          ...state,
          status: 'unavailable',
          submitting: false,
          message:
            'Habit creation returned invalid durable evidence. Existing habits are unchanged.',
        };
      }
      return {
        ...state,
        habits: [...state.habits, action.habit],
        submitting: false,
        message: 'Habit created.',
      };

    case 'invalid-input':
      return {
        ...state,
        submitting: false,
        message: 'Check the habit title, timezone, start date, and recurrence.',
      };

    case 'offline':
      return {
        ...state,
        status: 'offline',
        submitting: false,
        message: 'You are offline. Existing habits remain visible but cannot change.',
      };

    case 'authentication-required':
      return {
        ...state,
        status: 'authentication-required',
        submitting: false,
        message: 'Sign in again to change the durable Habits workspace.',
      };

    case 'unavailable':
      return {
        ...state,
        status: 'unavailable',
        submitting: false,
        message: 'Habits are temporarily unavailable. Existing evidence is unchanged.',
      };

    case 'clear-message':
      return state.message === null ? state : { ...state, message: null };
  }
}
