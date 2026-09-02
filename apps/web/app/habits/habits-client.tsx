'use client';

import { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  createHabitsWorkspaceState,
  reduceHabitsWorkspaceState,
  type HabitsWorkspaceHabit,
  type HabitsWorkspaceRecurrence,
} from '../habits-workspace-state';
import styles from './habits.module.css';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_HABITS = 100;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_TIMEZONE_CHARACTERS = 128;
const WEEKDAYS = Object.freeze([
  [1, 'Monday'],
  [2, 'Tuesday'],
  [3, 'Wednesday'],
  [4, 'Thursday'],
  [5, 'Friday'],
  [6, 'Saturday'],
  [7, 'Sunday'],
] as const);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isCanonicalTitle(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    [...value].length > 0 &&
    [...value].length <= MAXIMUM_TITLE_CHARACTERS &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isTimezone(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
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

function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
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

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)
  ) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseInterval(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 365
    ? value
    : null;
}

function parseRecurrence(value: unknown): HabitsWorkspaceRecurrence | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  const interval = parseInterval(value.interval);
  if (interval === null) return null;
  if (
    value.kind === 'daily' &&
    keys.length === 2 &&
    keys[0] === 'interval' &&
    keys[1] === 'kind'
  ) {
    return Object.freeze({ kind: 'daily' as const, interval });
  }
  if (
    value.kind !== 'weekly' ||
    keys.length !== 3 ||
    keys[0] !== 'interval' ||
    keys[1] !== 'kind' ||
    keys[2] !== 'weekdays' ||
    !Array.isArray(value.weekdays) ||
    value.weekdays.length === 0 ||
    value.weekdays.length > 7
  ) {
    return null;
  }
  const weekdays = value.weekdays;
  if (
    weekdays.some(
      (weekday) =>
        typeof weekday !== 'number' ||
        !Number.isSafeInteger(weekday) ||
        weekday < 1 ||
        weekday > 7,
    ) ||
    new Set(weekdays).size !== weekdays.length
  ) {
    return null;
  }
  const sorted = [...weekdays].sort((left, right) => left - right);
  if (sorted.some((weekday, index) => weekday !== weekdays[index])) return null;
  return Object.freeze({
    kind: 'weekly' as const,
    interval,
    weekdays: Object.freeze(sorted),
  });
}

function parseHabit(value: unknown): HabitsWorkspaceHabit | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 6 ||
    keys[0] !== 'createdAt' ||
    keys[1] !== 'id' ||
    keys[2] !== 'recurrence' ||
    keys[3] !== 'startsOn' ||
    keys[4] !== 'timezone' ||
    keys[5] !== 'title' ||
    typeof value.id !== 'string' ||
    !UUID_V4_PATTERN.test(value.id) ||
    !isCanonicalTitle(value.title) ||
    !isTimezone(value.timezone) ||
    !isLocalDate(value.startsOn) ||
    !isCanonicalUtcTimestamp(value.createdAt)
  ) {
    return null;
  }
  const recurrence = parseRecurrence(value.recurrence);
  if (recurrence === null) return null;
  return Object.freeze({
    id: value.id.toLowerCase(),
    title: value.title,
    timezone: value.timezone,
    startsOn: value.startsOn,
    recurrence,
    createdAt: value.createdAt,
  });
}

function parseHabitCollection(value: unknown): HabitsWorkspaceHabit[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_HABITS) return null;
  const habits: HabitsWorkspaceHabit[] = [];
  for (const candidate of value) {
    const habit = parseHabit(candidate);
    if (habit === null) return null;
    habits.push(habit);
  }
  return new Set(habits.map((habit) => habit.id)).size === habits.length
    ? habits
    : null;
}

function clampTitleInput(value: string): string {
  return [...value].slice(0, MAXIMUM_TITLE_CHARACTERS).join('');
}

function localDateToday(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function browserTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimezone(timezone) ? timezone : 'UTC';
  } catch {
    return 'UTC';
  }
}

function recurrenceSummary(recurrence: HabitsWorkspaceRecurrence): string {
  if (recurrence.kind === 'daily') {
    return recurrence.interval === 1
      ? 'Every day'
      : `Every ${recurrence.interval} days`;
  }
  const names = recurrence.weekdays.map(
    (weekday) =>
      WEEKDAYS.find(([value]) => value === weekday)?.[1] ?? String(weekday),
  );
  const cadence =
    recurrence.interval === 1
      ? 'Every week'
      : `Every ${recurrence.interval} weeks`;
  return `${cadence} · ${names.join(', ')}`;
}

/**
 * Renders durable Habit evidence through the authenticated Habit BFF. The browser
 * never supplies workspace authority, and no optimistic Habit identity is created.
 */
