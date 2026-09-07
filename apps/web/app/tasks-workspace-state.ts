export type TasksWorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'offline'
  | 'authentication-required'
  | 'unavailable';

export interface TasksWorkspaceGoal {
  readonly id: string;
  readonly title: string;
}

export interface TasksWorkspaceProject {
  readonly id: string;
  readonly goalId: string;
  readonly title: string;
}

export interface TasksWorkspaceTask {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: 'todo' | 'done';
  readonly createdAt: string;
}

export interface TasksWorkspaceState {
  readonly status: TasksWorkspaceStatus;
  readonly goals: readonly TasksWorkspaceGoal[];
  readonly selectedGoalId: string | null;
  readonly projects: readonly TasksWorkspaceProject[];
  readonly selectedProjectId: string | null;
  readonly tasks: readonly TasksWorkspaceTask[];
  readonly loadingProjects: boolean;
  readonly loadingTasks: boolean;
  readonly submitting: boolean;
  readonly message: string | null;
}

export type TasksWorkspaceAction =
  | { readonly type: 'goals-loaded'; readonly goals: readonly TasksWorkspaceGoal[] }
  | { readonly type: 'goal-selected'; readonly goalId: string }
  | {
      readonly type: 'projects-loaded';
      readonly goalId: string;
      readonly projects: readonly TasksWorkspaceProject[];
    }
  | { readonly type: 'project-selected'; readonly projectId: string }
  | {
      readonly type: 'tasks-loaded';
      readonly projectId: string;
      readonly tasks: readonly TasksWorkspaceTask[];
    }
  | { readonly type: 'submit-started' }
  | { readonly type: 'submit-succeeded'; readonly task: TasksWorkspaceTask }
  | { readonly type: 'invalid-title' }
  | { readonly type: 'offline' }
  | { readonly type: 'authentication-required' }
  | { readonly type: 'unavailable' }
  | { readonly type: 'clear-message' };

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function hasUniqueIdentities(values: readonly { readonly id: string }[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length;
}

function validGoals(goals: readonly TasksWorkspaceGoal[]): boolean {
  return (
    hasUniqueIdentities(goals) &&
    goals.every(
      (goal) =>
        UUID_V4_PATTERN.test(goal.id) &&
        goal.title === goal.title.trim() &&
        [...goal.title].length > 0,
    )
  );
}

function validProjects(
  projects: readonly TasksWorkspaceProject[],
  goalId: string,
): boolean {
  return (
    hasUniqueIdentities(projects) &&
    projects.every(
      (project) =>
        UUID_V4_PATTERN.test(project.id) &&
        project.goalId === goalId &&
        project.title === project.title.trim() &&
        [...project.title].length > 0,
    )
  );
}

function validTasks(
  tasks: readonly TasksWorkspaceTask[],
  projectId: string,
): boolean {
  return (
    hasUniqueIdentities(tasks) &&
    tasks.every(
      (task) =>
        UUID_V4_PATTERN.test(task.id) &&
        task.projectId === projectId &&
        task.title === task.title.trim() &&
        [...task.title].length > 0 &&
        (task.status === 'todo' || task.status === 'done') &&
        Number.isFinite(Date.parse(task.createdAt)),
    )
  );
}

/** Creates a browser state with no inferred Goal, Project, Task, or workspace authority. */
export function createTasksWorkspaceState(): TasksWorkspaceState {
  return {
    status: 'loading',
    goals: [],
    selectedGoalId: null,
    projects: [],
    selectedProjectId: null,
    tasks: [],
    loadingProjects: false,
    loadingTasks: false,
    submitting: false,
    message: null,
  };
}

/**
 * Applies only already-validated BFF evidence to the Tasks workspace. Parent scope
 * changes discard descendant evidence so late responses cannot cross Goal or Project
 * boundaries, while dependency failures preserve previously accepted durable records.
 */
export function reduceTasksWorkspaceState(
  state: TasksWorkspaceState,
  action: TasksWorkspaceAction,
): TasksWorkspaceState {
  switch (action.type) {
    case 'goals-loaded':
      if (!validGoals(action.goals)) return state;
      return {
        ...state,
        status: 'ready',
        goals: [...action.goals],
        selectedGoalId: null,
        projects: [],
        selectedProjectId: null,
        tasks: [],
        loadingProjects: false,
        loadingTasks: false,
        submitting: false,
        message: null,
      };

    case 'goal-selected':
      if (
        state.status !== 'ready' ||
        !state.goals.some((goal) => goal.id === action.goalId)
      ) {
        return state;
      }
      return {
        ...state,
        selectedGoalId: action.goalId,
        projects: [],
        selectedProjectId: null,
        tasks: [],
        loadingProjects: true,
        loadingTasks: false,
        submitting: false,
        message: null,
      };

    case 'projects-loaded':
      if (
        state.status !== 'ready' ||
        state.selectedGoalId !== action.goalId ||
        !state.loadingProjects ||
        !validProjects(action.projects, action.goalId)
      ) {
        return state;
      }
      return {
        ...state,
        projects: [...action.projects],
        selectedProjectId: null,
        tasks: [],
        loadingProjects: false,
        loadingTasks: false,
        submitting: false,
        message: null,
      };

    case 'project-selected':
      if (
        state.status !== 'ready' ||
        state.loadingProjects ||
        !state.projects.some((project) => project.id === action.projectId)
      ) {
        return state;
      }
      return {
        ...state,
        selectedProjectId: action.projectId,
        tasks: [],
        loadingTasks: true,
        submitting: false,
        message: null,
      };

    case 'tasks-loaded':
      if (
        state.status !== 'ready' ||
        state.selectedProjectId !== action.projectId ||
        !state.loadingTasks ||
        !validTasks(action.tasks, action.projectId)
      ) {
        return state;
      }
      return {
        ...state,
        tasks: [...action.tasks],
        loadingTasks: false,
        submitting: false,
        message: null,
      };

    case 'submit-started':
      if (
        state.status !== 'ready' ||
        state.selectedProjectId === null ||
        state.loadingProjects ||
        state.loadingTasks ||
        state.submitting
      ) {
        return state;
      }
      return { ...state, submitting: true, message: null };

    case 'submit-succeeded':
      if (
        state.status !== 'ready' ||
        state.selectedProjectId === null ||
        !state.submitting ||
        action.task.projectId !== state.selectedProjectId ||
        !validTasks([action.task], state.selectedProjectId) ||
        state.tasks.some((existing) => existing.id === action.task.id)
      ) {
        return state;
      }
      return {
        ...state,
        tasks: [...state.tasks, action.task],
        submitting: false,
        message: 'Task created.',
      };

    case 'invalid-title':
      return {
        ...state,
        submitting: false,
        message: 'Enter a task between 1 and 160 characters.',
      };

    case 'offline':
      return {
        ...state,
        status: 'offline',
        loadingProjects: false,
        loadingTasks: false,
        submitting: false,
        message: 'You are offline. Existing tasks remain visible but cannot change.',
      };

    case 'authentication-required':
      return {
        ...state,
        status: 'authentication-required',
        loadingProjects: false,
        loadingTasks: false,
        submitting: false,
        message: 'Sign in again to change planning data.',
      };

    case 'unavailable':
      return {
        ...state,
        status: 'unavailable',
        loadingProjects: false,
        loadingTasks: false,
        submitting: false,
        message: 'Tasks are temporarily unavailable. Existing evidence is unchanged.',
      };

    case 'clear-message':
      return state.message === null ? state : { ...state, message: null };
  }
}
