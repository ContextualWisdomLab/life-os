'use client';

import { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  createProjectsWorkspaceState,
  reduceProjectsWorkspaceState,
  type ProjectsWorkspaceGoal,
  type ProjectsWorkspaceProject,
} from '../projects-workspace-state';
import styles from './projects.module.css';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_GOALS = 100;
const MAXIMUM_PROJECTS = 100;

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

function isCanonicalTitle(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    [...value].length > 0 &&
    [...value].length <= MAXIMUM_TITLE_CHARACTERS
  );
}

function clampTitleInput(value: string): string {
  return [...value].slice(0, MAXIMUM_TITLE_CHARACTERS).join('');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseGoal(value: unknown): ProjectsWorkspaceGoal | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'createdAt' ||
    keys[1] !== 'id' ||
    keys[2] !== 'title' ||
    typeof value.id !== 'string' ||
    !UUID_V4_PATTERN.test(value.id) ||
    !isCanonicalTitle(value.title) ||
    !isCanonicalUtcTimestamp(value.createdAt)
  ) {
    return null;
  }
  return Object.freeze({ id: value.id.toLowerCase(), title: value.title });
}

function parseGoalCollection(value: unknown): ProjectsWorkspaceGoal[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_GOALS) return null;
  const goals: ProjectsWorkspaceGoal[] = [];
  for (const candidate of value) {
    const goal = parseGoal(candidate);
    if (goal === null) return null;
    goals.push(goal);
  }
  return new Set(goals.map((goal) => goal.id)).size === goals.length ? goals : null;
}

function parseProject(
  value: unknown,
  expectedGoalId: string,
): ProjectsWorkspaceProject | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== 'createdAt' ||
    keys[1] !== 'goalId' ||
    keys[2] !== 'id' ||
    keys[3] !== 'title' ||
    typeof value.id !== 'string' ||
    !UUID_V4_PATTERN.test(value.id) ||
    typeof value.goalId !== 'string' ||
    !UUID_V4_PATTERN.test(value.goalId) ||
    value.goalId.toLowerCase() !== expectedGoalId ||
    !isCanonicalTitle(value.title) ||
    !isCanonicalUtcTimestamp(value.createdAt)
  ) {
    return null;
  }
  return Object.freeze({
    id: value.id.toLowerCase(),
    goalId: expectedGoalId,
    title: value.title,
    createdAt: value.createdAt,
  });
}

function parseProjectCollection(
  value: unknown,
  expectedGoalId: string,
): ProjectsWorkspaceProject[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_PROJECTS) return null;
  const projects: ProjectsWorkspaceProject[] = [];
  for (const candidate of value) {
    const project = parseProject(candidate, expectedGoalId);
    if (project === null) return null;
    projects.push(project);
  }
  return new Set(projects.map((project) => project.id)).size === projects.length
    ? projects
    : null;
}

/**
 * Renders the first-party Projects workspace without accepting browser-selected
 * workspace authority. Goal and Project identities come only from validated BFF
 * evidence, and late requests cannot cross the user's current Goal selection.
 */
