'use client';

import { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  createGoalsWorkspaceState,
  reduceGoalsWorkspaceState,
  type GoalsWorkspaceGoal,
} from '../goals-workspace-state';
import styles from './goals.module.css';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_TITLE_CHARACTERS = 160;

function isCanonicalUtcTimestamp(value: string): boolean {
  if (!CANONICAL_UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function clampTitleInput(value: string): string {
  return [...value].slice(0, MAXIMUM_TITLE_CHARACTERS).join('');
}

function isGoal(value: unknown): value is GoalsWorkspaceGoal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  return (
    keys.length === 3 &&
    keys[0] === 'createdAt' &&
    keys[1] === 'id' &&
    keys[2] === 'title' &&
    typeof candidate.id === 'string' &&
    UUID_V4_PATTERN.test(candidate.id) &&
    typeof candidate.title === 'string' &&
    candidate.title === candidate.title.trim() &&
    [...candidate.title].length > 0 &&
    [...candidate.title].length <= MAXIMUM_TITLE_CHARACTERS &&
    typeof candidate.createdAt === 'string' &&
    isCanonicalUtcTimestamp(candidate.createdAt)
  );
}

function parseGoalCollection(value: unknown): GoalsWorkspaceGoal[] | null {
  if (!Array.isArray(value) || value.length > 100 || !value.every(isGoal)) {
    return null;
  }
  const ids = new Set(value.map((goal) => goal.id));
  return ids.size === value.length ? value : null;
}

/**
 * Renders the authenticated Goals workspace from BFF-returned durable evidence.
 * Browser credentials terminate at the BFF, workspace authority is never supplied
 * by this component, and stale loads cannot replace a newer server projection.
 */
export function GoalsClient() {
  const [state, dispatch] = useReducer(
    reduceGoalsWorkspaceState,
    undefined,
    createGoalsWorkspaceState,
  );
  const [title, setTitle] = useState('');
  const loadGeneration = useRef(0);

  async function loadGoals(): Promise<void> {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    if (!navigator.onLine) {
      dispatch({ type: 'offline' });
      return;
    }
    dispatch({ type: 'load-started' });
    try {
      const response = await fetch('/api/planning/goals', {
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
      const goals = parseGoalCollection((await response.json()) as unknown);
      if (generation !== loadGeneration.current) return;
      if (goals === null) {
        dispatch({ type: 'unavailable' });
        return;
      }
      dispatch({ type: 'load-succeeded', goals });
    } catch {
      if (generation !== loadGeneration.current) return;
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  useEffect(() => {
    void loadGoals();
    const handleOffline = () => {
      loadGeneration.current += 1;
      dispatch({ type: 'offline' });
    };
    const handleOnline = () => void loadGoals();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      loadGeneration.current += 1;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  async function createGoal(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const canonicalTitle = title.trim();
    if (
      canonicalTitle.length === 0 ||
      [...canonicalTitle].length > MAXIMUM_TITLE_CHARACTERS
    ) {
      dispatch({ type: 'invalid-title' });
      return;
    }
    if (!navigator.onLine) {
      dispatch({ type: 'offline' });
      return;
    }

    dispatch({ type: 'submit-started' });
    try {
      const response = await fetch('/api/planning/goals', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: canonicalTitle }),
      });
      if (response.status === 401) {
        dispatch({ type: 'authentication-required' });
        return;
      }
      if (response.status === 400) {
        dispatch({ type: 'invalid-title' });
        return;
      }
      if (response.status !== 201) {
        dispatch({ type: 'unavailable' });
        return;
      }
      const goal = (await response.json()) as unknown;
      if (!isGoal(goal)) {
        dispatch({ type: 'unavailable' });
        return;
      }
      loadGeneration.current += 1;
      dispatch({ type: 'submit-succeeded', goal });
      setTitle('');
    } catch {
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

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
          <a href="/goals" aria-current="page">
            Goals
          </a>
        </nav>
      </header>

      <main className={styles.main}>
        <header className={styles.workspaceHeader}>
          <div>
            <p className={styles.eyebrow}>Planning</p>
            <h1>Goals</h1>
            <p className={styles.lede}>
              Keep outcomes durable before projects and tasks start competing for
              attention.
            </p>
          </div>
          <button
            className={styles.retryButton}
            type="button"
            onClick={() => void loadGoals()}
            disabled={state.status === 'loading'}
          >
            Refresh workspace
          </button>
        </header>

        <section className={styles.creation} aria-labelledby="new-goal-heading">
          <div>
            <p className={styles.eyebrow}>New outcome</p>
            <h2 id="new-goal-heading">Create a durable goal</h2>
            <p>
              Nothing is written until you submit this form. Workspace authority
              stays server-derived.
            </p>
          </div>
          <form className={styles.form} onSubmit={(event) => void createGoal(event)}>
            <label htmlFor="goal-title">Outcome</label>
            <div className={styles.inputRow}>
              <input
                id="goal-title"
                name="title"
                value={title}
                onChange={(event) => setTitle(clampTitleInput(event.target.value))}
                autoComplete="off"
                disabled={!canCreate}
                placeholder="Publish the first reproducible LifeOS release"
                aria-describedby="goal-title-counter"
              />
              <button type="submit" disabled={!canCreate || title.trim().length === 0}>
                {state.submitting ? 'Creating…' : 'Create goal'}
              </button>
            </div>
            <span className={styles.counter} id="goal-title-counter">
              {[...title].length}/{MAXIMUM_TITLE_CHARACTERS}
            </span>
          </form>
        </section>

        <section className={styles.listSection} aria-labelledby="durable-goals-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Workspace evidence</p>
              <h2 id="durable-goals-heading">Durable goals</h2>
            </div>
            <span>{state.goals.length}</span>
          </div>

          <div className={styles.status} aria-live="polite">
            {state.status === 'loading' && <p>Loading durable goals…</p>}
            {state.message && <p>{state.message}</p>}
          </div>

          {state.status === 'ready' && state.goals.length === 0 ? (
            <div className={styles.emptyState}>
              <h3>No durable goals yet</h3>
              <p>
                Create one outcome above. Projects and tasks remain separate until
                linked deliberately.
              </p>
            </div>
          ) : null}

          {state.goals.length > 0 ? (
            <ol className={styles.goalList}>
              {state.goals.map((goal) => (
                <li key={goal.id}>
                  <div>
                    <strong>{goal.title}</strong>
                    <span>
                      Created {new Date(goal.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <span className={styles.durableLabel}>Durable</span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      </main>
    </div>
  );
}
