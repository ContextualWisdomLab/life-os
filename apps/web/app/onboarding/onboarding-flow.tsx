'use client';

import { type FormEvent, useState } from 'react';
import {
  addTodayAction,
  parseTimeInput,
  scheduleTodayAction,
  toggleTodayPriority,
} from '../today-state';
import {
  parseStoredTodayDraft,
  serializeTodayDraft,
} from '../today-storage';
import styles from './onboarding.module.css';

const TODAY_STORAGE_KEY = 'life-os.today-draft.v1';
const ONBOARDING_STORAGE_KEY = 'life-os.onboarding-completion.v1';
const DURATIONS = [30, 45, 60, 90, 120] as const;

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Restores one browser-storage entry to its exact pre-submit value. */
function restoreStorageValue(key: string, value: string | null): void {
  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, value);
}

/**
 * Converts one concrete first-run commitment into a non-destructive Today draft.
 * All state remains browser-local until authenticated workspace sync is available.
 */
export function OnboardingFlow({
  generatedAt,
}: {
  readonly generatedAt: string;
}) {
  const [focus, setFocus] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function completeOnboarding(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalizedFocus = focus.trim();
    const normalizedAction = actionTitle.trim();
    if (!normalizedFocus || !normalizedAction) {
      setMessage('Name a direction and one visible next action.');
      return;
    }

    setSubmitting(true);
    let previousToday: string | null | undefined;
    let previousCompletion: string | null | undefined;
    try {
      const date = localDate();
      const stored = window.localStorage.getItem(TODAY_STORAGE_KEY);
      previousToday = stored;
      previousCompletion = window.localStorage.getItem(
        ONBOARDING_STORAGE_KEY,
      );
      let draft = parseStoredTodayDraft(stored, date);
      const actionId = globalThis.crypto.randomUUID();
      draft = addTodayAction(draft, {
        id: actionId,
        title: normalizedAction,
        createdAt: new Date().toISOString(),
      });

      const committedPriorities = draft.actions.filter(
        (action) => action.priority !== null,
      ).length;
      if (committedPriorities < 3) {
        draft = toggleTodayPriority(draft, actionId);
        if (startTime) {
          draft = scheduleTodayAction(
            draft,
            actionId,
            parseTimeInput(startTime),
            durationMinutes,
          );
        }
      }

      window.localStorage.setItem(
        TODAY_STORAGE_KEY,
        serializeTodayDraft(draft),
      );
      window.localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        JSON.stringify({
          version: 'life-os.onboarding-completion.v1',
          completedAt: new Date().toISOString(),
        }),
      );
      window.location.assign('/');
    } catch {
      setSubmitting(false);
      let restored = false;
      if (previousToday !== undefined && previousCompletion !== undefined) {
        try {
          restoreStorageValue(TODAY_STORAGE_KEY, previousToday);
          restoreStorageValue(ONBOARDING_STORAGE_KEY, previousCompletion);
          restored = true;
        } catch {
          // Browser storage is unavailable; keep the user on this page.
        }
      }
      setMessage(
        restored
          ? 'Your browser could not save the complete plan safely. Your previous Today draft was restored.'
          : 'Your browser could not save the plan safely. Review Today before trying again.',
      );
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.intro} aria-labelledby="onboarding-heading">
        <a className={styles.brand} href="/" aria-label="LifeOS home">
          <span aria-hidden="true">L</span>
          <strong>LifeOS</strong>
        </a>
        <p className={styles.eyebrow}>First plan · {generatedAt.slice(0, 10)}</p>
        <h1 id="onboarding-heading">Start with one believable commitment.</h1>
        <p className={styles.lede}>
          LifeOS works best when a direction becomes a visible action with an
          honest place on today’s clock. This takes about a minute.
        </p>
        <div className={styles.boundary}>
          <strong>Local-first boundary</strong>
          <p>
            This first plan is saved only in this browser. It is not synchronized
            to an account or shared workspace yet.
          </p>
        </div>
      </section>

      <section className={styles.card} aria-label="Create your first plan">
        <form onSubmit={completeOnboarding}>
          <div className={styles.step}>
            <span aria-hidden="true">01</span>
            <div>
              <label htmlFor="onboarding-focus">
                What direction matters most right now?
              </label>
              <p>Use a short outcome, not a list of everything you could do.</p>
              <input
                id="onboarding-focus"
                autoComplete="off"
                maxLength={120}
                onChange={(event) => setFocus(event.target.value)}
                placeholder="Prepare a calm product launch"
                value={focus}
              />
              <small>{focus.length}/120</small>
            </div>
          </div>

          <div className={styles.step}>
            <span aria-hidden="true">02</span>
            <div>
              <label htmlFor="onboarding-action">
                What is the next visible action?
              </label>
              <p>Choose something you can start without another planning session.</p>
              <input
                id="onboarding-action"
                autoComplete="off"
                maxLength={160}
                onChange={(event) => setActionTitle(event.target.value)}
                placeholder="Review the release evidence"
                value={actionTitle}
              />
              <small>{actionTitle.length}/160</small>
            </div>
          </div>

          <fieldset className={styles.step}>
            <legend className={styles.srOnly}>Optional time block</legend>
            <span aria-hidden="true">03</span>
            <div>
              <label htmlFor="onboarding-start">When will you begin?</label>
              <p>Optional. Leaving this blank still creates the priority.</p>
              <div className={styles.schedule}>
                <input
                  id="onboarding-start"
                  aria-label="Start time"
                  onChange={(event) => setStartTime(event.target.value)}
                  step={900}
                  type="time"
                  value={startTime}
                />
                <select
                  aria-label="Duration"
                  disabled={!startTime}
                  onChange={(event) =>
                    setDurationMinutes(Number(event.target.value))
                  }
                  value={durationMinutes}
                >
                  {DURATIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <p className={styles.status} aria-live="polite">
            {message}
          </p>
          <div className={styles.actions}>
            <a href="/">Skip for now</a>
            <button disabled={submitting} type="submit">
              {submitting ? 'Saving…' : 'Create my first plan'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
