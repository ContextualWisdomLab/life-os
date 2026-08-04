'use client';

import { type FormEvent, useState } from 'react';
import type { PlanningSearchView } from '../planning-search-client';
import styles from './quick-capture.module.css';

interface QuickCaptureProps {
  readonly onCapture: (title: string) => boolean;
}

type SearchState =
  | { status: 'idle'; results: readonly PlanningSearchView[]; message: string }
  | { status: 'loading'; results: readonly PlanningSearchView[]; message: string }
  | { status: 'ready'; results: readonly PlanningSearchView[]; message: string }
  | { status: 'error'; results: readonly PlanningSearchView[]; message: string };

function resultTypeLabel(result: PlanningSearchView): string {
  if (result.entityType === 'goal') return 'Goal';
  if (result.entityType === 'project') return 'Project';
  return result.status === 'done' ? 'Completed task' : 'Task';
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
  if (!Array.isArray(value) || value.length > 50 || !value.every(isSearchResult)) {
    throw new Error('Search response is invalid');
  }
  return value;
}

/**
 * Combines browser-local Today capture with authenticated durable workspace search.
 * The labels intentionally keep the two persistence boundaries visible.
 */
export function QuickCapture({ onCapture }: QuickCaptureProps) {
  const [captureTitle, setCaptureTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({
    status: 'idle',
    results: [],
    message: 'Durable workspace search is ready.',
  });

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
    const query = searchQuery.trim();
    if (!query) {
      setSearchState({
        status: 'error',
        results: [],
        message: 'Enter a workspace search term.',
      });
      return;
    }
    setSearchState({
      status: 'loading',
      results: [],
      message: 'Searching durable workspace records…',
    });
    try {
      const parameters = new URLSearchParams({ q: query, limit: '20' });
      const response = await fetch(`/api/planning/search?${parameters}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.status === 401) {
        setSearchState({
          status: 'error',
          results: [],
          message: 'Sign in to search durable workspace records.',
        });
        return;
      }
      if (!response.ok) {
        throw new Error('Search request failed');
      }
      const results = parseClientResults(await response.json());
      setSearchState({
        status: 'ready',
        results,
        message:
          results.length === 0
            ? 'No durable workspace records matched.'
            : `${results.length} durable workspace result${results.length === 1 ? '' : 's'} found.`,
      });
    } catch {
      setSearchState({
        status: 'error',
        results: [],
        message: 'Workspace search is temporarily unavailable.',
      });
    }
  }

  return (
    <section className={styles.shell} aria-labelledby="quick-capture-heading">
      <div className={styles.heading}>
        <div>
          <p className="eyebrow">Capture and retrieve</p>
          <h2 id="quick-capture-heading">Find the next visible action.</h2>
        </div>
        <span>Local + durable</span>
      </div>

      <div className={styles.grid}>
        <form
          className="capture-bar"
          onSubmit={capture}
          aria-label="Capture a browser-local action"
        >
          <label htmlFor="capture-title">Capture locally for Today</label>
          <div>
            <input
              id="capture-title"
              maxLength={160}
              onChange={(event) => setCaptureTitle(event.target.value)}
              placeholder="Write the next visible action…"
              value={captureTitle}
            />
            <button type="submit">Capture</button>
          </div>
          <small>
            {captureTitle.length}/160 · Stored only in this browser until sync is
            connected.
          </small>
        </form>

        <form
          className={styles.search}
          onSubmit={(event) => void search(event)}
          role="search"
          aria-label="Search durable workspace planning records"
        >
          <label htmlFor="workspace-search-query">Search durable workspace</label>
          <div>
            <input
              id="workspace-search-query"
              maxLength={120}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Goal, project, or task title…"
              value={searchQuery}
            />
            <button type="submit" disabled={searchState.status === 'loading'}>
              {searchState.status === 'loading' ? 'Searching…' : 'Search'}
            </button>
          </div>
          <small>Authenticated workspace records; local drafts are excluded.</small>
        </form>
      </div>

      <p className={styles.status} role="status" aria-live="polite">
        {searchState.message}
      </p>

      {searchState.status === 'ready' && searchState.results.length > 0 ? (
        <ul className={styles.results} aria-label="Workspace search results">
          {searchState.results.map((result) => (
            <li key={`${result.entityType}:${result.id}`}>
              <span>{resultTypeLabel(result)}</span>
              <strong>{result.title}</strong>
              <small>
                Durable record · {new Date(result.createdAt).toLocaleDateString()}
              </small>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
