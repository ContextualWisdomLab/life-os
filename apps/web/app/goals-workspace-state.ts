export interface GoalsWorkspaceGoal {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
}

export type GoalsWorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'authentication-required'
  | 'unavailable'
  | 'offline';

export interface GoalsWorkspaceState {
  readonly status: GoalsWorkspaceStatus;
  readonly goals: readonly GoalsWorkspaceGoal[];
  readonly submitting: boolean;
  readonly message: string | null;
}

export type GoalsWorkspaceEvent =
  | { readonly type: 'load-started' }
  | {
      readonly type: 'load-succeeded';
      readonly goals: readonly GoalsWorkspaceGoal[];
    }
  | { readonly type: 'submit-started' }
  | {
      readonly type: 'submit-succeeded';
      readonly goal: GoalsWorkspaceGoal;
    }
  | { readonly type: 'invalid-title' }
  | { readonly type: 'authentication-required' }
  | { readonly type: 'unavailable' }
  | { readonly type: 'offline' };

/** Creates the browser projection without inventing any durable workspace record. */
export function createGoalsWorkspaceState(): GoalsWorkspaceState {
  return {
    status: 'loading',
    goals: [],
    submitting: false,
    message: null,
  };
}

/**
 * Reduces browser-only presentation state around server-authoritative Goal evidence.
 * Successful creation accepts only the Goal returned by the authenticated BFF; the
 * browser never manufactures a durable identity or workspace authority locally.
 */
export function reduceGoalsWorkspaceState(
  state: GoalsWorkspaceState,
  event: GoalsWorkspaceEvent,
): GoalsWorkspaceState {
  switch (event.type) {
    case 'load-started':
      return { ...state, status: 'loading', submitting: false, message: null };
    case 'load-succeeded':
      return {
        status: 'ready',
        goals: [...event.goals],
        submitting: false,
        message: null,
      };
    case 'submit-started':
      return { ...state, submitting: true, message: null };
    case 'submit-succeeded':
      return {
        ...state,
        status: 'ready',
        goals: [
          event.goal,
          ...state.goals.filter((goal) => goal.id !== event.goal.id),
        ],
        submitting: false,
        message: 'Goal created.',
      };
    case 'invalid-title':
      return {
        ...state,
        submitting: false,
        message: 'Enter a goal between 1 and 160 characters.',
      };
    case 'authentication-required':
      return {
        ...state,
        status: 'authentication-required',
        submitting: false,
        message: 'Sign in before using the durable Goals workspace.',
      };
    case 'unavailable':
      return {
        ...state,
        status: 'unavailable',
        submitting: false,
        message: 'The Goals workspace is temporarily unavailable.',
      };
    case 'offline':
      return {
        ...state,
        status: 'offline',
        submitting: false,
        message: 'You are offline. Existing goals remain visible but cannot change.',
      };
  }
}