export function HabitsClient() {
  const [state, dispatch] = useReducer(
    reduceHabitsWorkspaceState,
    undefined,
    createHabitsWorkspaceState,
  );
  const [title, setTitle] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [startsOn, setStartsOn] = useState('');
  const [recurrenceKind, setRecurrenceKind] = useState<'daily' | 'weekly'>('daily');
  const [interval, setInterval] = useState('1');
  const [weekdays, setWeekdays] = useState<readonly number[]>([1]);
  const loadGeneration = useRef(0);
  const submissionClaim = useRef(false);

  function releaseSubmission(): void {
    submissionClaim.current = false;
  }

  async function loadHabits(): Promise<void> {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    releaseSubmission();
    if (!navigator.onLine) {
      dispatch({ type: 'offline' });
      return;
    }
    try {
      const response = await fetch('/api/habits', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (generation !== loadGeneration.current) return;
      if (response.status === 401) {
        dispatch({ type: 'authentication-required' });
        return;
      }
      if (response.status !== 200) {
        dispatch({ type: 'unavailable' });
        return;
      }
      const habits = parseHabitCollection((await response.json()) as unknown);
      if (generation !== loadGeneration.current) return;
      if (habits === null) {
        dispatch({ type: 'unavailable' });
        return;
      }
      dispatch({ type: 'habits-loaded', habits });
    } catch {
      if (generation !== loadGeneration.current) return;
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  function toggleWeekday(weekday: number): void {
    setWeekdays((current) => {
      if (current.includes(weekday)) {
        return current.length === 1
          ? current
          : current.filter((value) => value !== weekday);
      }
      return [...current, weekday].sort((left, right) => left - right);
    });
  }

  async function createHabit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submissionClaim.current || state.submitting) return;

    const canonicalTitle = title.trim();
    const parsedInterval = Number(interval);
    const recurrence: HabitsWorkspaceRecurrence =
      recurrenceKind === 'daily'
        ? { kind: 'daily', interval: parsedInterval }
        : { kind: 'weekly', interval: parsedInterval, weekdays };
    if (
      !isCanonicalTitle(canonicalTitle) ||
      !isTimezone(timezone) ||
      !isLocalDate(startsOn) ||
      parseInterval(parsedInterval) === null ||
      (recurrence.kind === 'weekly' && recurrence.weekdays.length === 0)
    ) {
      dispatch({ type: 'invalid-input' });
      return;
    }
    if (!navigator.onLine) {
      dispatch({ type: 'offline' });
      return;
    }

    submissionClaim.current = true;
    dispatch({ type: 'submit-started' });
    const generation = loadGeneration.current;
    try {
      const response = await fetch('/api/habits', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: canonicalTitle,
          timezone,
          startsOn,
          recurrence,
        }),
      });
      if (generation !== loadGeneration.current) return;
      if (response.status === 401) {
        releaseSubmission();
        dispatch({ type: 'authentication-required' });
        return;
      }
      if (response.status === 400) {
        releaseSubmission();
        dispatch({ type: 'invalid-input' });
        return;
      }
      if (response.status !== 201) {
        releaseSubmission();
        dispatch({ type: 'unavailable' });
        return;
      }
      const habit = parseHabit((await response.json()) as unknown);
      if (
        generation !== loadGeneration.current ||
        habit === null ||
        habit.title !== canonicalTitle ||
        habit.timezone !== timezone ||
        habit.startsOn !== startsOn ||
        JSON.stringify(habit.recurrence) !== JSON.stringify(recurrence)
      ) {
        releaseSubmission();
        dispatch({ type: 'unavailable' });
        return;
      }
      releaseSubmission();
      dispatch({ type: 'submit-succeeded', habit });
      setTitle('');
    } catch {
      if (generation !== loadGeneration.current) return;
      releaseSubmission();
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  useEffect(() => {
    setTimezone(browserTimezone());
    setStartsOn(localDateToday());
    void loadHabits();
    const handleOffline = () => {
      loadGeneration.current += 1;
      releaseSubmission();
      dispatch({ type: 'offline' });
    };
    const handleOnline = () => void loadHabits();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      loadGeneration.current += 1;
      releaseSubmission();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const canCreate = state.status === 'ready' && !state.submitting;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="LifeOS Today">
          <span aria-hidden="true">L</span>
          <strong>LifeOS</strong>
        </a>
        <nav className={styles.navigation} aria-label="Primary navigation">
          <a href="/">Today</a>
          <a href="/goals">Goals</a>
          <a href="/projects">Projects</a>
          <a href="/tasks">Tasks</a>
          <a href="/habits" aria-current="page">
            Habits
          </a>
        </nav>
      </header>

      <main className={styles.main}>
        <header className={styles.workspaceHeader}>
          <p className={styles.eyebrow}>Practice</p>
          <h1>Habits</h1>
          <p className={styles.lede}>
            Define repeatable behavior with an explicit schedule. LifeOS records the
            durable rule; it does not infer a universal formation deadline.
          </p>
        </header>

        <div className={styles.workspaceGrid}>
          <section
            className={styles.habitPane}
            aria-labelledby="durable-habits-heading"
          >
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Durable evidence</p>
                <h2 id="durable-habits-heading">Your habit rules</h2>
              </div>
              <span aria-label={`${state.habits.length} habits`}>
                {state.habits.length}
              </span>
            </div>

            <div className={styles.status} aria-live="polite">
              {state.status === 'loading' ? <p>Loading durable habits…</p> : null}
              {state.status === 'offline' ? (
                <p>You are offline. Existing habits are read-only.</p>
              ) : null}
              {state.status === 'authentication-required' ? (
                <p>Sign in before changing the durable Habits workspace.</p>
              ) : null}
              {state.status === 'unavailable' ? (
                <p>
                  Habit evidence is temporarily unavailable. Retry without replacing
                  existing records.
                </p>
              ) : null}
              {state.message ? <p>{state.message}</p> : null}
            </div>

            {state.status === 'ready' && state.habits.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No durable habits yet</h3>
                <p>Create a rule only for behavior you actually want to repeat.</p>
              </div>
            ) : null}

            {state.habits.length > 0 ? (
              <ul className={styles.habitList}>
                {state.habits.map((habit) => (
                  <li key={habit.id}>
                    <div>
                      <strong>{habit.title}</strong>
                      <span>{recurrenceSummary(habit.recurrence)}</span>
                      <small>
                        Starts {habit.startsOn} · {habit.timezone}
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section
            className={styles.creationPane}
            aria-labelledby="create-habit-heading"
          >
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>New rule</p>
                <h2 id="create-habit-heading">Define a habit</h2>
              </div>
            </div>

            <form className={styles.creation} onSubmit={createHabit}>
              <label htmlFor="habit-title">Habit title</label>
              <input
                id="habit-title"
                name="title"
                value={title}
                onChange={(event) =>
                  setTitle(clampTitleInput(event.target.value))
                }
                maxLength={320}
                autoComplete="off"
                disabled={!canCreate}
                aria-describedby="habit-title-count"
              />
              <small id="habit-title-count" className={styles.counter}>
                {[...title].length}/{MAXIMUM_TITLE_CHARACTERS}
              </small>

              <div className={styles.fieldGrid}>
                <div>
                  <label htmlFor="habit-timezone">Timezone</label>
                  <input
                    id="habit-timezone"
                    name="timezone"
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    autoComplete="off"
                    disabled={!canCreate}
                  />
                </div>
                <div>
                  <label htmlFor="habit-start-date">Start date</label>
                  <input
                    id="habit-start-date"
                    name="startsOn"
                    type="date"
                    value={startsOn}
                    onChange={(event) => setStartsOn(event.target.value)}
                    disabled={!canCreate}
                  />
                </div>
              </div>

              <fieldset>
                <legend>Recurrence</legend>
                <div className={styles.recurrenceChoices}>
                  <label>
                    <input
                      type="radio"
                      name="recurrence-kind"
                      value="daily"
                      checked={recurrenceKind === 'daily'}
                      onChange={() => setRecurrenceKind('daily')}
                      disabled={!canCreate}
                    />
                    Daily
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="recurrence-kind"
                      value="weekly"
                      checked={recurrenceKind === 'weekly'}
                      onChange={() => setRecurrenceKind('weekly')}
                      disabled={!canCreate}
                    />
                    Weekly
                  </label>
                </div>
              </fieldset>

              <label htmlFor="habit-interval">
                Repeat every {recurrenceKind === 'daily' ? 'day(s)' : 'week(s)'}
              </label>
              <input
                id="habit-interval"
                name="interval"
                type="number"
                min="1"
                max="365"
                step="1"
                inputMode="numeric"
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
                disabled={!canCreate}
              />

              {recurrenceKind === 'weekly' ? (
                <fieldset>
                  <legend>Days of week</legend>
                  <div className={styles.weekdayGrid}>
                    {WEEKDAYS.map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="checkbox"
                          checked={weekdays.includes(value)}
                          onChange={() => toggleWeekday(value)}
                          disabled={!canCreate}
                        />
                        {label.slice(0, 3)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              <button
                type="submit"
                disabled={!canCreate || title.trim().length === 0}
              >
                {state.submitting ? 'Creating habit…' : 'Create habit'}
              </button>
            </form>

            {state.status === 'unavailable' ? (
              <button
                className={styles.retry}
                type="button"
                onClick={() => void loadHabits()}
              >
                Retry habit evidence
              </button>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
