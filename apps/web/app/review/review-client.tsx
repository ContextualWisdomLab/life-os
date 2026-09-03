'use client';

import { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  createReviewWorkspaceState,
  reduceReviewWorkspaceState,
  type ReviewWorkspaceRecord,
  type ReviewWorkspaceRitualKind,
} from '../review-workspace-state';
import styles from './review.module.css';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_HISTORY_RECORDS = 100;
const MAXIMUM_REFLECTION_CHARACTERS = 2_000;
const REVIEW_STEPS = Object.freeze([
  'Check what you committed to last week',
  'Name projects that moved or stalled',
  'Clear overdue or obsolete tasks',
  'Check habit evidence without judging missed days',
  'Choose a smaller set of commitments for next week',
] as const);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isLocalDate(value: unknown, requireMonday: boolean): value is string {
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
    date.getUTCDate() === day &&
    (!requireMonday || date.getUTCDay() === 1)
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

function parseCount(value: unknown, maximum: number): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
    ? value
    : null;
}

function parseRitualKind(value: unknown): ReviewWorkspaceRitualKind | null {
  return value === 'daily-planning' ||
    value === 'daily-shutdown' ||
    value === 'weekly-review'
    ? value
    : null;
}

function parseReflection(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    [...value].length > MAXIMUM_REFLECTION_CHARACTERS ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function parseReviewRecord(value: unknown): ReviewWorkspaceRecord | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  const allowedKeys = [
    'completedAt',
    'completedItemCount',
    'completedStepCount',
    'habitCompletionCount',
    'id',
    'periodStartDate',
    'plannedItemCount',
    'recordedAt',
    'reflection',
    'ritualKind',
    'totalStepCount',
  ];
  if (keys.some((key) => !allowedKeys.includes(key)) || keys.length < 10) {
    return null;
  }
  const requiredKeys = allowedKeys.filter((key) => key !== 'reflection');
  if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return null;
  }
  if (typeof value.id !== 'string' || !UUID_V4_PATTERN.test(value.id)) return null;
  const ritualKind = parseRitualKind(value.ritualKind);
  if (ritualKind === null) return null;
  if (!isLocalDate(value.periodStartDate, ritualKind === 'weekly-review')) return null;
  const completedStepCount = parseCount(value.completedStepCount, 64);
  const totalStepCount = parseCount(value.totalStepCount, 64);
  const plannedItemCount = parseCount(value.plannedItemCount, 10_000);
  const completedItemCount = parseCount(value.completedItemCount, 10_000);
  const habitCompletionCount = parseCount(value.habitCompletionCount, 10_000);
  if (
    completedStepCount === null ||
    totalStepCount === null ||
    totalStepCount < 1 ||
    completedStepCount !== totalStepCount ||
    plannedItemCount === null ||
    completedItemCount === null ||
    completedItemCount > plannedItemCount ||
    habitCompletionCount === null ||
    !isCanonicalUtcTimestamp(value.completedAt) ||
    !isCanonicalUtcTimestamp(value.recordedAt)
  ) {
    return null;
  }
  const reflection = parseReflection(value.reflection);
  if (reflection === null) return null;
  return Object.freeze({
    id: value.id.toLowerCase(),
    ritualKind,
    periodStartDate: value.periodStartDate,
    completedStepCount,
    totalStepCount,
    plannedItemCount,
    completedItemCount,
    habitCompletionCount,
    ...(reflection === undefined ? {} : { reflection }),
    completedAt: value.completedAt,
    recordedAt: value.recordedAt,
  });
}

function parseHistory(value: unknown): ReviewWorkspaceRecord[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_HISTORY_RECORDS) return null;
  const records: ReviewWorkspaceRecord[] = [];
  for (const candidate of value) {
    const record = parseReviewRecord(candidate);
    if (record === null) return null;
    records.push(record);
  }
  return new Set(records.map((record) => record.id)).size === records.length
    ? records
    : null;
}

