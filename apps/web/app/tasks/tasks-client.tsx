'use client';

import { FormEvent, useEffect, useReducer, useRef, useState } from 'react';
import {
  createTasksWorkspaceState,
  reduceTasksWorkspaceState,
  type TasksWorkspaceGoal,
  type TasksWorkspaceProject,
  type TasksWorkspaceTask,
} from '../tasks-workspace-state';
import styles from './tasks.module.css';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_GOALS = 100;
const MAXIMUM_PROJECTS = 100;
const MAXIMUM_TASKS = 100;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

function parseGoal(value: unknown): TasksWorkspaceGoal | null {
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

function parseGoalCollection(value: unknown): TasksWorkspaceGoal[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_GOALS) return null;
  const goals: TasksWorkspaceGoal[] = [];
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
): TasksWorkspaceProject | null {
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
  });
}

function parseProjectCollection(
  value: unknown,
  expectedGoalId: string,
): TasksWorkspaceProject[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_PROJECTS) return null;
  const projects: TasksWorkspaceProject[] = [];
  for (const candidate of value) {
    const project = parseProject(candidate, expectedGoalId);
    if (project === null) return null;
    projects.push(project);
  }
  return new Set(projects.map((project) => project.id)).size === projects.length
    ? projects
    : null;
}

function parseTask(
  value: unknown,
  expectedProjectId: string,
): TasksWorkspaceTask | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 5 ||
    keys[0] !== 'createdAt' ||
    keys[1] !== 'id' ||
    keys[2] !== 'projectId' ||
    keys[3] !== 'status' ||
    keys[4] !== 'title' ||
    typeof value.id !== 'string' ||
    !UUID_V4_PATTERN.test(value.id) ||
    typeof value.projectId !== 'string' ||
    !UUID_V4_PATTERN.test(value.projectId) ||
    value.projectId.toLowerCase() !== expectedProjectId ||
    !isCanonicalTitle(value.title) ||
    (value.status !== 'todo' && value.status !== 'done') ||
    !isCanonicalUtcTimestamp(value.createdAt)
  ) {
    return null;
  }
  return Object.freeze({
    id: value.id.toLowerCase(),
    projectId: expectedProjectId,
    title: value.title,
    status: value.status,
    createdAt: value.createdAt,
  });
}

function parseTaskCollection(
  value: unknown,
  expectedProjectId: string,
): TasksWorkspaceTask[] | null {
  if (!Array.isArray(value) || value.length > MAXIMUM_TASKS) return null;
  const tasks: TasksWorkspaceTask[] = [];
  for (const candidate of value) {
    const task = parseTask(candidate, expectedProjectId);
    if (task === null) return null;
    tasks.push(task);
  }
  return new Set(tasks.map((task) => task.id)).size === tasks.length
    ? tasks
    : null;
}

/**
 * Renders the Tasks workspace from validated Goal, Project, and Task BFF evidence.
 * Browser state never supplies workspace ownership, and late child responses are
 * ignored whenever the user changes either parent scope.
 */
