/** Server-authoritative durable Goal projection returned by the authenticated planning BFF. */
export interface GoalsWorkspaceGoal {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
}

/**
 * Browser presentation state for the Goals workspace. Failure states may retain
 * previously loaded durable evidence; only `ready` permits a new Goal submission.
 */
export type GoalsWorkspaceStatus =
  | 'loading'
  | 'ready'
  | 'authentication-required'
  | 'unavailable'
  | 'offline';

/**
 * Browser-only Goals workspace state. `goals` contains only BFF-returned durable
 * evidence, while `submitting` and `message` describe the current UI operation.
 */
export interface GoalsWorkspaceState {
  readonly status: GoalsWorkspaceStatus;
  readonly goals: readonly GoalsWorkspaceGoal[];
  readonly submitting: boolean;
  readonly message: string | null;
}

/**
 * Reducer inputs emitted by browser operations and validated BFF outcomes.
 * Success events carry server evidence; failure events never carry workspace authority.
 */
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
