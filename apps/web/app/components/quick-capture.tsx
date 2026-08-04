'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  formatMessage,
  type MessageCatalog,
  type SupportedLocale,
} from '../localization';
import type { PlanningSearchView } from '../planning-search-client';
import {
  isPlanningSearchAbort,
  LatestPlanningSearchRequest,
  normalizePlanningSearchQuery,
} from './planning-search-state';
import styles from './quick-capture.module.css';

interface QuickCaptureProps {
  readonly locale: SupportedLocale;
  readonly messages: MessageCatalog;
  readonly onCapture: (title: string) => boolean;
}

type SearchState =
  | { status: 'idle'; results: readonly PlanningSearchView[] }
  | { status: 'loading'; results: readonly PlanningSearchView[] }
  | { status: 'ready'; results: readonly PlanningSearchView[] }
  | {
      status: 'error';
      results: readonly PlanningSearchView[];
      reason: 'minimum' | 'sign_in' | 'unavailable';
    };

function resultTypeLabel(
  result: PlanningSearchView,
  messages: MessageCatalog,
): string {
  if (result.entityType === 'goal') return messages.goalType;
  if (result.entityType === 'project') return messages.projectType;
  return result.status === 'done'
    ? messages.completedTaskType
    : messages.taskType;
}

function isSearchResult(value: unknown): value is PlanningSearchView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.entityType === 'goal' ||
      record.entityType === 'project' ||
      record.entityType === 'task') &&
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.createdAt === 'string'
  );
}

function parseClientResults(value: unknown): PlanningSearchView[] {
  if (
    !Array.isArray(value) ||
    value.length > 25 ||
    !value.every(isSearchResult)
  ) {
    throw new Error('Search response is invalid');
  }
  return value;
}

function searchStatusMessage(
  state: SearchState,
  messages: MessageCatalog,
): string {
  if (state.status === 'idle') return messages.searchReady;
  if (state.status === 'loading') return messages.searchingStatus;
  if (state.status === 'error') {
    if (state.reason === 'minimum') return messages.searchMinimum;
    if (state.reason === 'sign_in') return messages.searchSignIn;
    return messages.searchUnavailable;
  }
  if (state.results.length === 0) return messages.searchEmpty;
  if (state.results.length === 1) return messages.searchResultSingle;
  return formatMessage(messages, 'searchResultCount', {
    count: state.results.length,
  });
}

/**
 * Combines browser-local Today capture with authenticated durable workspace search.
 * The labels intentionally keep the two persistence boundaries visible.
 */
export function QuickCapture({
  locale,
  messages,
  onCapture,
}: QuickCaptureProps) {
  const [captureTitle, setCaptureTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({
    status: 'idle',
    results: [],
  });
  const latestSearch = useRef(new LatestPlanningSearchRequest());

  useEffect(
    () => () => {
      latestSearch.current.cancel();
    },
    [],
  );

  function capture(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const title = captureTitle.trim();
    if (!title) return;
    if (onCapture(title)) {
      setCaptureTitle('');
    }
  }

  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const query = normalizePlanningSearchQuery(searchQuery);
    if (query.length < 2) {
      setSearchState({
        status: 'error',
        results: [],
        reason: 'minimum',
      });
      return;
    }

    const controller = latestSearch.current.begin();
    setSearchState({ status: 'loading', results: [] });
    try {
      const parameters = new URLSearchParams({ q: query, limit: '20' });
      const response = await fetch(`/api/planning/search?${parameters}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!latestSearch.current.isCurrent(controller)) return;
      if (response.status === 401) {
        setSearchState({
          status: 'error',
          results: [],
          reason: 'sign_in',
        });
        return;
      }
      if (!response.ok) {
        throw new Error('Search request failed');
      }
      const results = parseClientResults(await response.json());
      if (!latestSearch.current.isCurrent(controller)) return;
      setSearchState({ status: 'ready', results });
    } catch (error) {
      if (
        isPlanningSearchAbort(error) ||
        !latestSearch.current.isCurrent(controller)
      ) {
        return;
      }
      setSearchState({
        status: 'error',
        results: [],
        reason: 'unavailable',
      });
    } finally {
      latestSearch.current.finish(controller);
    }
  }

  return (
    <section className={styles.shell} aria-labelledby="quick-capture-heading">
      <div className={styles.heading}>
        <div>
          <p className="eyebrow">{messages.captureRetrieveEyebrow}</p>
          <h2 id="quick-capture-heading">{messages.quickCaptureHeading}</h2>
        </div>
        <span>{messages.localDurableBadge}</span>
      </div>

      <div className={styles.grid}>
        <form
          className={styles.capture}
          onSubmit={capture}
          aria-label={messages.captureFormLabel}
        >
          <label htmlFor="capture-title">{messages.captureInputLabel}</label>
          <div>
            <input
              id="capture-title"
              maxLength={160}
              onChange={(event) => setCaptureTitle(event.target.value)}
              placeholder={messages.capturePlaceholder}
              value={captureTitle}
            />
            <button type="submit">{messages.captureButton}</button>
          </div>
          <small>
            {formatMessage(messages, 'captureCounter', {
              count: captureTitle.length,
            })}
          </small>
        </form>

        <form
          className={styles.search}
          onSubmit={(event) => void search(event)}
          role="search"
          aria-label={messages.searchFormLabel}
        >
          <label htmlFor="workspace-search-query">
            {messages.searchInputLabel}
          </label>
          <div>
            <input
              id="workspace-search-query"
              maxLength={120}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={messages.searchPlaceholder}
              value={searchQuery}
            />
            <button type="submit" disabled={searchState.status === 'loading'}>
              {searchState.status === 'loading'
                ? messages.searchingButton
                : messages.searchButton}
            </button>
          </div>
          <small>{messages.searchHelper}</small>
        </form>
      </div>

      <p className={styles.status} role="status" aria-live="polite">
        {searchStatusMessage(searchState, messages)}
      </p>

      {searchState.status === 'ready' && searchState.results.length > 0 ? (
        <ul
          className={styles.results}
          aria-label={messages.workspaceResultsLabel}
        >
          {searchState.results.map((result) => (
            <li key={`${result.entityType}:${result.id}`}>
              <span>{resultTypeLabel(result, messages)}</span>
              <strong>{result.title}</strong>
              <small>
                {formatMessage(messages, 'durableRecordDate', {
                  date: new Date(result.createdAt).toLocaleDateString(
                    locale === 'ko' ? 'ko-KR' : 'en-US',
                  ),
                })}
              </small>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