export function TasksClient() {
  const [state, dispatch] = useReducer(
    reduceTasksWorkspaceState,
    undefined,
    createTasksWorkspaceState,
  );
  const [title, setTitle] = useState('');
  const goalLoadGeneration = useRef(0);
  const projectScopeGeneration = useRef(0);
  const taskScopeGeneration = useRef(0);

  async function loadGoals(): Promise<void> {
    const generation = goalLoadGeneration.current + 1;
    goalLoadGeneration.current = generation;
    projectScopeGeneration.current += 1;
    taskScopeGeneration.current += 1;
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
    taskScopeGeneration.current += 1;
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

  async function selectProject(projectId: string): Promise<void> {
    const generation = taskScopeGeneration.current + 1;
    taskScopeGeneration.current = generation;
    dispatch({ type: 'project-selected', projectId });
    setTitle('');
    if (!navigator.onLine) {
      dispatch({ type: 'offline' });
      return;
    }
    try {
      const response = await fetch(
        `/api/planning/projects/${encodeURIComponent(projectId)}/tasks`,
        {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        },
      );
      if (generation !== taskScopeGeneration.current) return;
      if (response.status === 401) {
        dispatch({ type: 'authentication-required' });
        return;
      }
      if (response.status !== 200) {
        dispatch({ type: 'unavailable' });
        return;
      }
      const tasks = parseTaskCollection(
        (await response.json()) as unknown,
        projectId,
      );
      if (generation !== taskScopeGeneration.current) return;
      if (tasks === null) {
        dispatch({ type: 'unavailable' });
        return;
      }
      dispatch({ type: 'tasks-loaded', projectId, tasks });
    } catch {
      if (generation !== taskScopeGeneration.current) return;
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const projectId = state.selectedProjectId;
    const canonicalTitle = title.trim();
    if (
      projectId === null ||
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

    const generation = taskScopeGeneration.current;
    dispatch({ type: 'submit-started' });
    try {
      const response = await fetch(
        `/api/planning/projects/${encodeURIComponent(projectId)}/tasks`,
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
      if (generation !== taskScopeGeneration.current) return;
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
      const task = parseTask((await response.json()) as unknown, projectId);
      if (
        generation !== taskScopeGeneration.current ||
        task === null ||
        task.title !== canonicalTitle ||
        task.status !== 'todo'
      ) {
        dispatch({ type: 'unavailable' });
        return;
      }
      taskScopeGeneration.current += 1;
      dispatch({ type: 'submit-succeeded', task });
      setTitle('');
    } catch {
      if (generation !== taskScopeGeneration.current) return;
      dispatch(navigator.onLine ? { type: 'unavailable' } : { type: 'offline' });
    }
  }

  useEffect(() => {
    void loadGoals();
    const handleOffline = () => {
      goalLoadGeneration.current += 1;
      projectScopeGeneration.current += 1;
      taskScopeGeneration.current += 1;
      dispatch({ type: 'offline' });
    };
    const handleOnline = () => void loadGoals();
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      goalLoadGeneration.current += 1;
      projectScopeGeneration.current += 1;
      taskScopeGeneration.current += 1;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const selectedGoal = state.goals.find((goal) => goal.id === state.selectedGoalId);
  const selectedProject = state.projects.find(
    (project) => project.id === state.selectedProjectId,
  );
  const canCreate =
    state.status === 'ready' &&
    state.selectedProjectId !== null &&
    !state.loadingProjects &&
    !state.loadingTasks &&
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
          <a href="/projects">Projects</a>
          <a href="/tasks" aria-current="page">Tasks</a>
        </nav>
      </header>

      <main className={styles.main}>
        <header className={styles.workspaceHeader}>
          <div>
            <p className={styles.eyebrow}>Planning</p>
            <h1>Tasks</h1>
            <p className={styles.lede}>
              Turn a durable project into concrete work without losing its Goal and
              Project scope.
            </p>
          </div>
        </header>

        <div className={styles.workspaceGrid}>
          <aside className={styles.scopeRail} aria-label="Task scope">
            <section aria-labelledby="task-goals-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Goal</p>
                  <h2 id="task-goals-heading">Choose an outcome</h2>
                </div>
                <span>{state.goals.length}</span>
              </div>
              {state.status === 'loading' ? (
                <p className={styles.scopeStatus}>Loading durable goals…</p>
              ) : null}
              {state.status === 'ready' && state.goals.length === 0 ? (
                <div className={styles.emptyState}>
                  <h3>No durable goals yet</h3>
                  <p>Create a goal before assigning task work.</p>
                  <a href="/goals">Create a durable goal</a>
                </div>
              ) : null}
              {state.goals.length > 0 ? (
                <div className={styles.choiceList}>
                  {state.goals.map((goal) => (
                    <button
                      key={goal.id}
                      type="button"
                      aria-pressed={goal.id === state.selectedGoalId}
                      onClick={() => void selectGoal(goal.id)}
                      disabled={state.status !== 'ready'}
                    >
                      <span>{goal.title}</span>
                      <small>{goal.id === state.selectedGoalId ? 'Selected' : 'View projects'}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            <section aria-labelledby="task-projects-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Project</p>
                  <h2 id="task-projects-heading">
                    {selectedGoal ? selectedGoal.title : 'Choose a project'}
                  </h2>
                </div>
                <span>{state.projects.length}</span>
              </div>
              {state.loadingProjects ? (
                <p className={styles.scopeStatus}>Loading durable projects…</p>
              ) : null}
              {state.selectedGoalId === null && state.goals.length > 0 ? (
                <p className={styles.scopeStatus}>Select a Goal to load its Projects.</p>
              ) : null}
              {state.selectedGoalId !== null &&
              !state.loadingProjects &&
              state.projects.length === 0 &&
              state.status === 'ready' ? (
                <div className={styles.emptyState}>
                  <h3>No projects under this goal</h3>
                  <p>Create a Project before assigning Tasks.</p>
                  <a href="/projects">Create a durable project</a>
                </div>
              ) : null}
              {state.projects.length > 0 ? (
                <div className={styles.choiceList}>
                  {state.projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      aria-pressed={project.id === state.selectedProjectId}
                      onClick={() => void selectProject(project.id)}
                      disabled={state.status !== 'ready' || state.loadingProjects}
                    >
                      <span>{project.title}</span>
                      <small>
                        {project.id === state.selectedProjectId ? 'Selected' : 'View tasks'}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          </aside>

          <section className={styles.taskPane} aria-labelledby="durable-tasks-heading">
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>Durable work</p>
                <h2 id="durable-tasks-heading">
                  {selectedProject ? selectedProject.title : 'Tasks'}
                </h2>
              </div>
              <span>{state.tasks.length}</span>
            </div>

            <div className={styles.status} aria-live="polite">
              {state.message ? <p>{state.message}</p> : null}
              {state.loadingTasks ? <p>Loading durable tasks…</p> : null}
              {state.status === 'authentication-required' ? (
                <p>Sign in before changing the durable Tasks workspace.</p>
              ) : null}
            </div>

            {state.selectedProjectId === null && state.projects.length > 0 ? (
              <div className={styles.emptyState}>
                <h3>No Project selected</h3>
                <p>Select a Project to inspect its Tasks.</p>
              </div>
            ) : null}

            {state.selectedProjectId !== null && !state.loadingTasks ? (
              <form className={styles.creation} onSubmit={(event) => void createTask(event)}>
                <label htmlFor="task-title">Task title</label>
                <div className={styles.inputRow}>
                  <input
                    id="task-title"
                    name="title"
                    value={title}
                    onChange={(event) => setTitle(clampTitleInput(event.target.value))}
                    autoComplete="off"
                    disabled={!canCreate}
                    placeholder="Verify release evidence before merge"
                    aria-describedby="task-title-counter"
                  />
                  <button
                    type="submit"
                    disabled={!canCreate || title.trim().length === 0}
                  >
                    {state.submitting ? 'Creating…' : 'Create task'}
                  </button>
                </div>
                <span className={styles.counter} id="task-title-counter">
                  {[...title].length}/{MAXIMUM_TITLE_CHARACTERS}
                </span>
              </form>
            ) : null}

            {state.selectedProjectId !== null &&
            !state.loadingTasks &&
            state.tasks.length === 0 &&
            state.status === 'ready' ? (
              <div className={styles.emptyState}>
                <h3>No tasks under this project yet</h3>
                <p>Create the first concrete action above.</p>
              </div>
            ) : null}

            {state.tasks.length > 0 ? (
              <ol className={styles.taskList}>
                {state.tasks.map((task) => (
                  <li key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <span>Created {new Date(task.createdAt).toLocaleDateString()}</span>
                    </div>
                    <span className={styles.taskStatus} data-status={task.status}>
                      {task.status === 'done' ? 'Done' : 'To do'}
                    </span>
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
