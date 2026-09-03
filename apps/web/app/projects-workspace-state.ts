/** Browser-safe durable Goal evidence returned by the authenticated Planning BFF. */
export interface ProjectsWorkspaceGoal {
  readonly id: string;
  readonly title: string;
}

/** Browser-safe durable Project evidence scoped to one server-authoritative Goal. */
export interface ProjectsWorkspaceProject {
  readonly id: string;
  readonly goalId: string;
  readonly title: string;
  readonly createdAt: string;
}

/**
 * Top-level availability of the Projects workspace. Project loading and submission
 * remain separate flags so durable evidence can stay visible during bounded work.
 */
export type ProjectsWorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'authentication-required'
  | 'unavailable'
  | 'offline';

/**
 * Browser presentation state for Goal selection and the selected Goal's durable
 * Projects. No workspace authority or durable identity is created in this state.
 */
export interface ProjectsWorkspaceState {
  readonly status: ProjectsWorkspaceStatus;
  readonly goals: readonly ProjectsWorkspaceGoal[];
  readonly selectedGoalId: string | null;
  readonly projects: readonly ProjectsWorkspaceProject[];
  readonly loadingProjects: boolean;
  readonly submitting: boolean;
  readonly message: string | null;
}

/**
 * Reducer events emitted only after browser operations have validated BFF evidence.
 * Project results carry their Goal scope so late responses cannot cross selection.
 */
export type ProjectsWorkspaceEvent =
  | {
      readonly type: 'goals-loaded';
      readonly goals: readonly ProjectsWorkspaceGoal[];
    }
  | { readonly type: 'goal-selected'; readonly goalId: string }
  | {
      readonly type: 'projects-loaded';
      readonly goalId: string;
      readonly projects: readonly ProjectsWorkspaceProject[];
    }
  | { readonly type: 'submit-started' }
  | {
      readonly type: 'submit-succeeded';
      readonly project: ProjectsWorkspaceProject;
    }
  | { readonly type: 'invalid-title' }
  | { readonly type: 'authentication-required' }
  | { readonly type: 'unavailable' }
  | { readonly type: 'offline' };

/** Creates an empty browser projection without selecting or inventing a durable Goal. */
export function createProjectsWorkspaceState(): ProjectsWorkspaceState {
  return {
    status: 'loading',
    goals: [],
    selectedGoalId: null,
    projects: [],
    loadingProjects: false,
    submitting: false,
    message: null,
  };
}

/**
 * Reduces presentation-only state while preserving the selected Goal as the scope
 * boundary for Project evidence. Late responses and stale submissions are ignored.
 */
export function reduceProjectsWorkspaceState(
  state: ProjectsWorkspaceState,
  event: ProjectsWorkspaceEvent,
): ProjectsWorkspaceState {
  switch (event.type) {
    case 'goals-loaded':
      return {
        status: 'ready',
        goals: [...event.goals],
        selectedGoalId: null,
        projects: [],
        loadingProjects: false,
        submitting: false,
        message: null,
      };
    case 'goal-selected':
      if (!state.goals.some((goal) => goal.id === event.goalId)) return state;
      return {
        ...state,
        status: 'ready',
        selectedGoalId: event.goalId,
        projects: [],
        loadingProjects: true,
        submitting: false,
        message: null,
      };
    case 'projects-loaded':
      if (state.selectedGoalId !== event.goalId) return state;
      return {
        ...state,
        status: 'ready',
        projects: [...event.projects],
        loadingProjects: false,
        submitting: false,
        message: null,
      };
    case 'submit-started':
      if (state.status !== 'ready' || state.selectedGoalId === null) return state;
      return { ...state, submitting: true, message: null };
    case 'submit-succeeded':
      if (state.selectedGoalId !== event.project.goalId) return state;
      return {
        ...state,
        status: 'ready',
        projects: [
          event.project,
          ...state.projects.filter((project) => project.id !== event.project.id),
        ],
        loadingProjects: false,
        submitting: false,
        message: 'Project created.',
      };
    case 'invalid-title':
      return {
        ...state,
        submitting: false,
        message: 'Enter a project between 1 and 160 characters.',
      };
    case 'authentication-required':
      return {
        ...state,
        status: 'authentication-required',
        loadingProjects: false,
        submitting: false,
        message: 'Sign in before using the durable Projects workspace.',
      };
    case 'unavailable':
      return {
        ...state,
        status: 'unavailable',
        loadingProjects: false,
        submitting: false,
        message: 'The Projects workspace is temporarily unavailable.',
      };
    case 'offline':
      return {
        ...state,
        status: 'offline',
        loadingProjects: false,
        submitting: false,
        message: 'You are offline. Existing projects remain visible but cannot change.',
      };
  }
}
