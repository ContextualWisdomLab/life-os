'use client';

import { useEffect, useMemo, useState } from 'react';
import { QuickCapture } from './components/quick-capture';
import {
  addTodayAction,
  clearTodaySchedule,
  createEmptyTodayDraft,
  formatMinuteOfDay,
  parseTimeInput,
  scheduleTodayAction,
  TodayPriorityLimitError,
  TodayScheduleConflictError,
  type TodayAction,
  type TodayDraft,
  toggleTodayCompletion,
  toggleTodayPriority,
} from './today-state';
import { parseStoredTodayDraft, serializeTodayDraft } from './today-storage';

const STORAGE_KEY = 'life-os.today-draft.v1';
const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

/** Returns the browser-local calendar date without relying on UTC conversion. */
function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Renders one local action's optional time block for the Today workspace. */
function scheduleLabel(action: TodayAction): string {
  if (action.startMinute === null || action.durationMinutes === null) {
    return 'Not scheduled';
  }
  const endMinute = action.startMinute + action.durationMinutes;
  const end = endMinute === 24 * 60 ? '24:00' : formatMinuteOfDay(endMinute);
  return `${formatMinuteOfDay(action.startMinute)}–${end}`;
}

/** Renders the browser-local Today workspace and durable planning search surface. */
export function TodayClient({ generatedAt }: { readonly generatedAt: string }) {
  const initialDate = generatedAt.slice(0, 10);
  const [date, setDate] = useState(initialDate);
  const [draft, setDraft] = useState<TodayDraft>(() =>
    createEmptyTodayDraft(initialDate),
  );
  const [message, setMessage] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const browserDate = localDate();
    let serialized: string | null = null;
    try {
      serialized = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      setMessage(
        'Browser storage is unavailable. This tab remains usable, but changes will not survive a reload.',
      );
    }
    setDate(browserDate);
    setDraft(parseStoredTodayDraft(serialized, browserDate));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, serializeTodayDraft(draft));
    } catch {
      setMessage(
        'The local draft could not be saved. This tab remains usable, but changes may not survive a reload.',
      );
    }
  }, [draft, hydrated]);

  const priorities = useMemo(
    () =>
      draft.actions
        .filter((action) => action.priority !== null)
        .sort((left, right) =>
          (left.priority ?? 0) - (right.priority ?? 0),
        ),
    [draft.actions],
  );
  const backlog = draft.actions.filter(
    (action) => action.status === 'open' && action.priority === null,
  );
  const completed = draft.actions.filter((action) => action.status === 'done');

  /** Applies one immutable Today-state change and maps closed domain errors. */
  function update(operation: () => TodayDraft, success = ''): boolean {
    try {
      setDraft(operation());
      setMessage(success);
      return true;
    } catch (error) {
      if (error instanceof TodayPriorityLimitError) {
        setMessage('Three priorities are already committed. Release one first.');
      } else if (error instanceof TodayScheduleConflictError) {
        setMessage('That time overlaps another open priority.');
      } else {
        setMessage('That change could not be applied safely.');
      }
      return false;
    }
  }

  /** Captures one explicitly local action without implying durable synchronization. */
  function capture(actionTitle: string): boolean {
    const title = actionTitle.trim();
    if (!title) {
      setMessage('Enter an action before adding it.');
      return false;
    }
    return update(
      () =>
        addTodayAction(draft, {
          id: globalThis.crypto.randomUUID(),
          title,
          createdAt: new Date().toISOString(),
        }),
      'Action captured locally. Commit it only when it belongs in today’s top three.',
    );
  }

  /** Applies or clears a conflict-checked local time block. */
  function schedule(
    action: TodayAction,
    start: string,
    duration: number,
  ): void {
    if (!start) {
      update(() => clearTodaySchedule(draft, action.id), 'Schedule cleared.');
      return;
    }
    update(
      () =>
        scheduleTodayAction(
          draft,
          action.id,
          parseTimeInput(start),
          duration,
        ),
      'Time block saved locally.',
    );
  }

  return (
    <div className="today-shell">
      <aside className="today-sidebar" aria-label="LifeOS navigation">
        <a className="today-brand" href="#today">
          <span aria-hidden="true">L</span>
          <strong>LifeOS</strong>
        </a>
        <nav aria-label="Primary navigation">
          <a className="active" href="#today" aria-current="page">
            Today
          </a>
          <a href="#backlog">Backlog</a>
          <a href="#completed">Completed</a>
        </nav>
        <p className="local-note">
          <strong>Local draft</strong>
          <span>Saved in this browser until workspace sync is connected.</span>
        </p>
      </aside>

      <main className="today-main" id="today">
        <header className="today-header">
          <div>
            <p className="eyebrow">Today · {date}</p>
            <h1>Make today believable.</h1>
            <p className="lede">
              Capture what is pulling at your attention, commit to no more than
              three priorities, and give each one an honest place on the clock.
            </p>
          </div>
          <div
            className="progress-card"
            aria-label={`${completed.length} actions completed`}
          >
            <strong>{completed.length}</strong>
            <span>finished</span>
          </div>
        </header>

        <QuickCapture onCapture={capture} />
        <p className="sr-status" aria-live="polite">
          {message}
        </p>

        <section aria-labelledby="priority-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Commitment</p>
              <h2 id="priority-heading">Your three priorities</h2>
            </div>
            <span className="capacity-pill">{priorities.length} / 3</span>
          </div>
          {priorities.length === 0 ? (
            <div className="empty-state">
              <span aria-hidden="true">01</span>
              <div>
                <h3>No priorities yet</h3>
                <p>
                  Capture actions, then commit only the three that make today
                  successful.
                </p>
              </div>
            </div>
          ) : (
            <ol className="priority-list">
              {priorities.map((action) => (
                <li
                  key={action.id}
                  className={action.status === 'done' ? 'is-done' : ''}
                >
                  <span className="priority-number">
                    {String(action.priority).padStart(2, '0')}
                  </span>
                  <div className="priority-content">
                    <div className="priority-row">
                      <div>
                        <h3>{action.title}</h3>
                        <p>{scheduleLabel(action)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            () =>
                              toggleTodayCompletion(
                                draft,
                                action.id,
                                new Date().toISOString(),
                              ),
                            action.status === 'done'
                              ? 'Action reopened.'
                              : 'Action completed.',
                          )
                        }
                      >
                        {action.status === 'done' ? 'Reopen' : 'Complete'}
                      </button>
                    </div>
                    <div className="schedule-controls">
                      <label>
                        Start
                        <input
                          aria-label={`Start time for ${action.title}`}
                          disabled={action.status === 'done'}
                          onChange={(event) =>
                            schedule(
                              action,
                              event.target.value,
                              action.durationMinutes ?? 60,
                            )
                          }
                          step={900}
                          type="time"
                          value={
                            action.startMinute === null
                              ? ''
                              : formatMinuteOfDay(action.startMinute)
                          }
                        />
                      </label>
                      <label>
                        Duration
                        <select
                          aria-label={`Duration for ${action.title}`}
                          disabled={action.status === 'done'}
                          onChange={(event) =>
                            action.startMinute === null
                              ? undefined
                              : schedule(
                                  action,
                                  formatMinuteOfDay(action.startMinute),
                                  Number(event.target.value),
                                )
                          }
                          value={action.durationMinutes ?? 60}
                        >
                          {DURATIONS.map((minutes) => (
                            <option key={minutes} value={minutes}>
                              {minutes} min
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          update(
                            () => toggleTodayPriority(draft, action.id),
                            'Priority returned to backlog.',
                          )
                        }
                      >
                        Release priority
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="lower-grid">
          <section
            className="list-card"
            id="backlog"
            aria-labelledby="backlog-heading"
          >
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Uncommitted</p>
                <h2 id="backlog-heading">Backlog</h2>
              </div>
              <span>{backlog.length}</span>
            </div>
            {backlog.length === 0 ? (
              <p className="quiet-empty">
                Nothing waiting. Capture ideas without promising them.
              </p>
            ) : (
              <ul className="backlog-list">
                {backlog.map((action) => (
                  <li key={action.id}>
                    <span>{action.title}</span>
                    <button
                      type="button"
                      disabled={priorities.length >= 3}
                      onClick={() =>
                        update(
                          () => toggleTodayPriority(draft, action.id),
                          'Priority committed.',
                        )
                      }
                    >
                      Make priority
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section
            className="list-card"
            id="completed"
            aria-labelledby="completed-heading"
          >
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Evidence</p>
                <h2 id="completed-heading">Completed</h2>
              </div>
              <span>{completed.length}</span>
            </div>
            {completed.length === 0 ? (
              <p className="quiet-empty">
                Finished actions remain visible here.
              </p>
            ) : (
              <ul className="completed-list">
                {completed.map((action) => (
                  <li key={action.id}>
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>{action.title}</strong>
                      <small>{scheduleLabel(action)}</small>
                    </div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        update(
                          () =>
                            toggleTodayCompletion(
                              draft,
                              action.id,
                              new Date().toISOString(),
                            ),
                          'Action reopened.',
                        )
                      }
                    >
                      Reopen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
