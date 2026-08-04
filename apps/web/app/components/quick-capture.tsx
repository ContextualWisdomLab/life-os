'use client';

import { type FormEvent, useState } from 'react';
import type { PlanningSearchView } from '../planning-search-client';

/** Properties required by the Today quick-capture and search surface. */
interface QuickCaptureProps {
  readonly onCapture: (title: string) => boolean;
}

/** Closed client state for durable workspace search. */
type SearchState =
  | { status: 'idle'; results: readonly PlanningSearchView[]; message: string }
  | {
      status: 'loading';
      results: readonly PlanningSearchView[];
      message: string;
    }
  | { status: 'ready'; results: readonly PlanningSearchView[]; message: string }
  | {
      status: 'error';
      results: readonly PlanningSearchView[];
      message: string;
    };

/** Returns a concise human label for one planning entity. */
function resultTypeLabel(result: PlanningSearchView): string {
  if (result.entityType === 'goal') return 'Goal';
  if (result.entityType === 'project') return 'Project';
  return result.status === 'done' ? 'Completed task' : 'Task';
}

/** Performs a minimal client-side shape check after the validated BFF response. */
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

/** Rejects oversized or malformed client result collections. */
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

  /** Adds a local Today action without implying durable synchronization. */
  function capture(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const title = captureTitle.trim();
    if (!title) return;
    if (onCapture(title)) {
      setCaptureTitle('');
    }
  }

  /** Searches the authenticated durable workspace through the same-origin BFF. */
  async function search(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchState({
        status: 'error',
        results: [],
        message: 'Enter at least two characters to search the workspace.',
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
    <section aria-labelledby="quick-capture-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Capture and retrieve</p>
          <h2 id="quick-capture-heading">Find the next visible action.</h2>
        </div>
        <span className="capacity-pill">Local + durable</span>
      </div>

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
        className="capture-bar"
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
        <small>Authenticated records; browser-local drafts are excluded.</small>
      </form>

      <p className="sr-status" role="status" aria-live="polite">
        {searchState.message}
      </p>

      {searchState.status === 'ready' && searchState.results.length > 0 ? (
        <section className="list-card" aria-labelledby="search-results-heading">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Durable workspace</p>
              <h2 id="search-results-heading">Search results</h2>
            </div>
            <span>{searchState.results.length}</span>
          </div>
          <ul className="backlog-list" aria-label="Workspace search results">
            {searchState.results.map((result) => (
              <li key={`${result.entityType}:${result.id}`}>
                <span>
                  <strong>{result.title}</strong>
                  <br />
                  <small>
                    {resultTypeLabel(result)} ·{' '}
                    {new Date(result.createdAt).toLocaleDateString()}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
