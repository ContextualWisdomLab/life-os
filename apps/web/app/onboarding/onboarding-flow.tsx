'use client';

import { type FormEvent, useEffect, useState } from 'react';
import {
  createFirstRunPlan,
  ONBOARDING_STORAGE_KEY,
  serializeOnboardingCompletion,
  TODAY_STORAGE_KEY,
} from './onboarding-state';
import { parseStoredTodayDraft, serializeTodayDraft } from '../today-storage';

const DURATIONS = [30, 45, 60, 90, 120] as const;

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function OnboardingFlow() {
  const [weeklyFocus, setWeeklyFocus] = useState('');
  const [actionTitle, setActionTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [message, setMessage] = useState('');
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
      setStorageReady(true);
    } catch {
      setMessage(
        'Browser storage is unavailable. LifeOS cannot safely preserve a first plan in this browser.',
      );
    }
  }, []);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!storageReady) {
      setMessage('Enable browser storage before creating a first plan.');
      return;
    }
    try {
      const date = localDate();
      const currentDraft = parseStoredTodayDraft(
        window.localStorage.getItem(TODAY_STORAGE_KEY),
        date,
      );
      const result = createFirstRunPlan({
        currentDraft,
        weeklyFocus,
        actionTitle,
        actionId: globalThis.crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...(startTime ? { startTime, durationMinutes } : {}),
      });
      window.localStorage.setItem(
        TODAY_STORAGE_KEY,
        serializeTodayDraft(result.draft),
      );
      window.localStorage.setItem(
        ONBOARDING_STORAGE_KEY,
        serializeOnboardingCompletion(result.completion),
      );
      window.location.assign('/');
    } catch (error) {
      const conflict =
        error instanceof Error && error.name === 'TodayScheduleConflictError';
      setMessage(
        conflict
          ? 'That time overlaps an existing open action. Choose another time or leave it unscheduled.'
          : 'Review the fields and try again. Existing Today actions were not changed.',
      );
    }
  }

  return (
    <main className="onboarding-shell">
      <a className="onboarding-brand" href="/" aria-label="LifeOS Today">
        <span aria-hidden="true">L</span>
        <strong>LifeOS</strong>
      </a>
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="onboarding-intro">
          <p className="eyebrow">First plan · about two minutes</p>
          <h1 id="onboarding-title">Start with one believable day.</h1>
          <p className="lede">
            Name what matters this week, choose the next visible action, and
            give it a place on today’s clock only when that helps.
          </p>
        </div>

        <form className="onboarding-form" onSubmit={submit}>
          <fieldset>
            <legend>
              <span>01</span>
              What would make this week feel meaningful?
            </legend>
            <label htmlFor="weekly-focus">Weekly focus</label>
            <input
              autoComplete="off"
              id="weekly-focus"
              maxLength={120}
              onChange={(event) => setWeeklyFocus(event.target.value)}
              placeholder="Example: Make the launch plan decision-ready"
              required
              value={weeklyFocus}
            />
            <small>{weeklyFocus.length}/120 · A direction, not a task list.</small>
          </fieldset>

          <fieldset>
            <legend>
              <span>02</span>
              What is the next visible action?
            </legend>
            <label htmlFor="first-action">First action</label>
            <input
              autoComplete="off"
              id="first-action"
              maxLength={160}
              onChange={(event) => setActionTitle(event.target.value)}
              placeholder="Example: Draft the one-page launch brief"
              required
              value={actionTitle}
            />
            <small>{actionTitle.length}/160 · Use a verb and a finish line.</small>
          </fieldset>

          <fieldset>
            <legend>
              <span>03</span>
              Does it need a time block?
            </legend>
            <p className="field-note">
              Optional. Leaving this blank keeps the action flexible.
            </p>
            <div className="onboarding-schedule">
              <label>
                Start time
                <input
                  aria-label="Optional start time"
                  onChange={(event) => setStartTime(event.target.value)}
                  step={900}
                  type="time"
                  value={startTime}
                />
              </label>
              <label>
                Duration
                <select
                  aria-label="Optional duration"
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
              </label>
            </div>
          </fieldset>

          <p className="onboarding-boundary">
            This first plan is stored only in this browser. Existing Today
            actions are preserved; LifeOS never replaces them during setup.
          </p>
          <p className="sr-status" aria-live="polite">
            {message}
          </p>
          <button className="onboarding-submit" disabled={!storageReady} type="submit">
            Build my first Today plan
          </button>
        </form>
      </section>
    </main>
  );
}
