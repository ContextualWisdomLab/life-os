'use client';

import { useEffect, useMemo, useState } from 'react';
import { QuickCapture } from './components/quick-capture';
import { TodayWorkspaceSyncPanel } from './components/today-workspace-sync-panel';
import {
  chooseSupportedLocale,
  formatMessage,
  getMessageCatalog,
  resolveSupportedLocale,
  type MessageKey,
  type SupportedLocale,
} from './localization';
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

const DRAFT_STORAGE_KEY = 'life-os.today-draft.v1';
const LOCALE_STORAGE_KEY = 'life-os.locale.v1';
const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function scheduleLabel(action: TodayAction, notScheduled: string): string {
  if (action.startMinute === null || action.durationMinutes === null) {
    return notScheduled;
  }
  const endMinute = action.startMinute + action.durationMinutes;
  const end = endMinute === 24 * 60 ? '24:00' : formatMinuteOfDay(endMinute);
  return `${formatMinuteOfDay(action.startMinute)}–${end}`;
}

export function TodayClient({ generatedAt }: { readonly generatedAt: string }) {
  const initialDate = generatedAt.slice(0, 10);
  const [date, setDate] = useState(initialDate);
  const [draft, setDraft] = useState<TodayDraft>(() =>
    createEmptyTodayDraft(initialDate),
  );
  const [messageKey, setMessageKey] = useState<MessageKey | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const messages = getMessageCatalog(locale);

  useEffect(() => {
    let savedLocale: string | null = null;
    try {
      savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      setMessageKey('storageUnavailable');
    }
    const resolvedLocale = chooseSupportedLocale(
      savedLocale,
      navigator.languages,
    );
    setLocale(resolvedLocale);
    document.documentElement.lang = resolvedLocale;
  }, []);

  useEffect(() => {
    const browserDate = localDate();
    let serialized: string | null = null;
    try {
      serialized = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    } catch {
      setMessageKey('storageUnavailable');
    }
    setDate(browserDate);
    setDraft(parseStoredTodayDraft(serialized, browserDate));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        DRAFT_STORAGE_KEY,
        serializeTodayDraft(draft),
      );
    } catch {
      setMessageKey('storageSaveUnavailable');
    }
  }, [draft, hydrated]);

  const priorities = useMemo(
    () =>
      draft.actions
        .filter((action) => action.priority !== null)
        .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0)),
    [draft.actions],
  );
  const backlog = draft.actions.filter(
    (action) => action.status === 'open' && action.priority === null,
  );
  const completed = draft.actions.filter((action) => action.status === 'done');

  function changeLocale(value: string): void {
    const nextLocale = resolveSupportedLocale(value) ?? 'en';
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      setMessageKey('storageSaveUnavailable');
    }
  }

  function update(
    operation: () => TodayDraft,
    successKey: MessageKey | null = null,
  ): boolean {
    try {
      setDraft(operation());
      setMessageKey(successKey);
      return true;
    } catch (error) {
      if (error instanceof TodayPriorityLimitError) {
        setMessageKey('priorityLimitError');
      } else if (error instanceof TodayScheduleConflictError) {
        setMessageKey('scheduleConflictError');
      } else {
        setMessageKey('changeFailedError');
      }
      return false;
    }
  }

  function capture(actionTitle: string): boolean {
    const title = actionTitle.trim();
    if (!title) {
      setMessageKey('captureEmptyError');
      return false;
    }
    return update(
      () =>
        addTodayAction(draft, {
          id: globalThis.crypto.randomUUID(),
          title,
          createdAt: new Date().toISOString(),
        }),
      'captureSuccess',
    );
  }

  function schedule(
    action: TodayAction,
    start: string,
    duration: number,
  ): void {
    if (!start) {
      update(() => clearTodaySchedule(draft, action.id), 'scheduleCleared');
      return;
    }
    update(
      () =>
        scheduleTodayAction(draft, action.id, parseTimeInput(start), duration),
      'scheduleSaved',
    );
  }

  return (
    <div className="today-shell">
      <aside className="today-sidebar" aria-label={messages.lifeOsNavigation}>
        <a className="today-brand" href="#today">
          <span aria-hidden="true">L</span>
          <strong>LifeOS</strong>
        </a>
        <nav aria-label={messages.primaryNavigation}>
          <a className="active" href="#today" aria-current="page">
            {messages.todayNavigation}
          </a>
          <a href="#backlog">{messages.backlogNavigation}</a>
          <a href="#completed">{messages.completedNavigation}</a>
        </nav>
        <label className="locale-control">
          <span>{messages.languageLabel}</span>
          <select
            aria-label={messages.languageLabel}
            onChange={(event) => changeLocale(event.target.value)}
            value={locale}
          >
            <option value="en">{messages.languageEnglish}</option>
            <option value="ko">{messages.languageKorean}</option>
          </select>
        </label>
        <p className="local-note">
          <strong>{messages.localDraftTitle}</strong>
          <span>{messages.localDraftDescription}</span>
        </p>
      </aside>

      <main className="today-main" id="today">
        <header className="today-header">
          <div>
            <p className="eyebrow">
              {formatMessage(messages, 'todayDate', { date })}
            </p>
            <h1>{messages.todayHeading}</h1>
            <p className="lede">{messages.todayDescription}</p>
          </div>
          <div
            className="progress-card"
            aria-label={formatMessage(messages, 'completedCountLabel', {
              count: completed.length,
            })}
          >
            <strong>{completed.length}</strong>
            <span>{messages.finishedLabel}</span>
          </div>
        </header>

        <QuickCapture locale={locale} messages={messages} onCapture={capture} />
        <TodayWorkspaceSyncPanel
          draft={draft}
          messages={messages}
          onUseDraft={(workspaceDraft) => {
            setDraft(workspaceDraft);
            setMessageKey(null);
          }}
        />
        <p className="sr-status" aria-live="polite">
          {messageKey ? messages[messageKey] : ''}
        </p>

        <section aria-labelledby="priority-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{messages.commitmentEyebrow}</p>
              <h2 id="priority-heading">{messages.prioritiesHeading}</h2>
            </div>
            <span className="capacity-pill">{priorities.length} / 3</span>
          </div>
          {priorities.length === 0 ? (
            <div className="empty-state">
              <span aria-hidden="true">01</span>
              <div>
                <h3>{messages.noPrioritiesHeading}</h3>
                <p>{messages.noPrioritiesDescription}</p>
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
                        <p>{scheduleLabel(action, messages.notScheduled)}</p>
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
                              ? 'actionReopened'
                              : 'actionCompleted',
                          )
                        }
                      >
                        {action.status === 'done'
                          ? messages.reopenAction
                          : messages.completeAction}
                      </button>
                    </div>
                    <div className="schedule-controls">
                      <label>
                        {messages.startLabel}
                        <input
                          aria-label={formatMessage(messages, 'startTimeFor', {
                            title: action.title,
                          })}
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
                        {messages.durationLabel}
                        <select
                          aria-label={formatMessage(messages, 'durationFor', {
                            title: action.title,
                          })}
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
                              {formatMessage(messages, 'durationMinutes', {
                                minutes,
                              })}
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
                            'priorityReleased',
                          )
                        }
                      >
                        {messages.releasePriority}
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
                <p className="eyebrow">{messages.uncommittedEyebrow}</p>
                <h2 id="backlog-heading">{messages.backlogHeading}</h2>
              </div>
              <span>{backlog.length}</span>
            </div>
            {backlog.length === 0 ? (
              <p className="quiet-empty">{messages.backlogEmpty}</p>
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
                          'priorityCommitted',
                        )
                      }
                    >
                      {messages.makePriority}
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
                <p className="eyebrow">{messages.evidenceEyebrow}</p>
                <h2 id="completed-heading">{messages.completedHeading}</h2>
              </div>
              <span>{completed.length}</span>
            </div>
            {completed.length === 0 ? (
              <p className="quiet-empty">{messages.completedEmpty}</p>
            ) : (
              <ul className="completed-list">
                {completed.map((action) => (
                  <li key={action.id}>
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>{action.title}</strong>
                      <small>
                        {scheduleLabel(action, messages.notScheduled)}
                      </small>
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
                          'actionReopened',
                        )
                      }
                    >
                      {messages.reopenAction}
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