function parseWholeCount(value: string, maximum: number): number | null {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function clampReflection(value: string): string {
  return [...value].slice(0, MAXIMUM_REFLECTION_CHARACTERS).join('');
}

function localDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentWeekMonday(): string {
  const date = new Date();
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return localDate(date);
}

function ritualLabel(kind: ReviewWorkspaceRitualKind): string {
  switch (kind) {
    case 'daily-planning':
      return 'Daily planning';
    case 'daily-shutdown':
      return 'Daily shutdown';
    case 'weekly-review':
      return 'Weekly Review';
  }
}

function periodHeading(record: ReviewWorkspaceRecord): string {
  return record.ritualKind === 'weekly-review'
    ? `Week of ${record.periodStartDate}`
    : record.periodStartDate;
}

/**
 * Renders immutable Review history and records one Weekly Review only after an
 * explicit user ceremony. The browser never supplies workspace authority.
 */
export function ReviewClient() {
  const [state, dispatch] = useReducer(
    reduceReviewWorkspaceState,
    undefined,
    createReviewWorkspaceState,
  );
  const [periodStartDate, setPeriodStartDate] = useState('');
  const [plannedItemCount, setPlannedItemCount] = useState('0');
  const [completedItemCount, setCompletedItemCount] = useState('0');
  const [habitCompletionCount, setHabitCompletionCount] = useState('0');
  const [reflection, setReflection] = useState('');
  const [checkedSteps, setCheckedSteps] = useState<readonly boolean[]>(
    REVIEW_STEPS.map(() => false),
  );
  const loadGeneration = useRef(0);
  const submissionClaim = useRef(false);

  function releaseSubmission(): void {
    submissionClaim.current = false;
  }

  async function loadHistory(): Promise<void> {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    releaseSubmission();
    if (!navigator.onLine) {
      dispatch({ type: 'offline' });
      return;
    }
    try {
      const response = await fetch('/api/reviews/completions?limit=50', {
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
      const history = parseHistory((await response.json()) as unknown);
      if (generation !== loadGeneration.current) return;
      if (history === null) {
        dispatch({ type: 'unavailable' });
        return;
      }
      dispatch({ type: 'history-loaded', records: history });
    } catch {
      if (generation !== loadGeneration.current) return;
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  function toggleStep(index: number): void {
    setCheckedSteps((current) =>
      current.map((checked, currentIndex) =>
        currentIndex === index ? !checked : checked,
      ),
    );
  }

  async function recordWeeklyReview(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submissionClaim.current || state.submitting) return;

    const planned = parseWholeCount(plannedItemCount, 10_000);
    const completed = parseWholeCount(completedItemCount, 10_000);
    const habits = parseWholeCount(habitCompletionCount, 10_000);
    const canonicalReflection = reflection.trim();
    if (
      !isLocalDate(periodStartDate, true) ||
      planned === null ||
      completed === null ||
      completed > planned ||
      habits === null ||
      checkedSteps.some((checked) => !checked) ||
      [...canonicalReflection].length > MAXIMUM_REFLECTION_CHARACTERS ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(canonicalReflection)
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
    const completedAt = new Date().toISOString();
    const body = {
      periodStartDate,
      idempotencyKey: crypto.randomUUID(),
      completedStepCount: REVIEW_STEPS.length,
      totalStepCount: REVIEW_STEPS.length,
      plannedItemCount: planned,
      completedItemCount: completed,
      habitCompletionCount: habits,
      ...(canonicalReflection.length === 0 ? {} : { reflection: canonicalReflection }),
      completedAt,
    };

    try {
      const response = await fetch('/api/reviews/weekly-review/completions', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
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
      if (response.status === 409) {
        releaseSubmission();
        dispatch({ type: 'conflict' });
        return;
      }
      if (response.status !== 201) {
        releaseSubmission();
        dispatch({ type: 'unavailable' });
        return;
      }
      const review = parseReviewRecord((await response.json()) as unknown);
      if (
        generation !== loadGeneration.current ||
        review === null ||
        review.ritualKind !== 'weekly-review' ||
        review.periodStartDate !== periodStartDate ||
        review.completedStepCount !== REVIEW_STEPS.length ||
        review.totalStepCount !== REVIEW_STEPS.length ||
        review.plannedItemCount !== planned ||
        review.completedItemCount !== completed ||
        review.habitCompletionCount !== habits ||
        review.reflection !== (canonicalReflection || undefined) ||
        review.completedAt !== completedAt
      ) {
        releaseSubmission();
        dispatch({ type: 'unavailable' });
        return;
      }
      releaseSubmission();
      dispatch({ type: 'submit-succeeded', record: review });
      setCheckedSteps(REVIEW_STEPS.map(() => false));
      setReflection('');
    } catch {
      if (generation !== loadGeneration.current) return;
      releaseSubmission();
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  useEffect(() => {
    setPeriodStartDate(currentWeekMonday());
    void loadHistory();
    const handleOffline = () => {
      loadGeneration.current += 1;
      releaseSubmission();
      dispatch({ type: 'offline' });
    };
    const handleOnline = () => void loadHistory();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      loadGeneration.current += 1;
      releaseSubmission();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const canSubmit = state.status === 'ready' && !state.submitting;

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
          <a href="/habits">Habits</a>
          <a href="/review" aria-current="page">
            Review
          </a>
        </nav>
      </header>

      <main className={styles.main}>
        <header className={styles.workspaceHeader}>
          <p className={styles.eyebrow}>Weekly reset</p>
          <h1>Review</h1>
          <p className={styles.lede}>
            Close the week deliberately, record the outcome once, and use immutable
            history to see what changed over time.
          </p>
        </header>

        <div className={styles.workspaceGrid}>
          <section className={styles.historyPane} aria-labelledby="review-history-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Durable evidence</p>
                <h2 id="review-history-heading">Review history</h2>
              </div>
              <span aria-label={`${state.records.length} review records`}>
                {state.records.length}
              </span>
            </div>

            <div className={styles.status} aria-live="polite">
              {state.status === 'loading' ? <p>Loading Review history…</p> : null}
              {state.message ? <p>{state.message}</p> : null}
              {state.status !== 'ready' && state.status !== 'loading' ? (
                <button type="button" onClick={() => void loadHistory()}>
                  Reload durable history
                </button>
              ) : null}
            </div>

            {state.status === 'ready' && state.records.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No completed Reviews yet</h3>
                <p>Finish the checklist when you are ready to create the first immutable record.</p>
              </div>
            ) : null}

            <ol className={styles.historyList} aria-label="Completed Review history">
              {state.records.map((record) => (
                <li key={record.id}>
                  <div className={styles.historyHeading}>
                    <div>
                      <p>{ritualLabel(record.ritualKind)}</p>
                      <h3>{periodHeading(record)}</h3>
                    </div>
                    <time dateTime={record.recordedAt}>
                      {new Date(record.recordedAt).toLocaleDateString()}
                    </time>
                  </div>
                  <dl className={styles.metrics}>
                    <div>
                      <dt>Completed items</dt>
                      <dd>{record.completedItemCount} / {record.plannedItemCount}</dd>
                    </div>
                    <div>
                      <dt>Habit completions</dt>
                      <dd>{record.habitCompletionCount}</dd>
                    </div>
                  </dl>
                  {record.reflection ? <p className={styles.reflection}>{record.reflection}</p> : null}
                </li>
              ))}
            </ol>
          </section>

          <section className={styles.ritualPane} aria-labelledby="weekly-review-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Explicit completion</p>
                <h2 id="weekly-review-heading">Close the week</h2>
              </div>
            </div>

            <form className={styles.form} onSubmit={(event) => void recordWeeklyReview(event)}>
              <label>
                Week starting Monday
                <input
                  type="date"
                  required
                  value={periodStartDate}
                  onChange={(event) => setPeriodStartDate(event.target.value)}
                />
              </label>

              <fieldset>
                <legend>Review checklist</legend>
                {REVIEW_STEPS.map((step, index) => (
                  <label className={styles.checkRow} key={step}>
                    <input
                      type="checkbox"
                      checked={checkedSteps[index] ?? false}
                      onChange={() => toggleStep(index)}
                    />
                    <span>{step}</span>
                  </label>
                ))}
              </fieldset>

              <div className={styles.countGrid}>
                <label>
                  Planned items
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={plannedItemCount}
                    onChange={(event) => setPlannedItemCount(event.target.value)}
                  />
                </label>
                <label>
                  Completed items
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={completedItemCount}
                    onChange={(event) => setCompletedItemCount(event.target.value)}
                  />
                </label>
                <label>
                  Habit completions
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={habitCompletionCount}
                    onChange={(event) => setHabitCompletionCount(event.target.value)}
                  />
                </label>
              </div>

              <label>
                Reflection <span className={styles.optional}>(optional)</span>
                <textarea
                  rows={5}
                  value={reflection}
                  onChange={(event) => setReflection(clampReflection(event.target.value))}
                  aria-describedby="reflection-limit"
                />
              </label>
              <p id="reflection-limit" className={styles.fieldHint}>
                {MAXIMUM_REFLECTION_CHARACTERS - [...reflection].length} characters available
              </p>

              <button className={styles.primaryAction} type="submit" disabled={!canSubmit}>
                {state.submitting ? 'Recording Weekly Review…' : 'Record Weekly Review'}
              </button>
              <p className={styles.formNote}>
                This action records immutable Review evidence. It does not rewrite Planning or Habit records.
              </p>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