export function ProjectsClient() {
  const [state, dispatch] = useReducer(
    reduceProjectsWorkspaceState,
    undefined,
    createProjectsWorkspaceState,
  );
  const [title, setTitle] = useState('');
  const goalLoadGeneration = useRef(0);
  const projectScopeGeneration = useRef(0);

  async function loadGoals(): Promise<void> {
    const generation = goalLoadGeneration.current + 1;
    goalLoadGeneration.current = generation;
    projectScopeGeneration.current += 1;
    if (!navigator.onLine) {
      dispatch({ type: 'offline' });
      return;
    }
    try {
      const response = await fetch('/api/planning/goals', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (generation !== goalLoadGeneration.current) return;
      if (response.status === 401) {
        dispatch({ type: 'authentication-required' });
        return;
      }
      if (response.status !== 200) {
        dispatch({ type: 'unavailable' });
        return;
      }
      const goals = parseGoalCollection((await response.json()) as unknown);
      if (generation !== goalLoadGeneration.current) return;
      if (goals === null) {
        dispatch({ type: 'unavailable' });
        return;
      }
      dispatch({ type: 'goals-loaded', goals });
    } catch {
      if (generation !== goalLoadGeneration.current) return;
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  async function selectGoal(goalId: string): Promise<void> {
    const generation = projectScopeGeneration.current + 1;
    projectScopeGeneration.current = generation;
    dispatch({ type: 'goal-selected', goalId });
    setTitle('');
    if (!navigator.onLine) {
      dispatch({ type: 'offline' });
      return;
    }
    try {
      const response = await fetch(
        `/api/planning/goals/${encodeURIComponent(goalId)}/projects`,
        {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        },
      );
      if (generation !== projectScopeGeneration.current) return;
      if (response.status === 401) {
        dispatch({ type: 'authentication-required' });
        return;
      }
      if (response.status !== 200) {
        dispatch({ type: 'unavailable' });
        return;
      }
      const projects = parseProjectCollection(
        (await response.json()) as unknown,
        goalId,
      );
      if (generation !== projectScopeGeneration.current) return;
      if (projects === null) {
        dispatch({ type: 'unavailable' });
        return;
      }
      dispatch({ type: 'projects-loaded', goalId, projects });
    } catch {
      if (generation !== projectScopeGeneration.current) return;
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const goalId = state.selectedGoalId;
    const canonicalTitle = title.trim();
    if (
      goalId === null ||
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

    const generation = projectScopeGeneration.current;
    dispatch({ type: 'submit-started' });
    try {
      const response = await fetch(
        `/api/planning/goals/${encodeURIComponent(goalId)}/projects`,
        {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ title: canonicalTitle }),
        },
      );
      if (generation !== projectScopeGeneration.current) return;
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
      const project = parseProject((await response.json()) as unknown, goalId);
      if (generation !== projectScopeGeneration.current) return;
      if (project === null || project.title !== canonicalTitle) {
        dispatch({ type: 'unavailable' });
        return;
      }
      projectScopeGeneration.current += 1;
      dispatch({ type: 'submit-succeeded', project });
      setTitle('');
    } catch {
      if (generation !== projectScopeGeneration.current) return;
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  useEffect(() => {
    void loadGoals();
    const handleOffline = () => {
      goalLoadGeneration.current += 1;
      projectScopeGeneration.current += 1;
      dispatch({ type: 'offline' });
    };
    const handleOnline = () => void loadGoals();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      goalLoadGeneration.current += 1;
      projectScopeGeneration.current += 1;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const selectedGoal = state.goals.find(
    (goal) => goal.id === state.selectedGoalId,
  );
  const canCreate =
    state.status === 'ready' &&
    state.selectedGoalId !== null &&
    !state.loadingProjects &&
    !state.submitting;

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
          <a href="/projects" aria-current="page">
            Projects
          </a>
        </nav>
      </header>

      <main className={styles.main}>
        <header className={styles.workspaceHeader}>
          <div>
            <p className={styles.eyebrow}>Planning</p>
            <h1>Projects</h1>
            <p className={styles.lede}>
              Keep delivery work attached to the durable outcome it is meant to
              serve.
            </p>
          </div>
        </header>

        <div className={styles.workspaceGrid}>
          <section className={styles.goalRail} aria-labelledby="project-goals-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Goal scope</p>
                <h2 id="project-goals-heading">Choose an outcome</h2>
              </div>
              <span>{state.goals.length}</span>
            </div>

            {state.status === 'loading' ? (
              <p className={styles.railStatus}>Loading durable goals…</p>
            ) : null}
            {state.status === 'ready' && state.goals.length === 0 ? (
              <div className={styles.emptyState}>
                <h3>No durable goals yet</h3>
                <p>Create a goal first, then return here to attach delivery work.</p>
                <a href="/goals">Create a durable goal</a>
              </div>
            ) : null}
            {state.goals.length > 0 ? (
              <div className={styles.goalChoices}>
                {state.goals.map((goal) => (
                  <button
                    key={goal.id}
                    type="button"
                    aria-pressed={goal.id === state.selectedGoalId}
                    onClick={() => void selectGoal(goal.id)}
                    disabled={state.status !== 'ready'}
                  >
                    <span>{goal.title}</span>
                    <small>
                      {goal.id === state.selectedGoalId ? 'Selected' : 'View projects'}
                    </small>
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className={styles.projectPane} aria-labelledby="durable-projects-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Durable work</p>
                <h2 id="durable-projects-heading">
                  {selectedGoal ? selectedGoal.title : 'Projects'}
                </h2>
              </div>
              <span>{state.projects.length}</span>
            </div>

            <div className={styles.status} aria-live="polite">
              {state.message ? <p>{state.message}</p> : null}
              {state.loadingProjects ? <p>Loading durable projects…</p> : null}
            </div>

            {state.selectedGoalId === null && state.goals.length > 0 ? (
              <div className={styles.emptyState}>
                <h3>No Goal selected</h3>
                <p>Select a goal to inspect its projects.</p>
              </div>
            ) : null}

            {state.selectedGoalId !== null && !state.loadingProjects ? (
              <form className={styles.creation} onSubmit={(event) => void createProject(event)}>
                <label htmlFor="project-title">Project title</label>
                <div className={styles.inputRow}>
                  <input
                    id="project-title"
                    name="title"
                    value={title}
                    onChange={(event) =>
                      setTitle(clampTitleInput(event.target.value))
                    }
                    autoComplete="off"
                    disabled={!canCreate}
                    placeholder="Ship the authenticated planning workspace"
                    aria-describedby="project-title-counter"
                  />
                  <button
                    type="submit"
                    disabled={!canCreate || title.trim().length === 0}
                  >
                    {state.submitting ? 'Creating…' : 'Create project'}
                  </button>
                </div>
                <span className={styles.counter} id="project-title-counter">
                  {[...title].length}/{MAXIMUM_TITLE_CHARACTERS}
                </span>
              </form>
            ) : null}

            {state.selectedGoalId !== null &&
            !state.loadingProjects &&
            state.projects.length === 0 &&
            state.status === 'ready' ? (
              <div className={styles.emptyState}>
                <h3>No projects under this goal yet</h3>
                <p>Create the first bounded delivery commitment above.</p>
              </div>
            ) : null}

            {state.projects.length > 0 ? (
              <ol className={styles.projectList}>
                {state.projects.map((project) => (
                  <li key={project.id}>
                    <div>
                      <strong>{project.title}</strong>
                      <span>
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={styles.durableLabel}>Durable</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
